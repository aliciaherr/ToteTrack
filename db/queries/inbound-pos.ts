import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { DatabaseError } from '@/lib/errors'
import { loggableFailure } from '@/lib/loggable-failure'

/**
 * The review-queue half of the ingestion data layer (Feature 16): the PO row
 * shapes, the duplicate lookup `stageEmailWithPos` runs, the queue's shared
 * filter and order (read by `review-source.ts`), and the badge count.
 * Split from the original `inbound.ts` at its line cap (Task 99); the email
 * writes live in `inbound-emails.ts`, the watermark in `ingest-state.ts`.
 */

export type InboundPoSourceKind = 'image' | 'pdf' | 'email_body'

export type InboundPoStatus =
  | 'pending_extraction'
  | 'extracting'
  | 'pending_review'
  | 'approved'
  | 'discarded'
  | 'extraction_failed'

/**
 * One PO row as staged. `duplicate_of_id` is absent on purpose:
 * `stageEmailWithPos` resolves it inside its transaction, where it can see
 * sibling rows of the same email that a lookup before the write could not.
 */
export interface InsertInboundPoInput {
  source_kind: InboundPoSourceKind
  /** NULL exactly when `source_kind` is `email_body` — there is no stored file. */
  document_path: string | null
  /**
   * The normalised body, in full, for an `email_body` PO candidate; NULL on
   * every attachment row and every refusal. A CHECK (migration 0021) rejects
   * text on a `pdf` or `image` row. Required, so no writer can forget it.
   */
  body_text: string | null
  content_hash: string
  /**
   * Omitted on the normal path, so `status` and `attempt_count` keep their
   * column defaults and the starting state has one definition.
   */
  status?: InboundPoStatus
  /** Set on refused rows only; its shape is owned by `lib/ingest/`. */
  check_results?: unknown
}

// The statuses the review queue reads. One constant behind every queue read
// (`REVIEW_QUEUE_STATUS_FILTER`), so the queue `listReviewQueueIds` walks and
// the badge `countUndecided` shows can never drift onto different statuses. `extraction_failed` is listed too (FB-42,
// PRD): a PO the worker gave up on still reaches a human, as manual entry.
const REVIEW_QUEUE_STATUSES: readonly InboundPoStatus[] = ['pending_review', 'extraction_failed']

function statusIn(statuses: readonly InboundPoStatus[]): SQL {
  return sql`p.status IN (${sql.join(
    statuses.map((status) => sql`${status}`),
    sql`, `,
  )})`
}

/** The review-queue `WHERE` term, on alias `p`. Shared with `review-source.ts` (Task 106). */
export const REVIEW_QUEUE_STATUS_FILTER: SQL = statusIn(REVIEW_QUEUE_STATUSES)

// Rows still with the worker: staged and waiting, or claimed and being read.
// With REVIEW_QUEUE_STATUSES these are every status a human has not yet
// decided on — only `approved` and `discarded` are decisions.
const BEING_READ_STATUSES: readonly InboundPoStatus[] = ['pending_extraction', 'extracting']

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

// Review-queue ordering (Task 120 amendment, 2026-10-13).
// 1. `skipped_at` ASC NULLS FIRST: every unskipped row first, then skipped
//    rows in the order they were skipped, so Skip rotates through the whole
//    queue. Failures-first used to outrank a skip, so skipping a problem PO
//    brought it (or another problem PO) straight back and a clean row behind
//    them was never reached.
// 2. Then failed checks first among the unskipped (they tie on NULL) — where
//    a reviewer's attention is worth most.
// 3. Then `created_at` ASC — oldest first, so nothing starves at the bottom.
/** The review-queue `ORDER BY`, on alias `p`. Shared with `review-source.ts` (Task 106). */
export const PENDING_REVIEW_ORDER_CLAUSE: SQL = sql`
  ORDER BY
    p.skipped_at ASC NULLS FIRST,
    CASE WHEN ${HAS_CHECK_FAILURES} THEN 0 ELSE 1 END ASC,
    p.created_at ASC
`

// Earliest row carrying this hash — `ORDER BY created_at ASC` is load-bearing.
// Exported for `stageEmailWithPos`, which runs it inside its transaction.
// `content_hash` is deliberately not unique, so several rows can share one and
// `duplicate_of_id` must point at the *original* sighting. Without the
// ordering a later duplicate could be named as the original.
export function buildPoByContentHashQuery(hash: string): SQL {
  return sql`
    SELECT p.id
    FROM inbound_pos p
    WHERE p.content_hash = ${hash}
    ORDER BY p.created_at ASC
    LIMIT 1
  `
}

/** Every ingested PO no human has decided on yet, split by where it is. */
export interface UndecidedCounts {
  /** `pending_review` + `extraction_failed`, skipped rows included. */
  toReview: number
  /** `pending_extraction` + `extracting`: still with the worker. */
  beingRead: number
}

function toCount(value: unknown, column: string): number {
  const count = Number(value)
  if (Number.isSafeInteger(count) && count >= 0) return count
  throw new DatabaseError('countUndecided', `${column} read back as ${String(value)}; expected a count`)
}

/**
 * Counts every ingested PO without a decision, for the menu badge (Task 105).
 * Only approve or discard lowers it: a skipped row keeps `pending_review`, and
 * a row the worker has not finished is counted too, so nothing ingested can go
 * quiet before someone decides on it.
 *
 * @returns The two counts; both `0` when nothing is undecided.
 * @throws {DatabaseError} when the query fails or reads back a non-count.
 */
export async function countUndecided(): Promise<UndecidedCounts> {
  let rows: { to_review: unknown; being_read: unknown }[]
  try {
    rows = (await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE ${REVIEW_QUEUE_STATUS_FILTER})::int AS to_review,
        COUNT(*) FILTER (WHERE ${statusIn(BEING_READ_STATUSES)})::int AS being_read
      FROM inbound_pos p
    `)) as unknown as { to_review: unknown; being_read: unknown }[]
  } catch (cause) {
    console.error('countUndecided: query failed', { operation: 'countUndecided', failure: loggableFailure(cause) })
    throw new DatabaseError('countUndecided', 'Failed to count undecided POs', { cause })
  }
  return { toReview: toCount(rows[0]?.to_review, 'to_review'), beingRead: toCount(rows[0]?.being_read, 'being_read') }
}
