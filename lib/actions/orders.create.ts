import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { orders } from '@/db/schema'
import { loggableFailure } from '@/lib/loggable-failure'
import type { ValidatedCreate } from './orders.validation'
import { normalizeCreate } from './orders.internal'
import {
  addressBelongsToCustomer,
  recordDeliveryAddressUsage,
} from './orders.addresses'

// Shared create-a-PO pieces for `createOrder` (orders.ts) and the review
// pane's approve path, which runs the same insert inside a transaction.
// No `'use server'` directive on purpose (SEC-08): a server-action file
// exports every async function as a client-callable endpoint, and these
// helpers skip auth and validation — their callers own both.

/** User-facing error when the insert trips the unique `po_number` constraint. */
export const DUPLICATE_PO_MESSAGE = 'PO number already exists.'

/** User-facing error when a submitted saved-address id fails the SEC-03 check. */
export const ADDRESS_NOT_OWNED_MESSAGE =
  'Selected delivery address does not belong to this customer.'

// Postgres unique-violation SQLSTATE. The orders table has a unique constraint
// on po_number; when it trips, the driver error has this code. Captured as
// a named constant so the catch block reads self-documenting.
const POSTGRES_UNIQUE_VIOLATION = '23505'

/**
 * Routes a PO appears on, revalidated whenever one is created, edited, or its
 * status changes: the orders list, the production calendar (the card lands in
 * the column its `production_date` names, and leaves the calendar entirely
 * when it is cancelled) and the dashboard (its production widget reads the
 * same column). `/dashboard`, not `/` — `app/page.tsx` only redirects, so
 * revalidating `/` would refresh nothing. Same set as
 * `CALENDAR_REVALIDATE_PATHS` in `calendar.ts`, plus the orders list.
 */
export const ORDER_REVALIDATE_PATHS = ['/orders', '/calendar', '/dashboard'] as const

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Where an order insert runs: the shared `db` handle or an open transaction. */
export type OrderExecutor = typeof db | Tx

/**
 * True when `cause` is a Postgres unique-violation (SQLSTATE 23505) — on the
 * orders table, a duplicate `po_number`.
 * @param cause Whatever the failed query threw.
 */
export function isUniqueViolation(cause: unknown): boolean {
  // Drizzle 0.45 wraps driver errors in `DrizzleQueryError` with the Postgres
  // error on `.cause`, so check both layers (same fix as `isMarkerViolation`
  // in inbound-emails.ts). A top-level-only check never matched in prod.
  const layers = [cause, (cause as { cause?: unknown } | null)?.cause]
  return layers.some(
    (layer) =>
      typeof layer === 'object' &&
      layer !== null &&
      (layer as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION,
  )
}

/**
 * SEC-03: a submitted saved-address id must belong to the submitted customer,
 * checked BEFORE the order insert so a forged id fails the whole create.
 * Skipped when the customer collects — no address is used at all — or when no
 * saved address was picked.
 * @param data Validated create payload.
 * @returns `ADDRESS_NOT_OWNED_MESSAGE` when the check fails, otherwise null.
 */
export async function checkAddressOwnership(
  data: ValidatedCreate,
): Promise<string | null> {
  if (data.customer_collects || !data.delivery_address_id) return null
  const owned = await addressBelongsToCustomer(
    data.delivery_address_id,
    data.customer_id,
  )
  return owned ? null : ADDRESS_NOT_OWNED_MESSAGE
}

/**
 * Inserts one order row built by `normalizeCreate`. Throws on failure (a
 * duplicate `po_number` surfaces as a unique violation — see
 * {@link isUniqueViolation}); the caller owns the catch.
 * @param executor `db`, or a transaction when the insert must land together
 *   with other writes.
 * @param data Validated create payload.
 * @param extra Column values merged over the normalized row (the review
 *   approve path passes `document_url`).
 */
export async function insertOrderRow(
  executor: OrderExecutor,
  data: ValidatedCreate,
  extra: Partial<typeof orders.$inferInsert> = {},
): Promise<{ id: string }> {
  const [row] = await executor
    .insert(orders)
    .values({ ...normalizeCreate(data), ...extra })
    .returning({ id: orders.id })
  return { id: row.id }
}

/**
 * Who called {@link afterOrderCreated}, for its failure log: the action name,
 * plus the review PO id on the approve path. Ids only (SEC-05).
 */
export interface AfterOrderContext {
  operation: string
  poId?: string
  /** True when the create also changed the customers list (a dormant customer came back). */
  customersChanged?: boolean
}

/**
 * Post-insert bookkeeping for a new PO. Call it once the order row is
 * committed — after the transaction, when the insert ran inside one — since
 * it writes on `db` and revalidates screens that must see the new row.
 *
 * Never throws: the order already exists, so a failure here is logged (EH-04)
 * and the caller still reports success. An error result would tell the user
 * the create failed and push them into a duplicate-PO retry.
 *
 * @param data Validated create payload.
 * @param orderId The new order's id, for the address-book and failure logs.
 * @param context The caller, for the failure log, and whether `/customers` must refresh.
 */
export async function afterOrderCreated(
  data: ValidatedCreate,
  orderId: string,
  context: AfterOrderContext,
): Promise<void> {
  try {
    // Feature 14 MRU bookkeeping (outside any transaction, on `db`): bump the
    // picked address, or dedupe/insert typed text. Contains its own
    // failures (see its JSDoc); true means the address book changed, which the
    // /customers detail panel renders.
    const addressBookChanged = await recordDeliveryAddressUsage(data, orderId)
    if (addressBookChanged || context.customersChanged) revalidatePath('/customers')
    // A new PO lands on three screens at once: the orders list, the calendar
    // column its `production_date` names, and the dashboard production widget
    // when that day is inside the widget's window. Revalidate all three or the
    // salesperson has to reload to see the card they just created.
    for (const path of ORDER_REVALIDATE_PATHS) revalidatePath(path)
  } catch (error) {
    console.error(`${context.operation}: order created, but the post-commit step failed`, {
      ...(context.poId ? { poId: context.poId } : {}),
      orderId,
      failure: loggableFailure(error),
    })
  }
}
