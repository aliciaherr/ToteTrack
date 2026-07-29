import type { OrderDetail } from '@/db/queries/orders'
import {
  UNIT_PRICE_COMBOS,
  computeOrderPrice,
  nullIfBlank,
  type CreateOrderInput,
  type OrderQtyUnitPrices,
  type UpdateOrderInput,
} from '@/lib/actions/orders.validation'
import type { QtyGridValues, UnitPriceValues } from '@/components/shared/qtyGridValues'

/**
 * Shared Tailwind class string for every text/number/date input across the
 * order form. Extracted so sub-components stay visually identical without
 * copy-pasting the class list.
 */
export const FORM_INPUT_CLASS =
  'w-full h-11 px-3 text-sm rounded-md border border-border bg-card focus:outline-none focus:ring-2 focus:ring-ring'

/**
 * Form values shape. The 6 quantity cells are stored as numbers (not strings)
 * because QtyGrid is a controlled numeric component — bridging through a
 * string round-trip would just re-parse on every keystroke. The 6 per-combo
 * unit prices are `string | null` to match QtyGrid's input contract: each `$`
 * cell emits the user's literal entry as a string (preserving trailing zeros)
 * or `null` when blank. There is NO submitted `price` — the total is derived
 * server-side (Feature 10) via `computeOrderPrice`; the form only shows a
 * read-only live preview of it.
 */
export interface OrderFormValues {
  po_number: string
  customer_id: string
  qty_275_recon: number
  qty_275_rebot: number
  qty_275_new: number
  qty_330_recon: number
  qty_330_rebot: number
  qty_330_new: number
  unit_price_275_recon: string | null
  unit_price_275_rebot: string | null
  unit_price_275_new: string | null
  unit_price_330_recon: string | null
  unit_price_330_rebot: string | null
  unit_price_330_new: string | null
  pickup_only: boolean
  delivery_address: string
  /**
   * `customer_addresses` row id when the salesperson picked a saved address
   * from the dropdown (Feature 14); null when the address was typed fresh
   * ("+ Add new address") or is an edit-mode snapshot. Bridged through
   * setValue/watch by `AddressSelect` — never a registered input.
   */
  delivery_address_id: string | null
  requested_delivery_date: string
  backhaul: boolean
  notes: string
}

const todayIsoDate = (): string => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export const EMPTY_FORM_VALUES: OrderFormValues = {
  po_number: '',
  customer_id: '',
  qty_275_recon: 0,
  qty_275_rebot: 0,
  qty_275_new: 0,
  qty_330_recon: 0,
  qty_330_rebot: 0,
  qty_330_new: 0,
  unit_price_275_recon: null,
  unit_price_275_rebot: null,
  unit_price_275_new: null,
  unit_price_330_recon: null,
  unit_price_330_rebot: null,
  unit_price_330_new: null,
  pickup_only: false,
  delivery_address: '',
  delivery_address_id: null,
  requested_delivery_date: todayIsoDate(),
  backhaul: false,
  notes: '',
}

/**
 * Seeds `OrderFormValues` for the order form. Edit mode: maps the OrderDetail
 * row into the form's field shape. Create mode: returns `EMPTY_FORM_VALUES`,
 * optionally with the customer pre-selected when the caller provides a
 * locked customer id (e.g., deep link from `/orders?new=1&customerId=`).
 * @param detail Existing order detail (edit mode) or null / undefined for a new order.
 * @param lockedCustomerId Customer id to pre-select in create mode.
 */
export function detailToFormValues(
  detail: OrderDetail | null | undefined,
  lockedCustomerId?: string | null,
): OrderFormValues {
  if (!detail) {
    return {
      ...EMPTY_FORM_VALUES,
      customer_id: lockedCustomerId ?? '',
    }
  }
  return {
    po_number: detail.po_number,
    customer_id: detail.customer_id,
    qty_275_recon: detail.qty_275_recon,
    qty_275_rebot: detail.qty_275_rebot,
    qty_275_new: detail.qty_275_new,
    qty_330_recon: detail.qty_330_recon,
    qty_330_rebot: detail.qty_330_rebot,
    qty_330_new: detail.qty_330_new,
    unit_price_275_recon: detail.unit_price_275_recon,
    unit_price_275_rebot: detail.unit_price_275_rebot,
    unit_price_275_new: detail.unit_price_275_new,
    unit_price_330_recon: detail.unit_price_330_recon,
    unit_price_330_rebot: detail.unit_price_330_rebot,
    unit_price_330_new: detail.unit_price_330_new,
    pickup_only: detail.pickup_only,
    delivery_address: detail.delivery_address ?? '',
    // The stored address is a point-in-time snapshot, not a reference — it
    // starts with no saved-address id, so resubmitting an unchanged edit never
    // links (or duplicates) an address-book row (Feature 14).
    delivery_address_id: null,
    requested_delivery_date: detail.requested_delivery_date ?? '',
    backhaul: detail.backhaul,
    notes: detail.notes ?? '',
  }
}

/**
 * Parses one per-combo unit price into the action-input shape. A price is only
 * meaningful when its combo has qty > 0 — a qty-0 cell is forced to null so a
 * stale/left-over price never rides along (mirrors the server's
 * `normalizeUnitPrices`). Blank / unparseable entries also collapse to null.
 */
function toUnitPriceNumber(raw: string | number | null, qty: number): number | null {
  if (qty <= 0 || raw === null) return null
  const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw).trim())
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Projects the form's qty + unit-price fields onto the `OrderQtyUnitPrices`
 * shape the pricing helpers (`computeOrderPrice`, coupling checks) operate on.
 * Shared by the action-input transforms, the live total preview, and the
 * client-side coupling guard so all three read prices identically.
 */
export function formValuesToQtyUnitPrices(
  data: QtyGridValues & UnitPriceValues,
): OrderQtyUnitPrices {
  const out = {} as OrderQtyUnitPrices
  for (const combo of UNIT_PRICE_COMBOS) {
    const qty = data[combo.qtyKey]
    out[combo.qtyKey] = qty
    out[combo.priceKey] = toUnitPriceNumber(data[combo.priceKey], qty)
  }
  return out
}

/**
 * Server-derived total, previewed live in the form. Delegates to the
 * authoritative `computeOrderPrice` formula so the read-only preview can never
 * drift from what the server will persist.
 */
export function computeFormTotal(data: QtyGridValues & UnitPriceValues): string {
  return computeOrderPrice(formValuesToQtyUnitPrices(data))
}

/**
 * Client-side mirror of the server's `requireUnitPriceCoupling` superRefine:
 * every combo with qty > 0 must carry a unit price > 0. Returns the first
 * violation's message (matching the server text) or null when all combos pass,
 * so the form can block submit with an inline error before hitting the action.
 */
export function firstUnitPriceCouplingError(values: OrderFormValues): string | null {
  const data = formValuesToQtyUnitPrices(values)
  for (const combo of UNIT_PRICE_COMBOS) {
    const price = data[combo.priceKey]
    if (data[combo.qtyKey] > 0 && (price === null || price <= 0)) {
      return `Unit price for ${combo.label} is required and must be greater than $0.`
    }
  }
  return null
}

/**
 * Sums the 6 quantity cells. Used by the form's at-least-one-quantity
 * validator AND by the action input transforms (so a callsite can short-
 * circuit before invoking the server action when client knows the sum is 0).
 */
export function totalQuantity(values: OrderFormValues): number {
  return (
    values.qty_275_recon +
    values.qty_275_rebot +
    values.qty_275_new +
    values.qty_330_recon +
    values.qty_330_rebot +
    values.qty_330_new
  )
}

/**
 * Converts form values into the create-order action's input shape.
 * Numeric fields are parsed; empty string notes / address become null so the
 * Zod schema sees absent values consistently.
 *
 * @param values The form's current field values.
 * @param productionDate Build-day override as `yyyy-MM-dd`, supplied only when
 *   the PO is created from a calendar day column. The key is omitted entirely
 *   when absent, so the server keeps deriving the default from the delivery
 *   date exactly as it did before Feature 11 (CONSTRAINT-19). The form has no
 *   production-date field of its own — the day is chosen by clicking a column.
 */
export function formValuesToCreateInput(
  values: OrderFormValues,
  productionDate?: string | null,
): CreateOrderInput {
  return {
    po_number: values.po_number.trim(),
    customer_id: values.customer_id,
    ...formValuesToQtyUnitPrices(values),
    pickup_only: values.pickup_only,
    delivery_address: nullIfBlank(values.delivery_address),
    delivery_address_id: values.delivery_address_id,
    requested_delivery_date: values.requested_delivery_date,
    backhaul: values.backhaul,
    initial_status: 'scheduled',
    notes: nullIfBlank(values.notes),
    ...(productionDate ? { production_date: productionDate } : {}),
  }
}

/**
 * Converts form values into the update-order action's input shape. The
 * `initial_status` field is dropped — status transitions go through
 * `updateOrderStatus`, not through the edit form. `delivery_address_id` is
 * also intentionally dropped: edits keep snapshot semantics and never touch
 * the address book — MRU bumps and organic backfill happen only through
 * `createOrder` (Feature 14).
 */
export function formValuesToUpdateInput(values: OrderFormValues): UpdateOrderInput {
  return {
    po_number: values.po_number.trim(),
    customer_id: values.customer_id,
    ...formValuesToQtyUnitPrices(values),
    pickup_only: values.pickup_only,
    delivery_address: nullIfBlank(values.delivery_address),
    requested_delivery_date: values.requested_delivery_date,
    backhaul: values.backhaul,
    notes: nullIfBlank(values.notes),
  }
}
