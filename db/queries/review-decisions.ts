import { and, eq, sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { customers } from '@/db/schema'
import type { CreateOrderInput } from '@/lib/actions/orders.validation'
import { DatabaseError } from '@/lib/errors'
import { REVIEW_QUEUE_STATUS_FILTER } from './inbound-pos'

/**
 * The review pane's decisions (Task 108): the row lock and the writes behind
 * Approve, Skip and Delete. Every write is guarded by the review-queue
 * statuses (`REVIEW_QUEUE_STATUS_FILTER`, shared with the queue reads), so a
 * PO already decided can never be decided again. Only ids are logged (SEC-05).
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Locks one PO row for the rest of `tx`, but only while it is still in the
 * review queue. A second approve waiting on the lock re-reads the row once the
 * first commits, finds it `approved`, and gets `null`.
 *
 * @param tx The approve transaction.
 * @param poId An `inbound_pos.id`, already validated as a UUID by the caller.
 * @returns The row's `documentPath` (NULL for an email-body PO), or `null`
 *   when the PO is no longer in the queue (already decided, or gone).
 * @throws {DatabaseError} when the query fails.
 */
export async function lockReviewRow(tx: Tx, poId: string): Promise<{ documentPath: string | null } | null> {
  try {
    const rows = (await tx.execute(sql`
      SELECT p.document_path
      FROM inbound_pos p
      WHERE p.id = ${poId} AND ${REVIEW_QUEUE_STATUS_FILTER}
      FOR UPDATE
    `)) as unknown as { document_path: string | null }[]
    return rows[0] ? { documentPath: rows[0].document_path } : null
  } catch (cause) {
    console.error('lockReviewRow: query failed', { operation: 'lockReviewRow', poId })
    throw new DatabaseError('lockReviewRow', `Failed to lock PO ${poId}`, { cause })
  }
}

/**
 * Marks a locked PO approved, linked to its new order, with the form exactly
 * as the reviewer submitted it — `confirmed` beside `extracted` is the
 * Feature 16 correction signal, so it is stored unnormalized.
 *
 * @param tx The approve transaction that locked the row.
 * @param poId The locked `inbound_pos.id`.
 * @param orderId The order inserted in the same transaction.
 * @param confirmed The submitted order form.
 * @throws {DatabaseError} when the update fails or no queued row matched.
 */
export async function markApproved(
  tx: Tx,
  poId: string,
  orderId: string,
  confirmed: CreateOrderInput,
): Promise<void> {
  let rows: { id: string }[]
  try {
    rows = (await tx.execute(sql`
      UPDATE inbound_pos p
      SET status = 'approved', order_id = ${orderId}, confirmed = ${JSON.stringify(confirmed)}::jsonb, updated_at = now()
      WHERE p.id = ${poId} AND ${REVIEW_QUEUE_STATUS_FILTER}
      RETURNING p.id
    `)) as unknown as { id: string }[]
  } catch (cause) {
    console.error('markApproved: query failed', { operation: 'markApproved', poId })
    throw new DatabaseError('markApproved', `Failed to approve PO ${poId}`, { cause })
  }
  // The row is locked in this transaction, so a miss means the caller skipped
  // the lock: fail loud and let the transaction roll back.
  if (rows.length === 0) {
    console.error('markApproved: no queued row matched', { operation: 'markApproved', poId })
    throw new DatabaseError('markApproved', `PO ${poId} was not in the review queue`)
  }
}

/**
 * Reactivates a customer the approved PO names, when it is inactive
 * (builder decision 1a: approving to a dormant customer brings it back).
 *
 * @param tx The approve transaction.
 * @param customerId A `customers.id`, already validated by the order schema.
 * @returns `true` when the customer was inactive and is now active.
 * @throws {DatabaseError} when the update fails.
 */
export async function reactivateCustomer(tx: Tx, customerId: string): Promise<boolean> {
  try {
    const rows = await tx
      .update(customers)
      .set({ status: 'active', updated_at: new Date() })
      .where(and(eq(customers.id, customerId), eq(customers.status, 'inactive')))
      .returning({ id: customers.id })
    return rows.length > 0
  } catch (cause) {
    console.error('reactivateCustomer: query failed', { operation: 'reactivateCustomer', customerId })
    throw new DatabaseError('reactivateCustomer', `Failed to reactivate customer ${customerId}`, { cause })
  }
}

/**
 * Runs one guarded single-row write on a queued PO.
 * @returns `true` when the row was still in the queue and was written.
 */
async function updateQueuedRow(operation: string, poId: string, set: SQL): Promise<boolean> {
  try {
    const rows = (await db.execute(sql`
      UPDATE inbound_pos p
      SET ${set}, updated_at = now()
      WHERE p.id = ${poId} AND ${REVIEW_QUEUE_STATUS_FILTER}
      RETURNING p.id
    `)) as unknown as { id: string }[]
    return rows.length > 0
  } catch (cause) {
    console.error(`${operation}: query failed`, { operation, poId })
    throw new DatabaseError(operation, `Failed to update PO ${poId}`, { cause })
  }
}

/**
 * Skips a queued PO: stamps `skipped_at = now()`, which sends it to the back
 * of the queue (`PENDING_REVIEW_ORDER_CLAUSE`). It stays counted.
 *
 * @param poId An `inbound_pos.id`, already validated as a UUID by the caller.
 * @returns `false` when the PO was already decided (or is gone).
 * @throws {DatabaseError} when the update fails.
 */
export async function markSkipped(poId: string): Promise<boolean> {
  return updateQueuedRow('markSkipped', poId, sql`skipped_at = now()`)
}

/**
 * Deletes a queued PO from the review queue as a soft `discarded`: the row and
 * its stored file are kept for the audit trail.
 *
 * @param poId An `inbound_pos.id`, already validated as a UUID by the caller.
 * @returns `false` when the PO was already decided (or is gone).
 * @throws {DatabaseError} when the update fails.
 */
export async function markDiscarded(poId: string): Promise<boolean> {
  return updateQueuedRow('markDiscarded', poId, sql`status = 'discarded'`)
}
