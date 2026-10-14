import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { DatabaseError } from '@/lib/errors'
import { loggableFailure } from '@/lib/loggable-failure'

/**
 * The give-up counter: failing runs per UID (Feature 16, Task 114;
 * CONSTRAINT-37). `runIngestion` increments it for every UID that failed this
 * run and deletes it once the UID commits or gives up.
 *
 * Every value here is an integer or a timestamp, so every failure names UIDs
 * only — never a header (SEC-05, EH-02).
 */
export interface FailureRecord {
  uidValidity: number
  uid: number
  /** Failing runs so far, this one included. */
  attempts: number
  /** When the first failing run recorded it. The give-up age counts from here. */
  firstFailedAt: Date
  lastFailedAt: Date
}

interface FailureRow {
  uid_validity: unknown
  uid: unknown
  attempts: unknown
  first_failed_at: unknown
  last_failed_at: unknown
}

/**
 * A row read back as a `FailureRecord`. `db.execute` returns bigint columns
 * as strings, so each is checked rather than trusted.
 */
function toRecord(row: FailureRow): FailureRecord {
  const integer = (value: unknown, column: string): number => {
    const parsed = Number(value)
    if (Number.isSafeInteger(parsed) && parsed >= 1) return parsed
    throw new DatabaseError(
      'recordFailures',
      `ingest_uid_failures.${column} read back as ${String(value)}; expected a positive safe integer`,
    )
  }
  const timestamp = (value: unknown, column: string): Date => {
    const parsed = new Date(value as string | Date)
    if (value !== null && !Number.isNaN(parsed.getTime())) return parsed
    throw new DatabaseError(
      'recordFailures',
      `ingest_uid_failures.${column} read back as ${String(value)}; expected a timestamp`,
    )
  }
  return {
    uidValidity: integer(row.uid_validity, 'uid_validity'),
    uid: integer(row.uid, 'uid'),
    attempts: integer(row.attempts, 'attempts'),
    firstFailedAt: timestamp(row.first_failed_at, 'first_failed_at'),
    lastFailedAt: timestamp(row.last_failed_at, 'last_failed_at'),
  }
}

function uidList(uids: number[]) {
  return sql.join(uids.map((uid) => sql`${uid}`), sql`, `)
}

/**
 * Counts one more failing run for each UID: inserts a row at `attempts = 1`,
 * or increments it and moves `last_failed_at`. `first_failed_at` is kept on
 * conflict, so the give-up age runs from the first failure.
 *
 * @param uidValidity The UIDVALIDITY every UID belongs to.
 * @param uids The UIDs that failed this run. An empty list writes nothing.
 * @param now The run's clock.
 * @returns Each UID's row after the increment.
 * @throws {DatabaseError} when the upsert fails, naming the UIDs only.
 */
export async function recordFailures(uidValidity: number, uids: number[], now: Date): Promise<FailureRecord[]> {
  if (uids.length === 0) return []
  // ISO text, not a Date: postgres-js cannot serialise a Date bound into a raw
  // `sql` template (see `writeIngestState`).
  const at = now.toISOString()
  const rows = sql.join(
    uids.map((uid) => sql`(${uidValidity}, ${uid}, 1, ${at}::timestamptz, ${at}::timestamptz)`),
    sql`, `,
  )
  let result: FailureRow[]
  try {
    result = (await db.execute(sql`
      INSERT INTO ingest_uid_failures (uid_validity, uid, attempts, first_failed_at, last_failed_at)
      VALUES ${rows}
      ON CONFLICT (uid_validity, uid) DO UPDATE SET
        attempts = ingest_uid_failures.attempts + 1,
        last_failed_at = EXCLUDED.last_failed_at
      RETURNING uid_validity, uid, attempts, first_failed_at, last_failed_at
    `)) as unknown as FailureRow[]
  } catch (cause) {
    console.error('recordFailures: upsert failed', { operation: 'recordFailures', uidValidity, uids, failure: loggableFailure(cause) })
    throw new DatabaseError('recordFailures', `Failed to count failing runs for UIDs ${uids.join(', ')}`, { cause })
  }
  return result.map(toRecord)
}

/**
 * Deletes the counter for UIDs that committed or gave up.
 *
 * @param uidValidity The UIDVALIDITY every UID belongs to.
 * @param uids The UIDs to clear. An empty list deletes nothing.
 * @throws {DatabaseError} when the delete fails, naming the UIDs only.
 */
export async function clearFailures(uidValidity: number, uids: number[]): Promise<void> {
  if (uids.length === 0) return
  try {
    await db.execute(sql`
      DELETE FROM ingest_uid_failures
      WHERE uid_validity = ${uidValidity} AND uid IN (${uidList(uids)})
    `)
  } catch (cause) {
    console.error('clearFailures: delete failed', { operation: 'clearFailures', uidValidity, uids, failure: loggableFailure(cause) })
    throw new DatabaseError('clearFailures', `Failed to clear the failure counter for UIDs ${uids.join(', ')}`, { cause })
  }
}

/**
 * How many emails are currently failing to import: one counter row per UID
 * that has failed at least one run and has neither committed nor given up
 * (Task 105's alert).
 *
 * @returns The row count; `0` when nothing is failing.
 * @throws {DatabaseError} when the query fails or reads back a non-count.
 */
export async function countFailingUids(): Promise<number> {
  let rows: { count: unknown }[]
  try {
    rows = (await db.execute(sql`SELECT COUNT(*)::int AS count FROM ingest_uid_failures`)) as unknown as {
      count: unknown
    }[]
  } catch (cause) {
    console.error('countFailingUids: query failed', { operation: 'countFailingUids', failure: loggableFailure(cause) })
    throw new DatabaseError('countFailingUids', 'Failed to count failing emails', { cause })
  }
  const count = Number(rows[0]?.count)
  if (Number.isSafeInteger(count) && count >= 0) return count
  throw new DatabaseError('countFailingUids', `count read back as ${String(rows[0]?.count)}; expected a count`)
}

/**
 * Deletes every counter that belongs to another UIDVALIDITY. Called when the
 * server reports a new one, which invalidates every stored UID at once.
 *
 * @param uidValidity The UIDVALIDITY to keep.
 * @throws {DatabaseError} when the delete fails.
 */
export async function clearOtherValidities(uidValidity: number): Promise<void> {
  try {
    await db.execute(sql`DELETE FROM ingest_uid_failures WHERE uid_validity <> ${uidValidity}`)
  } catch (cause) {
    console.error('clearOtherValidities: delete failed', { operation: 'clearOtherValidities', uidValidity, failure: loggableFailure(cause) })
    throw new DatabaseError('clearOtherValidities', `Failed to clear failure counters outside UIDVALIDITY ${uidValidity}`, { cause })
  }
}
