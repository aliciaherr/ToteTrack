import type { OrderDetail } from '@/db/queries/orders'
import type { CreateOrderInput, UpdateOrderInput } from '@/lib/actions/orders'

/**
 * Shared Tailwind class string for every text/number/date input across the
 * order form. Extracted so sub-components stay visually identical without
 * copy-pasting the class list.
 */
export const FORM_INPUT_CLASS =
  'w-full h-11 px-3 text-sm rounded-md border border-border bg-card focus:outline-none focus:ring-2 focus:ring-ring'

export type ContainerSize = '275' | '330'
export type ContainerType = 'rebottled' | 'reconditioned' | 'brand_new'

export interface OrderFormValues {
  po_number: string
  customer_id: string
  container_size: ContainerSize
  container_type: ContainerType
  quantity: string
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
  container_size: '275',
  container_type: 'rebottled',
  quantity: '1',
  price: '',
  pickup_only: false,
  delivery_address: '',
  requested_delivery_date: todayIsoDate(),
  backhaul: false,
  notes: '',
}

/**
 * Seeds `OrderFormValues` for the order form. Edit mode: maps the OrderDetail
 * row into the form's string-shaped fields. Create mode: returns
 * `EMPTY_FORM_VALUES`, optionally with the customer pre-selected when the
 * caller provides a locked customer id (e.g., deep link from
 * `/orders?new=1&customerId=`).
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
    container_size: detail.container_size,
    container_type: detail.container_type,
    quantity: String(detail.quantity),
    price: detail.price,
    pickup_only: detail.pickup_only,
    delivery_address: detail.delivery_address ?? '',
    requested_delivery_date: detail.requested_delivery_date ?? '',
    backhaul: detail.backhaul,
    notes: detail.notes ?? '',
  }
}

function parseIntegerOrZero(raw: string): number {
  const parsed = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(parsed) ? parsed : 0
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
 * Converts form values into the create-order action's input shape.
 * Numeric fields are parsed; empty string notes / address become null so the
 * Zod schema sees absent values consistently.
 */
export function formValuesToCreateInput(values: OrderFormValues): CreateOrderInput {
  return {
    po_number: values.po_number.trim(),
    customer_id: values.customer_id,
    container_size: values.container_size,
    container_type: values.container_type,
    quantity: parseIntegerOrZero(values.quantity),
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
 * `updateOrderStatus` (Task 18), not through the edit form.
 */
export function formValuesToUpdateInput(values: OrderFormValues): UpdateOrderInput {
  return {
    po_number: values.po_number.trim(),
    customer_id: values.customer_id,
    container_size: values.container_size,
    container_type: values.container_type,
    quantity: parseIntegerOrZero(values.quantity),
    price: parseNumberOrZero(values.price),
    pickup_only: values.pickup_only,
    delivery_address: stringOrNull(values.delivery_address),
    requested_delivery_date: values.requested_delivery_date,
    backhaul: values.backhaul,
    notes: stringOrNull(values.notes),
  }
}
