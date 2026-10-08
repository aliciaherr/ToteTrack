import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { inboundEmails, inboundPos } from '@/db/schema'
import { DatabaseError } from '@/lib/errors'

export type InboundEmailClassification = 'po_found' | 'no_po_found' | 'failed'

export type InboundPoSourceKind = 'image' | 'pdf' | 'email_body'

export type InboundPoStatus =
  | 'pending_extraction'
  | 'extracting'
  | 'pending_review'
  | 'approved'
  | 'discarded'
  | 'extraction_failed'

export interface InsertInboundEmailInput {
  message_id: string
  classification: InboundEmailClassification
  from_address: string | null
  subject: string | null
  received_at: Date | null
}

export interface InsertInboundPoInput {
  inbound_email_id: string
  source_kind: InboundPoSourceKind
  /** NULL exactly when `source_kind` is `email_body` — there is no stored file. */
  document_path: string | null
  content_hash: string
  /** The first row sharing this hash, or NULL on a first sighting. */
  duplicate_of_id: string | null
}

/**
 * One staged PO candidate, as the review queue reads it. The three JSON
 * columns are typed `unknown` on purpose — their shapes are owned by the
 * extraction and check work, and a guessed interface here would be a contract
 * this layer cannot keep. Callers narrow them themselves.
 */
export interface InboundPoRow {
  id: string
  inbound_email_id: string
  source_kind: InboundPoSourceKind
  document_path: string | null
  content_hash: string
  duplicate_of_id: string | null
  status: InboundPoStatus
  attempt_count: number
  extracted: unknown
  check_results: unknown
  confirmed: unknown
  order_id: string | null
  skipped_at: string | null
  created_at: string
}

// Postgres unique-violation SQLSTATE. `inbound_emails.message_id` is unique;
// when a repeat insert trips it, the driver error carries this code. Same
// constant and predicate shape as `lib/actions/orders.ts`, repeated rather
// than imported because the db layer must not depend on the action layer.
const POSTGRES_UNIQUE_VIOLATION = '23505'

// The one status the review queue reads. A constant so the list query and the
// count query can never drift onto different statuses and disagree about how
// many rows the badge should show.
const PENDING_REVIEW_STATUS: InboundPoStatus = 'pending_review'

function isUniqueViolation(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  )
}

// Does this row have at least one failed check?
//
// **The one contract the check suite must honour**: a failure is an entry in a
// `failures` array on `check_results`. That column's full shape is not settled
// yet, so the predicate is total rather than trusting it — `jsonb_array_length`
// raises on a non-array, so the type is tested first and anything else (NULL
// column, missing key, an object) counts as "no failures" instead of breaking
// the queue. Checks rank attention and never gate acceptance: a failure sorts
// a row to the top, it does not keep it out of the list.
const HAS_CHECK_FAILURES: SQL = sql`
  CASE
    WHEN jsonb_typeof(p.check_results -> 'failures') = 'array'
    THEN jsonb_array_length(p.check_results -> 'failures') > 0
    ELSE FALSE
  END
`

// Review-queue ordering, in the three stages the feature spec names.
// 1. Failed checks first — where a reviewer's attention is worth most.
// 2. Then `skipped_at` ASC NULLS FIRST: never-skipped rows ahead of skipped
//    ones, and among skipped rows the longest-ago skip first, so a deferred PO
//    cannot be deferred forever.
// 3. Then `created_at` ASC — oldest first, so the queue drains in arrival
//    order and nothing starves at the bottom.
const PENDING_REVIEW_ORDER_CLAUSE: SQL = sql`
  ORDER BY
    CASE WHEN ${HAS_CHECK_FAILURES} THEN 0 ELSE 1 END ASC,
    p.skipped_at ASC NULLS FIRST,
    p.created_at ASC
`

function buildPendingReviewQuery(): SQL {
  return sql`
    SELECT
      p.id,
      p.inbound_email_id,
      p.source_kind,
      p.document_path,
      p.content_hash,
      p.duplicate_of_id,
      p.status,
      p.attempt_count,
      p.extracted,
      p.check_results,
      p.confirmed,
      p.order_id,
      p.skipped_at,
      p.created_at
    FROM inbound_pos p
    WHERE p.status = ${PENDING_REVIEW_STATUS}
    ${PENDING_REVIEW_ORDER_CLAUSE}
  `
}

function buildPendingReviewCountQuery(): SQL {
  return sql`
    SELECT COUNT(*)::int AS count
    FROM inbound_pos p
    WHERE p.status = ${PENDING_REVIEW_STATUS}
  `
}

// Earliest row carrying this hash — `ORDER BY created_at ASC` is load-bearing.
// `content_hash` is deliberately not unique, so several rows can share one and
// `duplicate_of_id` must point at the *original* sighting. Without the
// ordering a later duplicate could be named as the original.
function buildPoByContentHashQuery(hash: string): SQL {
  return sql`
    SELECT p.id
    FROM inbound_pos p
    WHERE p.content_hash = ${hash}
    ORDER BY p.created_at ASC
    LIMIT 1
  `
}

/**
 * Records one email as processed. The row's existence — specifically its
 * unique `message_id` — is what stops the ingester handling the message twice;
 * the IMAP `\Seen` flag is never consulted.
 *
 * A repeat `message_id` is **reported, not thrown**: the unique violation is
 * caught and returned as `{ duplicate: true }`, because a message already in
 * the table is the expected idempotent outcome of a re-run, not a fault. The
 * discriminated return *is* the report — the caller must branch on it, so
 * nothing is swallowed. Every other failure is logged and rethrown.
 *
 * @param input Message id, classification, and the optional sender, subject
 *   and received timestamp from the MIME headers.
 * @returns The new row's id, or `{ duplicate: true }` when this
 *   `message_id` has already been recorded.
 * @throws {DatabaseError} when the insert fails for any other reason.
 */
export async function insertInboundEmail(
  input: InsertInboundEmailInput,
): Promise<{ id: string } | { duplicate: true }> {
  try {
    const [row] = await db
      .insert(inboundEmails)
      .values(input)
      .returning({ id: inboundEmails.id })
    return { id: row.id }
  } catch (cause) {
    if (isUniqueViolation(cause)) return { duplicate: true }
    console.error('insertInboundEmail: insert failed', {
      operation: 'insertInboundEmail',
      message_id: input.message_id,
      classification: input.classification,
      cause,
    })
    throw new DatabaseError('insertInboundEmail', 'Failed to record inbound email', {
      cause,
    })
  }
}

/**
 * Stages one PO candidate for extraction and review. Always inserts, even
 * when `content_hash` repeats — a duplicate belongs in the queue flagged via
 * `duplicate_of_id` so a human decides, never rejected at the door.
 *
 * `status` and `attempt_count` are left to their column defaults
 * (`pending_extraction`, `0`) so the starting state has one definition.
 *
 * @param input The owning email, where the candidate came from, its stored
 *   document path (NULL for `email_body`), its content hash, and the original
 *   row's id when this is a duplicate.
 * @returns The new row's id.
 * @throws {DatabaseError} when the insert fails.
 */
export async function insertInboundPo(
  input: InsertInboundPoInput,
): Promise<{ id: string }> {
  try {
    const [row] = await db.insert(inboundPos).values(input).returning({ id: inboundPos.id })
    return { id: row.id }
  } catch (cause) {
    console.error('insertInboundPo: insert failed', {
      operation: 'insertInboundPo',
      inbound_email_id: input.inbound_email_id,
      source_kind: input.source_kind,
      content_hash: input.content_hash,
      cause,
    })
    throw new DatabaseError('insertInboundPo', 'Failed to stage inbound PO', { cause })
  }
}

/**
 * Finds the earliest staged PO carrying `hash`, which is what a new row's
 * `duplicate_of_id` should point at. Returns `null` when the hash has not been
 * seen — the first-sighting case. Not a uniqueness check: `content_hash` is
 * intentionally non-unique and several rows may share one.
 *
 * @param hash Hex content hash of the candidate document or normalised body.
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function findPoByContentHash(hash: string): Promise<{ id: string } | null> {
  try {
    const result = await db.execute(buildPoByContentHashQuery(hash))
    return (result as unknown as { id: string }[])[0] ?? null
  } catch (cause) {
    console.error('findPoByContentHash: query failed', {
      operation: 'findPoByContentHash',
      hash,
      cause,
    })
    throw new DatabaseError('findPoByContentHash', 'Failed to look up content hash', {
      cause,
    })
  }
}

/**
 * Loads every PO awaiting human review, ordered so the reviewer meets the
 * rows that need them most first: failed checks, then never-skipped before
 * skipped, then oldest first. Unbounded — the queue is drained, not paginated.
 *
 * @returns The pending rows in review order, or `[]` when the queue is empty.
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function listPendingReview(): Promise<InboundPoRow[]> {
  try {
    const result = await db.execute(buildPendingReviewQuery())
    return result as unknown as InboundPoRow[]
  } catch (cause) {
    console.error('listPendingReview: query failed', {
      operation: 'listPendingReview',
      status: PENDING_REVIEW_STATUS,
      cause,
    })
    throw new DatabaseError('listPendingReview', 'Failed to load the review queue', {
      cause,
    })
  }
}

/**
 * Counts the POs awaiting human review, for the nav badge. Its own round trip
 * rather than `listPendingReview().length` so the badge never pays for the
 * full rows it does not render.
 *
 * @returns The count, or `0` when the queue is empty.
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function countPendingReview(): Promise<number> {
  try {
    const result = await db.execute(buildPendingReviewCountQuery())
    return (result as unknown as { count: number }[])[0]?.count ?? 0
  } catch (cause) {
    console.error('countPendingReview: query failed', {
      operation: 'countPendingReview',
      status: PENDING_REVIEW_STATUS,
      cause,
    })
    throw new DatabaseError('countPendingReview', 'Failed to count the review queue', {
      cause,
    })
  }
}
