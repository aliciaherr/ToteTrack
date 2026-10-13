import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { DatabaseError } from '@/lib/errors'

/**
 * The review-queue half of the ingestion data layer (Feature 16): the PO row
 * shapes, the duplicate lookup `stageEmailWithPos` runs, and the queue reads.
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

// The statuses the review queue reads. A constant so the list query and the
// count query can never drift onto different statuses and disagree about how
// many rows the badge should show. `extraction_failed` is listed too (FB-42,
// PRD): a PO the worker gave up on still reaches a human, as manual entry.
const REVIEW_QUEUE_STATUSES: readonly InboundPoStatus[] = ['pending_review', 'extraction_failed']

function statusIn(statuses: readonly InboundPoStatus[]): SQL {
  return sql`p.status IN (${sql.join(
    statuses.map((status) => sql`${status}`),
    sql`, `,
  )})`
}

const REVIEW_QUEUE_STATUS_FILTER: SQL = statusIn(REVIEW_QUEUE_STATUSES)

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
    WHERE ${REVIEW_QUEUE_STATUS_FILTER}
    ${PENDING_REVIEW_ORDER_CLAUSE}
  `
}

function buildPendingReviewCountQuery(): SQL {
  return sql`
    SELECT COUNT(*)::int AS count
    FROM inbound_pos p
    WHERE ${REVIEW_QUEUE_STATUS_FILTER}
  `
}

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

/**
 * Loads every PO awaiting human review (`pending_review` and
 * `extraction_failed`), ordered so the reviewer meets the
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
      statuses: REVIEW_QUEUE_STATUSES,
      cause,
    })
    throw new DatabaseError('listPendingReview', 'Failed to load the review queue', {
      cause,
    })
  }
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
    console.error('countUndecided: query failed', { operation: 'countUndecided', cause })
    throw new DatabaseError('countUndecided', 'Failed to count undecided POs', { cause })
  }
  return { toReview: toCount(rows[0]?.to_review, 'to_review'), beingRead: toCount(rows[0]?.being_read, 'being_read') }
}

/**
 * Counts the POs awaiting human review, `extraction_failed` included, for the nav badge. Its own round trip
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
      statuses: REVIEW_QUEUE_STATUSES,
      cause,
    })
    throw new DatabaseError('countPendingReview', 'Failed to count the review queue', {
      cause,
    })
  }
}
