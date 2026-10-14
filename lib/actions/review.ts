'use server'

import { getActiveCustomersForSelect } from '@/db/queries/customers.select'
import { getCustomersForReview, getReviewSourceRow, listReviewQueueIds, type ReviewSourceRow } from '@/db/queries/review-source'
import { loggableFailure } from '@/lib/loggable-failure'
import { storedCheckResultsOf } from '@/lib/review/review-fields.check-results'
import { reviewFieldsOf } from '@/lib/review/review-fields'
import type { ReviewCustomer, ReviewFields } from '@/lib/review/review-fields.types'
import { bodySourceOf, type ReviewSource } from '@/lib/review/review-source'
import { signPoDocument } from '@/lib/storage/po-document-url'
import { isUuid } from '@/lib/validators/uuid'
import { assertAuthenticated, GENERIC_FAILURE_MESSAGE } from './auth.guard'

/**
 * The review overlay's actions (Tasks 106 and 107). PDF and image rows get a
 * signed URL from the **session** client: the `po-documents` bucket lets any
 * signed-in user read it (migration 0003), so no secret key is needed here
 * (CONSTRAINT-38), and only for a key under `inbound/` (SEC-02, enforced by
 * `signPoDocument`). Only a PO id is ever logged (SEC-05).
 */

const NOT_FOUND_MESSAGE = 'This PO is no longer in the review queue.'
const INVALID_ID_MESSAGE = 'Invalid PO id.'

/**
 * Every PO awaiting review, in review order.
 *
 * @returns `{ ids }`, or `{ error }` with no session or when the read fails.
 */
export async function getReviewQueue(): Promise<{ ids: string[] } | { error: string }> {
  try {
    const denied = await assertAuthenticated()
    if (denied) return denied
    return { ids: await listReviewQueueIds() }
  } catch (error) {
    console.error('getReviewQueue: could not load the review queue', { failure: loggableFailure(error) })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/**
 * A 1-hour signed URL for a stored PO document, or `null` when the path is not
 * an `inbound/` key (refused by `signPoDocument`, SEC-02) or Storage refuses.
 */
async function signDocument(row: ReviewSourceRow & { document_path: string }): Promise<string | null> {
  const signed = await signPoDocument(row.document_path)
  if ('url' in signed) return signed.url
  console.error('getReviewSource: signing the document failed', {
    poId: row.id,
    storageError: signed.storageError,
  })
  return null
}

/**
 * What the review overlay's left pane shows for one PO.
 *
 * @param poId An `inbound_pos.id`; refused before any query unless it is a UUID (SEC-02).
 * @returns `{ source }`, or `{ error }` with no session, a bad id, an unknown
 *   PO, or a failed read or sign.
 */
export async function getReviewSource(poId: string): Promise<{ source: ReviewSource } | { error: string }> {
  try {
    const denied = await assertAuthenticated()
    if (denied) return denied
    if (!isUuid(poId)) return { error: INVALID_ID_MESSAGE }

    const row = await getReviewSourceRow(poId)
    if (!row) return { error: NOT_FOUND_MESSAGE }
    if (row.source_kind === 'email_body') return { source: bodySourceOf(row) }
    if (!row.document_path) {
      console.error('getReviewSource: file row has no document path', { poId })
      return { error: GENERIC_FAILURE_MESSAGE }
    }

    const url = await signDocument({ ...row, document_path: row.document_path })
    return url ? { source: { kind: row.source_kind, url } } : { error: GENERIC_FAILURE_MESSAGE }
  } catch (error) {
    console.error('getReviewSource: could not load the PO source', {
      poId: isUuid(poId) ? poId : null,
      failure: loggableFailure(error),
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/** Every customer id the stored match names: the candidates and the pre-fill. */
function matchedCustomerIds(checkResults: unknown): string[] {
  const match = storedCheckResultsOf(checkResults).customerMatch
  if (!match) return []
  const ids = match.candidates.map((candidate) => candidate.customerId)
  if (match.prefillCustomerId) ids.push(match.prefillCustomerId)
  return [...new Set(ids.filter(isUuid))]
}

/**
 * Every active customer for the full picker, plus any matched candidate that
 * is inactive, so the pane can show it and its addresses.
 */
function pickerCustomers(active: ReviewCustomer[], matched: ReviewCustomer[]): ReviewCustomer[] {
  const activeIds = new Set(active.map((customer) => customer.id))
  return [...active, ...matched.filter((customer) => !activeIds.has(customer.id))]
}

/**
 * The review overlay's right pane for one PO: the order form pre-filled from
 * the extraction, its flags, quotes and options (Task 107).
 *
 * @param poId An `inbound_pos.id`; refused before any query unless it is a UUID (SEC-02).
 * @returns `{ fields, customers }` (customers: every active one plus any
 *   inactive candidate, for the picker), or `{ error }` with no session, a bad
 *   id, an unknown PO, or a failed read.
 */
export async function getReviewFields(
  poId: string,
): Promise<{ fields: ReviewFields; customers: ReviewCustomer[] } | { error: string }> {
  try {
    const denied = await assertAuthenticated()
    if (denied) return denied
    if (!isUuid(poId)) return { error: INVALID_ID_MESSAGE }

    const row = await getReviewSourceRow(poId)
    if (!row) return { error: NOT_FOUND_MESSAGE }
    const [matched, active] = await Promise.all([
      getCustomersForReview(matchedCustomerIds(row.check_results)),
      getActiveCustomersForSelect(),
    ])
    const activeWithStatus = active.map((customer): ReviewCustomer => ({ ...customer, status: 'active' }))
    return { fields: reviewFieldsOf(row, matched), customers: pickerCustomers(activeWithStatus, matched) }
  } catch (error) {
    console.error('getReviewFields: could not load the PO fields', {
      poId: isUuid(poId) ? poId : null,
      failure: loggableFailure(error),
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}
