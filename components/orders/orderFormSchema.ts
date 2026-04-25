import type { OrderDetail } from '@/db/queries/orders'
import type { CreateOrderInput, UpdateOrderInput } from '@/lib/actions/orders.validation'

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
 * string round-trip would just re-parse on every keystroke. Price stays a
 * string because the native `<input type="number">` for currency benefits
 * from preserving the user's literal entry (trailing zeros, etc.).
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
  price: string
  pickup_only: boolean
  delivery_address: string
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
  price: '',
  pickup_only: false,
  delivery_address: '',
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
    price: detail.price,
    pickup_only: detail.pickup_only,
    delivery_address: detail.delivery_address ?? '',
    requested_delivery_date: detail.requested_delivery_date ?? '',
    backhaul: detail.backhaul,
    notes: detail.notes ?? '',
  }
}

function parseNumberOrZero(raw: string): number {
  const parsed = Number.parseFloat(raw.trim())
  return Number.isFinite(parsed) ? parsed : 0
}

function stringOrNull(raw: string): string | null {
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
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
 */
export function formValuesToCreateInput(values: OrderFormValues): CreateOrderInput {
  return {
    po_number: values.po_number.trim(),
    customer_id: values.customer_id,
    qty_275_recon: values.qty_275_recon,
    qty_275_rebot: values.qty_275_rebot,
    qty_275_new: values.qty_275_new,
    qty_330_recon: values.qty_330_recon,
    qty_330_rebot: values.qty_330_rebot,
    qty_330_new: values.qty_330_new,
    price: parseNumberOrZero(values.price),
    pickup_only: values.pickup_only,
    delivery_address: stringOrNull(values.delivery_address),
    requested_delivery_date: values.requested_delivery_date,
    backhaul: values.backhaul,
    initial_status: 'scheduled',
    notes: stringOrNull(values.notes),
  }
}

/**
 * Converts form values into the update-order action's input shape. The
 * `initial_status` field is dropped — status transitions go through
 * `updateOrderStatus`, not through the edit form.
 */
export function formValuesToUpdateInput(values: OrderFormValues): UpdateOrderInput {
  return {
    po_number: values.po_number.trim(),
    customer_id: values.customer_id,
    qty_275_recon: values.qty_275_recon,
    qty_275_rebot: values.qty_275_rebot,
    qty_275_new: values.qty_275_new,
    qty_330_recon: values.qty_330_recon,
    qty_330_rebot: values.qty_330_rebot,
    qty_330_new: values.qty_330_new,
    price: parseNumberOrZero(values.price),
    pickup_only: values.pickup_only,
    delivery_address: stringOrNull(values.delivery_address),
    requested_delivery_date: values.requested_delivery_date,
    backhaul: values.backhaul,
    notes: stringOrNull(values.notes),
  }
}
