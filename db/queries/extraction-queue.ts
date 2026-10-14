import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import type { CheckResults } from '@/lib/checks/types'
import type { ExtractedPo } from '@/lib/extraction/types'
import { DatabaseError } from '@/lib/errors'
import { loggableFailure, parameterFreeCause } from '@/lib/loggable-failure'
import type { InboundPoSourceKind } from './inbound-pos'

/**
 * The extraction worker's state machine on `inbound_pos` (Task 115, FB-42):
 *
 *   pending_extraction ──claimBatch──▶ extracting ──completeExtraction──▶ pending_review
 *          ▲                              │  └──────failExtraction───────▶ extraction_failed
 *          └────────releaseForRetry───────┘
 *
 * plus `extracting` rows whose lease expired, which `claimBatch` takes back.
 * The attempt is counted when a row is claimed, never after it is processed,
 * so a run killed mid-render still spends one (M-04 condition 1).
 *
 * `extraction_started_at` does double duty: on an `extracting` row it is the
 * lease; on a released `pending_extraction` row it is the release time, and
 * the row is not claimable until `retryDelayMs` has passed (MEDIUM-10).
 *
 * Every write after the claim is **fenced** on `status = 'extracting'` and
 * the claim's own lease stamp, so a worker that outlived its lease cannot
 * move a row another worker reclaimed (`LostClaimError`).
 */

/** The two waits a claim honours, from `ingest.constants.ts`. */
export interface ClaimTiming {
  /** `EXTRACTION_LEASE_MS`: an `extracting` row older than this is reclaimed. */
  leaseMs: number
  /** `EXTRACTION_RETRY_DELAY_MS`: a released row younger than this is skipped. */
  retryDelayMs: number
}

/** One claimed row: what the worker needs to load and extract it. */
export interface ClaimedPo {
  id: string
  source_kind: InboundPoSourceKind
  document_path: string | null
  body_text: string | null
  /** Already incremented for this claim. */
  attempt_count: number
  /**
   * The lease stamp this claim wrote to `extraction_started_at`: the claim's
   * `now`, set on the row by the claim query. Every later write for this row
   * is fenced on it, so a worker that outlived its lease cannot overwrite a
   * row another worker has since reclaimed (see `fencedWrite`).
   */
  extraction_started_at: Date
}

/** What a worker write is fenced on: the row and the lease its claim stamped. */
export type ClaimFence = Pick<ClaimedPo, 'id' | 'extraction_started_at'>

/**
 * A worker's write matched no row: the row is no longer `extracting` under
 * this claim's lease. Another worker reclaimed it after the lease expired,
 * and it may since have been completed, reviewed or approved. The write
 * changed nothing, which is the point: writing anyway could pull an approved
 * row back into the queue and produce a duplicate order.
 */
export class LostClaimError extends Error {
  readonly rowId: string
  readonly operation: string

  constructor(operation: string, rowId: string) {
    super(`${operation}: inbound_pos ${rowId} is no longer held by this claim; nothing was written`)
    this.name = 'LostClaimError'
    this.rowId = rowId
    this.operation = operation
  }
}

/**
 * The claim, in one statement. The inner SELECT locks its rows with
 * `FOR UPDATE SKIP LOCKED`, so a concurrent claim skips them instead of
 * waiting and then double-claiming; by the time it could see them again they
 * are `extracting` with a fresh lease and no longer match. Oldest first, so the
 * queue drains in arrival order. A released row waits out the retry delay.
 * A lease-less `extracting` row cannot be
 * produced by this module, but is reclaimed rather than stranded if one exists.
 *
 * The SELECT is a MATERIALIZED CTE, never `WHERE id IN (SELECT … LIMIT)`: on a
 * small table the planner runs that as a nested-loop semi join and re-runs the
 * subquery per outer row, so the LIMIT is not honoured and one claim takes
 * every waiting row (CONSTRAINT-40).
 */
export function buildClaimBatchQuery(limit: number, timing: ClaimTiming, now: Date): SQL {
  const claimedAt = now.toISOString()
  const leaseExpiredBefore = new Date(now.getTime() - timing.leaseMs).toISOString()
  const releasedBefore = new Date(now.getTime() - timing.retryDelayMs).toISOString()
  return sql`
    WITH claimable AS MATERIALIZED (
      SELECT q.id
      FROM inbound_pos q
      WHERE (q.status = 'pending_extraction'
             AND (q.extraction_started_at IS NULL OR q.extraction_started_at < ${releasedBefore}::timestamptz))
         OR (q.status = 'extracting'
             AND (q.extraction_started_at IS NULL OR q.extraction_started_at < ${leaseExpiredBefore}::timestamptz))
      ORDER BY q.created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE inbound_pos p
    SET status = 'extracting',
        attempt_count = p.attempt_count + 1,
        extraction_started_at = ${claimedAt}::timestamptz,
        updated_at = ${claimedAt}::timestamptz
    FROM claimable
    WHERE p.id = claimable.id
    RETURNING p.id, p.source_kind, p.document_path, p.body_text, p.attempt_count
  `
}

/**
 * Runs one write, logging and rethrowing a failure without its params: the
 * extraction JSON is document text, and drizzle's error message lists params
 * (MEDIUM-08, SEC-05). The row ID is ours and safe to log.
 */
async function runWrite(operation: string, rowId: string | null, query: SQL): Promise<unknown> {
  try {
    return await db.execute(query)
  } catch (error) {
    console.error(`${operation}: query failed`, { operation, rowId, failure: loggableFailure(error) })
    throw new DatabaseError(operation, `Failed on inbound_pos ${rowId ?? '(batch claim)'}`, {
      cause: parameterFreeCause(error),
    })
  }
}

/**
 * Claims up to `limit` rows for extraction: `pending_extraction` rows that
 * are new or past their retry delay, and `extracting` rows past their lease.
 * Each claimed row moves to `extracting`, gains one attempt and a fresh lease,
 * atomically. Two concurrent calls never return the same row.
 *
 * @param limit Most rows to claim; the worker claims one at a time (MEDIUM-09).
 * @param timing Lease and retry delay.
 * @param now The claim time; both waits are measured from it.
 * @returns The claimed rows, oldest first; `[]` when the queue is empty.
 * @throws {DatabaseError} when the claim fails; nothing is claimed then.
 */
export async function claimBatch(limit: number, timing: ClaimTiming, now: Date): Promise<ClaimedPo[]> {
  const rows = (await runWrite('claimBatch', null, buildClaimBatchQuery(limit, timing, now))) as Omit<
    ClaimedPo,
    'extraction_started_at'
  >[]
  // The claim stamped exactly `now` (ms precision fits timestamptz), so the
  // fence is known without widening the claim's RETURNING (CONSTRAINT-40).
  return rows.map((row) => ({ ...row, extraction_started_at: now }))
}

/**
 * Runs one write that only lands while the row is still `extracting` under
 * this claim's lease. `query` must end in the fence and `RETURNING id`; no row
 * back means the claim was lost.
 *
 * @throws {LostClaimError} when no row matched; logged by row ID first.
 * @throws {DatabaseError} when the write itself fails.
 */
async function fencedWrite(operation: string, claim: ClaimFence, query: SQL): Promise<void> {
  const rows = (await runWrite(operation, claim.id, query)) as unknown[]
  if (rows.length > 0) return
  console.error(`${operation}: lost the claim; the row moved on under another worker, nothing was written`, {
    operation,
    rowId: claim.id,
    claimedAt: claim.extraction_started_at.toISOString(),
  })
  throw new LostClaimError(operation, claim.id)
}

/** `WHERE` clause shared by every fenced write: this row, still under this claim's lease. */
function claimFence(claim: ClaimFence): SQL {
  return sql`id = ${claim.id}
      AND status = 'extracting'
      AND extraction_started_at = ${claim.extraction_started_at.toISOString()}::timestamptz`
}

/**
 * Stores a successful extraction and moves the row to `pending_review`.
 * The source text is not a parameter: it is never persisted (MEDIUM-07).
 *
 * @param claim The claimed row and its lease stamp.
 * @param extracted The validated extraction.
 * @param checkResults Checks plus the customer match.
 * @throws {LostClaimError} when the row is no longer held by this claim.
 * @throws {DatabaseError} when the write fails.
 */
export async function completeExtraction(
  claim: ClaimFence,
  extracted: ExtractedPo,
  checkResults: CheckResults,
): Promise<void> {
  await fencedWrite('completeExtraction', claim, sql`
    UPDATE inbound_pos
    SET status = 'pending_review',
        extracted = ${JSON.stringify(extracted)}::jsonb,
        check_results = ${JSON.stringify(checkResults)}::jsonb,
        extraction_started_at = NULL,
        updated_at = now()
    WHERE ${claimFence(claim)}
    RETURNING id
  `)
}

/**
 * Parks the row at `extraction_failed`, where the review queue shows it for
 * manual entry (FB-42). Never retried after this.
 *
 * @param claim The claimed row and its lease stamp.
 * @param checkResults Holds the `extraction_failed` entry naming the cause.
 * @throws {LostClaimError} when the row is no longer held by this claim.
 * @throws {DatabaseError} when the write fails.
 */
export async function failExtraction(claim: ClaimFence, checkResults: CheckResults): Promise<void> {
  await fencedWrite('failExtraction', claim, sql`
    UPDATE inbound_pos
    SET status = 'extraction_failed',
        check_results = ${JSON.stringify(checkResults)}::jsonb,
        extraction_started_at = NULL,
        updated_at = now()
    WHERE ${claimFence(claim)}
    RETURNING id
  `)
}

/**
 * Returns the row to `pending_extraction` after a transient failure. It is
 * stamped with the release time, so no claim takes it again until the retry
 * delay has passed (MEDIUM-10). The attempt it used stays counted.
 *
 * The release time is the worker's clock, the same clock the claim and its
 * retry-delay check use, so DB/app clock skew cannot shorten the delay.
 *
 * @param claim The claimed row and its lease stamp.
 * @param now The release time.
 * @throws {LostClaimError} when the row is no longer held by this claim.
 * @throws {DatabaseError} when the write fails; the lease then reclaims it.
 */
export async function releaseForRetry(claim: ClaimFence, now: Date): Promise<void> {
  const releasedAt = now.toISOString()
  await fencedWrite('releaseForRetry', claim, sql`
    UPDATE inbound_pos
    SET status = 'pending_extraction',
        extraction_started_at = ${releasedAt}::timestamptz,
        updated_at = ${releasedAt}::timestamptz
    WHERE ${claimFence(claim)}
    RETURNING id
  `)
}
