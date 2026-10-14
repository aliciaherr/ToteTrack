'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import {
  lockReviewRow,
  markApproved,
  markDiscarded,
  markSkipped,
  reactivateCustomer,
} from '@/db/queries/review-decisions'
import { loggableFailure } from '@/lib/loggable-failure'
import { isUuid } from '@/lib/validators/uuid'
import { assertAuthenticated, GENERIC_FAILURE_MESSAGE } from './auth.guard'
import {
  DUPLICATE_PO_MESSAGE,
  afterOrderCreated,
  checkAddressOwnership,
  insertOrderRow,
  isUniqueViolation,
} from './orders.create'
import {
  createOrderInputSchema,
  firstZodMessage,
  type CreateOrderInput,
  type ValidatedCreate,
} from './orders.validation'

/**
 * The review pane's decisions (Task 108): Approve, Skip and Delete. Every
 * export is a client-callable endpoint (SEC-08), so each checks the session
 * first (SEC-04) and refuses a non-UUID id before any query (SEC-02). Only the
 * PO id is ever logged (SEC-05). The review badge polls `getIngestStatus`, so
 * no route here needs revalidating for the count.
 */

const ALREADY_HANDLED_MESSAGE = 'This PO was already handled.'
const INVALID_ID_MESSAGE = 'Invalid PO id.'

type ApproveResult = { orderId: string; reactivated: boolean } | { error: string }

/**
 * The approve transaction: lock the PO, insert the order linked to its
 * document, reactivate a dormant customer, mark the PO approved. Any throw
 * rolls all of it back.
 * @returns The new order, or `null` when the PO had left the queue (nothing written).
 */
function approveInTransaction(
  poId: string,
  input: CreateOrderInput,
  data: ValidatedCreate,
): Promise<{ orderId: string; reactivated: boolean } | null> {
  return db.transaction(async (tx) => {
    const row = await lockReviewRow(tx, poId)
    if (!row) return null
    const order = await insertOrderRow(tx, data, { document_url: row.documentPath })
    const reactivated = await reactivateCustomer(tx, data.customer_id)
    await markApproved(tx, poId, order.id, input)
    return { orderId: order.id, reactivated }
  })
}

/**
 * The post-commit bookkeeping: MRU address, order-screen revalidation, and
 * `/customers` when a dormant customer came back. The order already exists,
 * so a failure here is logged (EH-04) and never turned into an error result —
 * that would tell the reviewer the approve failed when it did not.
 */
async function afterApproveCommitted(
  poId: string,
  data: ValidatedCreate,
  approved: { orderId: string; reactivated: boolean },
): Promise<void> {
  try {
    await afterOrderCreated(data, approved.orderId)
    if (approved.reactivated) revalidatePath('/customers')
  } catch (error) {
    console.error('approveReviewPo: order created, but the post-commit step failed', {
      poId,
      orderId: approved.orderId,
      failure: loggableFailure(error),
    })
  }
}

/**
 * Approves a queued PO into a new order, validated exactly as `createOrder`
 * (SEC-02, SEC-03), in one transaction (see `approveInTransaction`). After the
 * commit, the MRU address bookkeeping and order-screen revalidation run as in
 * `createOrder`; a failure there is logged, not returned (`afterApproveCommitted`).
 *
 * @param poId The `inbound_pos.id` being approved.
 * @param input The order form as the reviewer submitted it; stored verbatim as `confirmed`.
 * @returns `{ orderId, reactivated }`, or `{ error }`: no session, bad id,
 *   invalid form, foreign address, duplicate PO number (the PO stays queued,
 *   unchanged), already handled, or a failure.
 */
export async function approveReviewPo(poId: string, input: CreateOrderInput): Promise<ApproveResult> {
  try {
    // Inside the try per auth.guard's contract — getUser() can itself throw.
    const denied = await assertAuthenticated()
    if (denied) return denied
    if (!isUuid(poId)) return { error: INVALID_ID_MESSAGE }

    const parsed = createOrderInputSchema.safeParse(input)
    if (!parsed.success) return { error: firstZodMessage(parsed.error) }
    const addressError = await checkAddressOwnership(parsed.data)
    if (addressError) return { error: addressError }

    const approved = await approveInTransaction(poId, input, parsed.data)
    if (!approved) return { error: ALREADY_HANDLED_MESSAGE }

    await afterApproveCommitted(poId, parsed.data, approved)
    return approved
  } catch (error) {
    if (isUniqueViolation(error)) return { error: DUPLICATE_PO_MESSAGE }
    console.error('approveReviewPo: could not approve the PO', {
      poId: isUuid(poId) ? poId : null,
      failure: loggableFailure(error),
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/** Shared body of Skip and Delete: auth, id check, one guarded write. */
async function decideQueuedPo(
  operation: string,
  poId: string,
  write: (poId: string) => Promise<boolean>,
): Promise<{ success: true } | { error: string }> {
  try {
    const denied = await assertAuthenticated()
    if (denied) return denied
    if (!isUuid(poId)) return { error: INVALID_ID_MESSAGE }
    return (await write(poId)) ? { success: true } : { error: ALREADY_HANDLED_MESSAGE }
  } catch (error) {
    console.error(`${operation}: could not update the PO`, {
      poId: isUuid(poId) ? poId : null,
      failure: loggableFailure(error),
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/**
 * Skips a queued PO: it goes to the back of the queue and stays counted.
 *
 * @param poId The `inbound_pos.id` being skipped.
 * @returns `{ success: true }`, or `{ error }`: no session, bad id, already
 *   handled, or a failure.
 */
export async function skipReviewPo(poId: string): Promise<{ success: true } | { error: string }> {
  return decideQueuedPo('skipReviewPo', poId, markSkipped)
}

/**
 * Deletes a queued PO as a soft `discarded`; the row and its file are kept.
 *
 * @param poId The `inbound_pos.id` being deleted.
 * @returns `{ success: true }`, or `{ error }`: no session, bad id, already
 *   handled, or a failure.
 */
export async function discardReviewPo(poId: string): Promise<{ success: true } | { error: string }> {
  return decideQueuedPo('discardReviewPo', poId, markDiscarded)
}
