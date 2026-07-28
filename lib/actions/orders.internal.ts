import { format } from 'date-fns'
import { orders } from '@/db/schema'
import type { PoStatus } from '@/db/queries/orders'
import { DB_DATE_FORMAT, parseDbDate, prevBusinessDay } from '@/lib/dates'
import {
  UNIT_PRICE_COMBOS,
  computeOrderPrice,
  normalizeUnitPrices,
  nullIfBlank,
  type ValidatedCreate,
  type ValidatedUpdate,
} from './orders.validation'

// Pure (non-`'use server'`) write-shaping + change-detection helpers for
// `lib/actions/orders.ts`. Kept out of the action file so the server module
// exports only async server actions (Platform-Native Rule) and stays under
// the CQ-02 service-file cap. No `'use server'` directive here on purpose.

/**
 * Column map for the current-row snapshot that `updateOrder` selects before
 * applying the qty/price edit lock. Extracted from the action so `updateOrder`
 * stays under the CQ-01 length cap. The inferred row shape of a select using
 * this map is the `current` argument to {@link detectQtyOrPriceChange}.
 */
export const QTY_AND_PRICE_SNAPSHOT_COLUMNS = {
  status: orders.status,
  qty_275_recon: orders.qty_275_recon,
  qty_275_rebot: orders.qty_275_rebot,
  qty_275_new: orders.qty_275_new,
  qty_330_recon: orders.qty_330_recon,
  qty_330_rebot: orders.qty_330_rebot,
  qty_330_new: orders.qty_330_new,
  price: orders.price,
  unit_price_275_recon: orders.unit_price_275_recon,
  unit_price_275_rebot: orders.unit_price_275_rebot,
  unit_price_275_new: orders.unit_price_275_new,
  unit_price_330_recon: orders.unit_price_330_recon,
  unit_price_330_rebot: orders.unit_price_330_rebot,
  unit_price_330_new: orders.unit_price_330_new,
} as const

/**
 * Current qty + unit-price + total snapshot of an order row, as read back from
 * the DB (numeric columns arrive as numeric(10,2) strings). Consumed by the
 * edit-lock check in {@link detectQtyOrPriceChange}.
 */
export interface QtyAndPriceSnapshot {
  status: PoStatus
  qty_275_recon: number
  qty_275_rebot: number
  qty_275_new: number
  qty_330_recon: number
  qty_330_rebot: number
  qty_330_new: number
  price: string
  unit_price_275_recon: string | null
  unit_price_275_rebot: string | null
  unit_price_275_new: string | null
  unit_price_330_recon: string | null
  unit_price_330_rebot: string | null
  unit_price_330_new: string | null
}

/**
 * Shared write-shape for both create and update (CQ-07): trims/normalizes the
 * common PO columns, derives the server-owned total, and null-normalizes any
 * qty-0 unit price. Callers layer on the mode-specific fields — `status` on
 * create, `updated_at` on update.
 */
function buildOrderWriteBase(data: ValidatedCreate | ValidatedUpdate) {
  return {
    po_number: data.po_number.trim(),
    customer_id: data.customer_id,
    qty_275_recon: data.qty_275_recon,
    qty_275_rebot: data.qty_275_rebot,
    qty_275_new: data.qty_275_new,
    qty_330_recon: data.qty_330_recon,
    qty_330_rebot: data.qty_330_rebot,
    qty_330_new: data.qty_330_new,
    // Server-derived total (Feature 10): price = Σ(qty × unit price).
    price: computeOrderPrice(data),
    // qty-0 cells normalized to null; qty>0 cells kept as numeric strings.
    ...normalizeUnitPrices(data),
    pickup_only: data.pickup_only,
    delivery_address: data.pickup_only ? null : nullIfBlank(data.delivery_address),
    requested_delivery_date: nullIfBlank(data.requested_delivery_date),
    backhaul: data.backhaul,
    notes: nullIfBlank(data.notes),
  }
}

/**
 * The build day a brand-new PO starts on: the business day before its promised
 * delivery date, or null when no delivery date was given.
 *
 * This is the **only** place a production date is ever derived from a delivery
 * date, and it happens **once**, at creation, as a stored value. Nothing
 * recomputes a card's position afterwards — a card's day *is* its
 * `production_date` (CONSTRAINT-19). Writing the default here instead of
 * deriving it on read is what lets `clearProductionPlacement` genuinely
 * unschedule an order rather than bounce it back to a computed day.
 *
 * An order created with no delivery date starts unscheduled, in the callout,
 * which is correct: nobody has decided when to build it. Adding a delivery date
 * later does not place it — that stays a deliberate act.
 *
 * `prevBusinessDay` guarantees a weekday, so the no-weekend invariant holds
 * without a separate check.
 */
export function defaultProductionDate(deliveryDate: string | null): string | null {
  if (deliveryDate === null) return null
  const delivery = parseDbDate('defaultProductionDate', deliveryDate)
  return format(prevBusinessDay(delivery), DB_DATE_FORMAT)
}

/**
 * Insert payload for a new PO: the shared write-base, the initial status, and
 * the starting production date so the PO appears on the calendar without
 * anyone having to drag it there.
 *
 * An explicit `production_date` — supplied only when the PO is created from a
 * calendar day column — is stored verbatim and beats the delivery-date default
 * outright, whatever delivery date the form carried. The salesperson picked
 * that column; deriving a different day from the promise would silently move
 * the card away from where they asked for it (CONSTRAINT-19). Its weekday and
 * calendar validity are already guaranteed by `createOrderInputSchema`.
 */
export function normalizeCreate(data: ValidatedCreate) {
  const base = buildOrderWriteBase(data)
  return {
    ...base,
    status: data.initial_status,
    production_date: data.production_date ?? defaultProductionDate(base.requested_delivery_date),
  }
}

/**
 * Update payload for an existing PO: the shared write-base plus a fresh
 * `updated_at`. Status is intentionally never written here — transitions are
 * owned exclusively by `updateOrderStatus`.
 */
export function normalizeUpdate(data: ValidatedUpdate) {
  return { ...buildOrderWriteBase(data), updated_at: new Date() }
}

/**
 * Edit lock (Feature 9 + 10): true when any qty cell, per-combo unit price, or
 * the derived total differs between the stored row and the incoming edit. Unit
 * prices are compared explicitly (not only via the derived total) for
 * robustness — both `current` and normalized `next` are numeric(10,2) strings
 * or null.
 */
export function detectQtyOrPriceChange(
  current: QtyAndPriceSnapshot,
  next: ValidatedUpdate,
): boolean {
  const nextUnitPrices = normalizeUnitPrices(next)
  for (const combo of UNIT_PRICE_COMBOS) {
    if (current[combo.qtyKey] !== next[combo.qtyKey]) return true
    if (current[combo.priceKey] !== nextUnitPrices[combo.priceKey]) return true
  }
  if (current.price !== computeOrderPrice(next)) return true
  return false
}
