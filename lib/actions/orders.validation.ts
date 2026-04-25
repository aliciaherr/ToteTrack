import { z } from 'zod'

// Validation schemas + helpers for `lib/actions/orders.ts`. Extracted as a
// non-`'use server'` sibling so non-async exports (Zod schemas, type aliases,
// regex/limit constants) can live alongside the action without violating the
// Platform-Native Rule that `'use server'` files export async functions only.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const PO_NUMBER_MAX = 40
export const DELIVERY_ADDRESS_MAX = 500
export const NOTES_MAX = 2000
export const QUANTITY_MAX = 100_000
// Exact max of the `price` column's `numeric(10, 2)` domain. Kept in sync
// with MAX_PRICE_USD in components/orders/OrderContainerFields.tsx —
// client-side mirroring is the project pattern since action files are
// `'use server'` and can't be imported from client components.
export const MAX_PRICE_USD = 9_999_999.99

// Per-cell qty validator: ≥0 integer, capped to QUANTITY_MAX. The "≥1"
// invariant lives at the PO level (sum > 0), enforced in `requireAtLeastOneQty`.
const qtySchema = z
  .number()
  .int('Quantities must be whole numbers.')
  .min(0, 'Quantities must be 0 or greater.')
  .max(QUANTITY_MAX)

const orderBaseSchema = z.object({
  po_number: z
    .string()
    .min(1, 'PO number is required.')
    .max(PO_NUMBER_MAX, `PO number must be ${PO_NUMBER_MAX} characters or fewer.`),
  customer_id: z.string().regex(UUID_RE, 'Please choose a customer.'),
  qty_275_recon: qtySchema,
  qty_275_rebot: qtySchema,
  qty_275_new: qtySchema,
  qty_330_recon: qtySchema,
  qty_330_rebot: qtySchema,
  qty_330_new: qtySchema,
  price: z
    .number()
    .positive('Price must be greater than $0.')
    .max(MAX_PRICE_USD, `Price must be less than $${MAX_PRICE_USD.toLocaleString('en-US')}.`),
  pickup_only: z.boolean(),
  delivery_address: z.string().max(DELIVERY_ADDRESS_MAX).nullable().optional(),
  // Optional. Form may submit empty string ("") when the salesperson hasn't
  // committed to a delivery date yet — normalize to null before persisting.
  // `updateOrderStatus` auto-sets this to CURRENT_DATE when an undated order
  // is marked complete (see CONSTRAINT-16).
  requested_delivery_date: z
    .string()
    .regex(ISO_DATE_RE, 'Invalid date format.')
    .or(z.literal(''))
    .nullable()
    .optional(),
  backhaul: z.boolean(),
  notes: z.string().max(NOTES_MAX).nullable().optional(),
})

function requireDeliveryAddressWhenNotPickup(
  data: { pickup_only: boolean; delivery_address?: string | null },
  ctx: z.RefinementCtx,
) {
  if (!data.pickup_only) {
    const trimmed = (data.delivery_address ?? '').trim()
    if (!trimmed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['delivery_address'],
        message: 'Delivery address is required when not pickup-only.',
      })
    }
  }
}

interface QtyOnly {
  qty_275_recon: number
  qty_275_rebot: number
  qty_275_new: number
  qty_330_recon: number
  qty_330_rebot: number
  qty_330_new: number
}

function requireAtLeastOneQty(data: QtyOnly, ctx: z.RefinementCtx) {
  const total =
    data.qty_275_recon + data.qty_275_rebot + data.qty_275_new +
    data.qty_330_recon + data.qty_330_rebot + data.qty_330_new
  if (total <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      // Path lands on the first qty cell so the error surfaces near the
      // grid in the form. Form code can render the message at grid level
      // rather than per cell.
      path: ['qty_275_recon'],
      message: 'At least one quantity is required.',
    })
  }
}

export const createOrderInputSchema = orderBaseSchema
  .extend({
    // Single in-flight state after the v2 PO model dropped `pending`.
    initial_status: z.literal('scheduled').default('scheduled'),
  })
  .superRefine(requireDeliveryAddressWhenNotPickup)
  .superRefine(requireAtLeastOneQty)

// The update schema intentionally has no `status` / `initial_status` field.
// Order status transitions are exclusively owned by `updateOrderStatus`; if
// an edit-form submission ever includes a status key, the object schema
// ignores it (not whitelisted here) and the .update().set(...) call in the
// action never references it, so the column stays unchanged.
export const updateOrderInputSchema = orderBaseSchema
  .superRefine(requireDeliveryAddressWhenNotPickup)
  .superRefine(requireAtLeastOneQty)

export type CreateOrderInput = z.input<typeof createOrderInputSchema>
export type UpdateOrderInput = z.input<typeof updateOrderInputSchema>
export type ValidatedCreate = z.output<typeof createOrderInputSchema>
export type ValidatedUpdate = z.output<typeof updateOrderInputSchema>

// The status-transition schema intentionally excludes 'scheduled' and
// 'invoiced' as target states. 'scheduled' is an initial-only state set at
// creation time; 'invoiced' is set exclusively by the invoice-creation
// action.
export const updateOrderStatusInputSchema = z.object({
  newStatus: z.enum(['completed', 'cancelled']),
})

export type UpdateOrderStatusTarget = z.output<typeof updateOrderStatusInputSchema>['newStatus']

export function nullIfBlank(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

export function firstZodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input.'
}
