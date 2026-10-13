import { sql } from 'drizzle-orm'
import { db } from '@/db'
import { DatabaseError } from '@/lib/errors'
import { PENDING_REVIEW_ORDER_CLAUSE, REVIEW_QUEUE_STATUS_FILTER, type InboundPoSourceKind } from './inbound-pos'

/**
 * The review overlay's reads (Task 106): the queue as ids, and one row's
 * source joined to its email. The filter and sort are imported from
 * `inbound-pos.ts`, so this order can never drift from `listPendingReview`.
 */

/** One PO's source as the review overlay shows it. Customer data: never log it (SEC-05). */
export interface ReviewSourceRow {
  id: string
  source_kind: InboundPoSourceKind
  /** NULL exactly when `source_kind` is `email_body`. */
  document_path: string | null
  /** The email body for an `email_body` PO; NULL on files and refusals. */
  body_text: string | null
  /** `unknown`: its shape is owned by `lib/ingest/`; `lib/review/` narrows it. */
  check_results: unknown
  from_address: string | null
  subject: string | null
  /** ISO timestamp, or `null` when the email carried no date. */
  received_at: string | null
  message_id: string | null
}

/**
 * Every PO awaiting review, ids only, in review order: failed checks, then
 * never-skipped before skipped, then oldest first.
 *
 * @returns The ids, or `[]` when the queue is empty.
 * @throws {DatabaseError} when the query fails.
 */
export async function listReviewQueueIds(): Promise<string[]> {
  try {
    const rows = (await db.execute(sql`
      SELECT p.id
      FROM inbound_pos p
      WHERE ${REVIEW_QUEUE_STATUS_FILTER}
      ${PENDING_REVIEW_ORDER_CLAUSE}
    `)) as unknown as { id: string }[]
    return rows.map((row) => row.id)
  } catch (cause) {
    console.error('listReviewQueueIds: query failed', { operation: 'listReviewQueueIds' })
    throw new DatabaseError('listReviewQueueIds', 'Failed to load the review queue ids', { cause })
  }
}

/** `received_at` comes back as a Date or a string depending on the driver path. */
function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * One PO's source, joined to the email it came from.
 *
 * @param poId An `inbound_pos.id`, already validated as a UUID by the caller.
 * @returns The row, or `null` when no PO has that id.
 * @throws {DatabaseError} when the query fails. Only the id is logged.
 */
export async function getReviewSourceRow(poId: string): Promise<ReviewSourceRow | null> {
  let rows: (Omit<ReviewSourceRow, 'received_at'> & { received_at: unknown })[]
  try {
    rows = (await db.execute(sql`
      SELECT
        p.id, p.source_kind, p.document_path, p.body_text, p.check_results,
        e.from_address, e.subject, e.received_at, e.message_id
      FROM inbound_pos p
      JOIN inbound_emails e ON e.id = p.inbound_email_id
      WHERE p.id = ${poId}
      LIMIT 1
    `)) as unknown as typeof rows
  } catch (cause) {
    console.error('getReviewSourceRow: query failed', { operation: 'getReviewSourceRow', poId })
    throw new DatabaseError('getReviewSourceRow', `Failed to load the source of PO ${poId}`, { cause })
  }
  const row = rows[0]
  return row ? { ...row, received_at: toIsoOrNull(row.received_at) } : null
}
