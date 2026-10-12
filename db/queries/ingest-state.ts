import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { DatabaseError } from '@/lib/errors'

/**
 * The UID watermark for one mailbox (Feature 16, Task 99; CONSTRAINT-33).
 *
 * `lastUid` is the highest UID such that every listed message at or below it
 * is committed; the next run lists from `lastUid + 1`. It is only meaningful
 * under `uidValidity` — `runIngestion` resets it when the server reports a
 * different one.
 */
export interface IngestState {
  mailbox: string
  uidValidity: number
  lastUid: number
  lastRunAt: Date | null
}

interface StateRow {
  mailbox: string
  uid_validity: unknown
  last_uid: unknown
  last_run_at: unknown
}

/**
 * A persisted integer read back as a number, rejected when it is not one.
 *
 * The watermark is interpolated into the IMAP fetch range (L-14), and
 * `db.execute` hands bigint columns back as strings, so this is the boundary
 * where a corrupted row would otherwise turn into a protocol string.
 */
function toInteger(value: unknown, column: string, minimum: number): number {
  const parsed = Number(value)
  if (Number.isSafeInteger(parsed) && parsed >= minimum) return parsed
  throw new DatabaseError(
    'readIngestState',
    `ingest_mailbox_state.${column} read back as ${String(value)}; expected a safe integer >= ${minimum}`,
  )
}

function toState(row: StateRow): IngestState {
  return {
    mailbox: row.mailbox,
    uidValidity: toInteger(row.uid_validity, 'uid_validity', 1),
    lastUid: toInteger(row.last_uid, 'last_uid', 0),
    lastRunAt: row.last_run_at === null ? null : new Date(row.last_run_at as string),
  }
}

/**
 * Loads the watermark for `mailbox`.
 *
 * @param mailbox The IMAP mailbox path, e.g. `INBOX`.
 * @returns The state, or `null` before the first run has written one.
 * @throws {DatabaseError} when the query fails or a stored value is not a
 *   usable integer.
 */
export async function readIngestState(mailbox: string): Promise<IngestState | null> {
  let rows: StateRow[]
  try {
    rows = (await db.execute(sql`
      SELECT s.mailbox, s.uid_validity, s.last_uid, s.last_run_at
      FROM ingest_mailbox_state s
      WHERE s.mailbox = ${mailbox}
    `)) as unknown as StateRow[]
  } catch (cause) {
    console.error('readIngestState: query failed', { operation: 'readIngestState', mailbox, cause })
    throw new DatabaseError('readIngestState', 'Failed to read the ingestion watermark', { cause })
  }
  return rows[0] ? toState(rows[0]) : null
}

/**
 * Writes the watermark for `state.mailbox`, inserting the row on the first
 * run and overwriting it after.
 *
 * @param state The full state to persist.
 * @throws {DatabaseError} when the upsert fails.
 */
export async function writeIngestState(state: IngestState): Promise<void> {
  // ISO text, not a Date: postgres-js cannot serialise a Date bound into a raw
  // `sql` template (ERR_INVALID_ARG_TYPE) — only the query builder maps it.
  const lastRunAt = state.lastRunAt?.toISOString() ?? null
  try {
    await db.execute(sql`
      INSERT INTO ingest_mailbox_state (mailbox, uid_validity, last_uid, last_run_at)
      VALUES (${state.mailbox}, ${state.uidValidity}, ${state.lastUid}, ${lastRunAt})
      ON CONFLICT (mailbox) DO UPDATE SET
        uid_validity = EXCLUDED.uid_validity,
        last_uid = EXCLUDED.last_uid,
        last_run_at = EXCLUDED.last_run_at
    `)
  } catch (cause) {
    console.error('writeIngestState: upsert failed', {
      operation: 'writeIngestState',
      mailbox: state.mailbox,
      uidValidity: state.uidValidity,
      lastUid: state.lastUid,
      cause,
    })
    throw new DatabaseError('writeIngestState', 'Failed to write the ingestion watermark', { cause })
  }
}
