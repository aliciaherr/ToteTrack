import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { inboundEmails, inboundPos } from '@/db/schema'
import { DatabaseError } from '@/lib/errors'
import { loggableFailure } from '@/lib/loggable-failure'
import { buildPoByContentHashQuery, type InsertInboundPoInput } from './inbound-pos'

/**
 * The email half of the ingestion data layer (Feature 16): staging one email
 * with its PO rows, and the UID lookup admission runs before any bytes move.
 * Split from the original `inbound.ts` at its line cap (Task 99).
 *
 * The processed marker is `(uid_validity, uid)` (CONSTRAINT-33). `message_id`
 * is written as a label and nothing here reads it.
 */

export type InboundEmailClassification = 'po_found' | 'no_po_found' | 'failed'

export interface InsertInboundEmailInput {
  uid_validity: number
  uid: number
  /** Display label only — nullable, not unique, never branched on. */
  message_id: string | null
  classification: InboundEmailClassification
  from_address: string | null
  subject: string | null
  received_at: Date | null
}

/** A new email row, or the report that this UID was already staged. */
export type StageEmailResult = { id: string; duplicatesFlagged: number } | { duplicate: true }

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Postgres unique-violation SQLSTATE, and the one constraint whose violation
// means "already staged". Matched by name so an unrelated 23505 can never be
// misreported as an idempotent re-run.
const POSTGRES_UNIQUE_VIOLATION = '23505'
const UID_MARKER_CONSTRAINT = 'inbound_emails_uid_validity_uid_unique'

interface PostgresErrorFields {
  code?: unknown
  constraint_name?: unknown
}

/** The error and, when drizzle wrapped it, the driver error beneath. */
function errorLayers(cause: unknown): unknown[] {
  return [cause, (cause as { cause?: unknown } | null)?.cause]
}

/**
 * Is this the composite marker's unique violation, at either depth?
 *
 * Drizzle 0.45 wraps every driver error in `DrizzleQueryError` and puts the
 * Postgres error on `.cause`, so a top-level `code` check never matches in
 * production — only against a hand-built test double.
 */
function isMarkerViolation(cause: unknown): boolean {
  for (const candidate of errorLayers(cause)) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const fields = candidate as PostgresErrorFields
    if (fields.code === POSTGRES_UNIQUE_VIOLATION && fields.constraint_name === UID_MARKER_CONSTRAINT) {
      return true
    }
  }
  return false
}

/**
 * Inserts the PO rows, pointing each repeat hash at its first sighting. A
 * sibling in this same email counts — `seen` covers rows this transaction
 * wrote, whose shared `created_at` would make the SQL ordering ambiguous.
 */
async function insertPos(tx: Tx, emailId: string, pos: InsertInboundPoInput[]): Promise<number> {
  const seen = new Map<string, string>()
  let duplicates = 0
  for (const po of pos) {
    let originalId = seen.get(po.content_hash) ?? null
    if (!originalId) {
      const found = (await tx.execute(buildPoByContentHashQuery(po.content_hash))) as unknown as {
        id: string
      }[]
      originalId = found[0]?.id ?? null
    }
    if (originalId) duplicates += 1
    const [row] = await tx
      .insert(inboundPos)
      .values({ ...po, inbound_email_id: emailId, duplicate_of_id: originalId })
      .returning({ id: inboundPos.id })
    if (!seen.has(po.content_hash)) seen.set(po.content_hash, originalId ?? row.id)
  }
  return duplicates
}

/**
 * Stages one email and all its PO rows in **one transaction**: either every
 * row exists afterwards or none does, so a message is never half-staged.
 *
 * A repeat `(uid_validity, uid)` is **reported, not thrown** — it is the
 * expected outcome of a re-run after a crash between staging and the
 * watermark advance. The discriminated return is the report; the caller must
 * branch on it. Every other failure is logged and rethrown.
 *
 * A repeat `content_hash` is flagged via `duplicate_of_id`, never rejected —
 * a human decides.
 *
 * @param email The email row. `message_id` is a label only.
 * @param pos Its PO rows, without `inbound_email_id` or `duplicate_of_id`.
 * @returns The email id and how many PO rows were flagged duplicate, or
 *   `{ duplicate: true }` when this UID was already staged.
 * @throws {DatabaseError} when the transaction fails for any other reason.
 */
export async function stageEmailWithPos(
  email: InsertInboundEmailInput,
  pos: InsertInboundPoInput[],
): Promise<StageEmailResult> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(inboundEmails).values(email).returning({ id: inboundEmails.id })
      return { id: row.id, duplicatesFlagged: await insertPos(tx, row.id, pos) }
    })
  } catch (cause) {
    if (isMarkerViolation(cause)) return { duplicate: true }
    // UIDs, counts and the driver code only — never the sender, subject or
    // message id, which the raw error carries in its params (SEC-05).
    console.error('stageEmailWithPos: transaction failed, nothing was staged', {
      ...loggableFailure(cause),
      operation: 'stageEmailWithPos',
      uid_validity: email.uid_validity,
      uid: email.uid,
      poCount: pos.length,
    })
    throw new DatabaseError('stageEmailWithPos', 'Failed to stage inbound email and its POs', {
      cause,
    })
  }
}

/** A bigint column read back through `db.execute`, which yields it as a string. */
function toUid(value: unknown): number {
  const uid = Number(value)
  if (!Number.isSafeInteger(uid) || uid < 1) {
    throw new DatabaseError('stagedUidsAbove', `inbound_emails.uid read back as ${String(value)}, not a usable UID`)
  }
  return uid
}

/**
 * UIDs already staged above the watermark under this UIDVALIDITY — the rows a
 * halted or crashed run committed but the watermark has not yet passed.
 *
 * A UID-only lookup, so admission can skip these **before any bytes move**
 * (H-01) without any parsed header taking part (architecture rule 1).
 *
 * @param uidValidity The mailbox's current UIDVALIDITY.
 * @param uid The watermark; only UIDs strictly above it are returned.
 * @throws {DatabaseError} when the query fails or returns a non-UID value.
 */
export async function stagedUidsAbove(uidValidity: number, uid: number): Promise<Set<number>> {
  let rows: { uid: unknown }[]
  try {
    rows = (await db.execute(sql`
      SELECT e.uid FROM inbound_emails e
      WHERE e.uid_validity = ${uidValidity} AND e.uid > ${uid}
    `)) as unknown as { uid: unknown }[]
  } catch (cause) {
    console.error('stagedUidsAbove: query failed', {
      operation: 'stagedUidsAbove',
      uidValidity,
      uid,
      cause,
    })
    throw new DatabaseError('stagedUidsAbove', 'Failed to read staged UIDs', { cause })
  }
  return new Set(rows.map((row) => toUid(row.uid)))
}
