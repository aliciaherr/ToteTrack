'use server'

import { getOrderDocumentPath } from '@/db/queries/orders'
import { loggableFailure } from '@/lib/loggable-failure'
import { NOT_INBOUND_PATH, signPoDocument } from '@/lib/storage/po-document-url'
import { isUuid } from '@/lib/validators/uuid'
import { assertAuthenticated, GENERIC_FAILURE_MESSAGE } from './auth.guard'

/**
 * The order detail's "View PO document" (Task 121). Signs the order's stored
 * document with the **session** client (CONSTRAINT-38), and only when it is a
 * key under `inbound/` (SEC-02): any other `document_url` is never handed to
 * Storage. Only the order id is ever logged (SEC-05).
 */

const INVALID_ID_MESSAGE = 'Invalid order id.'
const NO_DOCUMENT_MESSAGE = 'No PO document on file.'

/**
 * A 1-hour signed link to the PO document an order was approved from.
 *
 * @param orderId An `orders.id`; refused before any query unless it is a UUID (SEC-02).
 * @returns `{ url }`, or `{ error }` with no session, a bad id, an unknown
 *   order, no document or one outside `inbound/`, or a failed read or sign.
 */
export async function getOrderDocumentUrl(orderId: string): Promise<{ url: string } | { error: string }> {
  try {
    const denied = await assertAuthenticated()
    if (denied) return denied
    if (!isUuid(orderId)) return { error: INVALID_ID_MESSAGE }

    const documentPath = await getOrderDocumentPath(orderId)
    if (documentPath === null) return { error: NO_DOCUMENT_MESSAGE }

    // signPoDocument refuses anything outside inbound/ before Storage (SEC-02).
    const signed = await signPoDocument(documentPath)
    if ('url' in signed) return { url: signed.url }
    if (signed.storageError === NOT_INBOUND_PATH) {
      console.error('getOrderDocumentUrl: stored document is not an inbound/ key; not signed', { orderId })
      return { error: NO_DOCUMENT_MESSAGE }
    }
    console.error('getOrderDocumentUrl: signing the document failed', { orderId, storageError: signed.storageError })
    return { error: GENERIC_FAILURE_MESSAGE }
  } catch (error) {
    console.error('getOrderDocumentUrl: could not load the PO document', {
      orderId: isUuid(orderId) ? orderId : null,
      failure: loggableFailure(error),
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}
