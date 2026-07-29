import { z } from 'zod'
import { ISO_DATE_RE, productionDateSchema } from './dates.validation'

// Validation schemas + helpers for `lib/actions/orders.ts`. Extracted as a
// non-`'use server'` sibling so non-async exports (Zod schemas, type aliases,
// regex/limit constants) can live alongside the action without violating the
// Platform-Native Rule that `'use server'` files export async functions only.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Re-exported, not defined here: the regex moved to `dates.validation` so the
// shared `productionDateSchema` could use it without closing an import cycle.
// Consumers keep importing it from this module.
export { ISO_DATE_RE }

export const PO_NUMBER_MAX = 40
export const DELIVERY_ADDRESS_MAX = 500
export const NOTES_MAX = 2000
export const QUANTITY_MAX = 100_000
// Exact max of the `price` column's `numeric(10, 2)` domain. Bounds BOTH each
// per-combo unit price AND the derived Σ(qty × unit price) total — Postgres
// overflows past this. Server-owned; the total is never a client input.
export const MAX_PRICE_USD = 9_999_999.99

// Per-cell qty validator: ≥0 integer, capped to QUANTITY_MAX. The "≥1"
// invariant lives at the PO level (sum > 0), enforced in `requireAtLeastOneQty`.
const qtySchema = z
  .number()
  .int('Quantities must be whole numbers.')
  .min(0, 'Quantities must be 0 or greater.')
  .max(QUANTITY_MAX)

// Per-combo unit price (Feature 10). Money → decimals allowed. Nullable: a
// combo with qty 0 carries no price. When present it must be > 0 and within
// the numeric(10,2) column domain. The qty↔price coupling (required when
// qty > 0, null when qty = 0) is enforced across fields in
// `requireUnitPriceCoupling` + normalized on write; the field schema only
// bounds the value when one is supplied.
const unitPriceSchema = z
  .number()
  .positive('Unit price must be greater than $0.')
  .max(MAX_PRICE_USD, `Unit price must be less than $${MAX_PRICE_USD.toLocaleString('en-US')}.`)
  // numeric(10,2) stores whole cents only. REJECT >2dp inputs (e.g. 25.005)
  // rather than silently rounding, so the stored unit price can never diverge
  // from what the salesperson entered — and so the derived total (computed
  // from the same 2dp-rounded prices) always matches the stored unit prices.
  // The round-trip through toFixed is float-safe where `.multipleOf(0.01)` is
  // not.
  .refine(
    (value) => Number(value.toFixed(2)) === value,
    'Unit price can have at most 2 decimal places.',
  )
  .nullable()

// The 6 fixed (size × type) combos (CONSTRAINT-09), each pairing its qty
// column with its unit-price column and a human label for EH-02 error
// messages. Single source of truth for the coupling refinement, the derived
// total, and the on-write null-normalization.
export const UNIT_PRICE_COMBOS = [
  { qtyKey: 'qty_275_recon', priceKey: 'unit_price_275_recon', label: '275 gal Reconditioned' },
  { qtyKey: 'qty_275_rebot', priceKey: 'unit_price_275_rebot', label: '275 gal Rebottled' },
  { qtyKey: 'qty_275_new', priceKey: 'unit_price_275_new', label: '275 gal Brand New' },
  { qtyKey: 'qty_330_recon', priceKey: 'unit_price_330_recon', label: '330 gal Reconditioned' },
  { qtyKey: 'qty_330_rebot', priceKey: 'unit_price_330_rebot', label: '330 gal Rebottled' },
  { qtyKey: 'qty_330_new', priceKey: 'unit_price_330_new', label: '330 gal Brand New' },
] as const

type QtyKey = (typeof UNIT_PRICE_COMBOS)[number]['qtyKey']
type UnitPriceKey = (typeof UNIT_PRICE_COMBOS)[number]['priceKey']

// Structural shape the pure pricing helpers operate on — satisfied by both
// ValidatedCreate and ValidatedUpdate (and the DB current-row snapshot for
// the qty portion).
export type OrderQtyUnitPrices = Record<QtyKey, number> & Record<UnitPriceKey, number | null>

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
  // Server owns the total (Feature 10). `price` is NOT a client input — it is
  // derived from these 6 unit prices × their qty in `computeOrderPrice`. Any
  // `price` key a client sends is ignored (not in this schema).
  unit_price_275_recon: unitPriceSchema,
  unit_price_275_rebot: unitPriceSchema,
  unit_price_275_new: unitPriceSchema,
  unit_price_330_recon: unitPriceSchema,
  unit_price_330_rebot: unitPriceSchema,
  unit_price_330_new: unitPriceSchema,
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

// Cross-field coupling (Feature 10): a combo with qty > 0 REQUIRES a unit
// price > 0. The inverse invariant — qty = 0 ⇒ unit price null — is enforced
// by clearing the cell on write (see `normalizeUnitPrices`) rather than
// rejecting, matching the PRD Feature 10 edge case "qty = 0 with unit price
// entered → cleared to NULL on save". Per-field path + EH-02 what/where message.
function requireUnitPriceCoupling(data: OrderQtyUnitPrices, ctx: z.RefinementCtx) {
  for (const combo of UNIT_PRICE_COMBOS) {
    const qty = data[combo.qtyKey]
    const unitPrice = data[combo.priceKey]
    if (qty > 0 && (unitPrice === null || unitPrice <= 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [combo.priceKey],
        message: `Unit price for ${combo.label} is required and must be greater than $0.`,
      })
    }
  }
}

// Cross-field bound on the DERIVED total (Feature 10). Each qty and unit price
// is bounded individually, but Σ(qty × unit price) can still exceed the
// numeric(10,2) column max and overflow Postgres — which would otherwise
// surface as the generic failure message. Reject early with a specific one.
function requireTotalWithinMax(data: OrderQtyUnitPrices, ctx: z.RefinementCtx) {
  const total = Number(computeOrderPrice(data))
  if (total > MAX_PRICE_USD) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      // Land on the first qty cell so the message surfaces near the grid,
      // matching requireAtLeastOneQty's placement.
      path: ['qty_275_recon'],
      message: `Order total exceeds the maximum of $${MAX_PRICE_USD.toLocaleString('en-US')}.`,
    })
  }
}

/**
 * Round a money value to whole cents — the numeric(10,2) precision the DB
 * stores. `computeOrderPrice` and `normalizeUnitPrices` MUST round identically
 * so the stored total can never diverge from the stored unit prices. The
 * unit-price schema already rejects >2dp inputs; this rounding keeps the
 * invariant intact regardless.
 */
function roundToCents(value: number): number {
  return Number(value.toFixed(2))
}

/**
 * Server-owned derived total: price = Σ(qty × unit price) over the 6 combos,
 * as a numeric(10,2) string. Cells with qty 0 or a null unit price contribute
 * nothing. Unit prices are rounded to whole cents BEFORE multiplying — the
 * same 2dp value `normalizeUnitPrices` persists — so the stored `price` always
 * equals Σ(stored unit_price × qty). The client never sends a trustworthy
 * total; this is the sole source of `orders.price`.
 */
export function computeOrderPrice(data: OrderQtyUnitPrices): string {
  let total = 0
  for (const combo of UNIT_PRICE_COMBOS) {
    const qty = data[combo.qtyKey]
    const unitPrice = data[combo.priceKey]
    if (qty > 0 && unitPrice !== null) total += qty * roundToCents(unitPrice)
  }
  return total.toFixed(2)
}

/**
 * On-write normalization of the 6 unit-price columns: keep the price only
 * where qty > 0 (as a numeric(10,2) string); force null on any qty-0 cell so
 * a stale/mis-sent price never persists against a zero quantity.
 */
export function normalizeUnitPrices(data: OrderQtyUnitPrices): Record<UnitPriceKey, string | null> {
  const out = {} as Record<UnitPriceKey, string | null>
  for (const combo of UNIT_PRICE_COMBOS) {
    const qty = data[combo.qtyKey]
    const unitPrice = data[combo.priceKey]
    out[combo.priceKey] = qty > 0 && unitPrice !== null ? unitPrice.toFixed(2) : null
  }
  return out
}

export const createOrderInputSchema = orderBaseSchema
  .extend({
    // Single in-flight state after the v2 PO model dropped `pending`.
    initial_status: z.literal('scheduled').default('scheduled'),
    // Feature 14: id of the saved `customer_addresses` row the salesperson
    // picked from the address dropdown, so `createOrder` can bump its
    // `last_used_at`. Null/absent when the address was typed fresh ("+ Add
    // new address") or the order is pickup-only. Ownership — the row must
    // belong to `customer_id` — is verified in the action BEFORE the order
    // insert (SEC-03); the schema only guards the shape.
    delivery_address_id: z
      .string()
      .regex(UUID_RE, 'Invalid delivery address id.')
      .nullable()
      .optional(),
    // Optional build-day override (Feature 11). Present only when the PO is
    // created from a calendar day column — the day whose `+` was clicked wins
    // over the delivery-date default, whatever delivery date the form carries
    // (CONSTRAINT-19: position is stored, never derived). Omitted everywhere
    // else, which leaves `normalizeCreate`'s existing default untouched.
    // Shares the calendar's no-weekend rule via `productionDateSchema`.
    production_date: productionDateSchema.optional(),
  })
  .superRefine(requireDeliveryAddressWhenNotPickup)
  .superRefine(requireAtLeastOneQty)
  .superRefine(requireUnitPriceCoupling)
  .superRefine(requireTotalWithinMax)

// The update schema intentionally has no `status` / `initial_status` field.
// Order status transitions are exclusively owned by `updateOrderStatus`; if
// an edit-form submission ever includes a status key, the object schema
// ignores it (not whitelisted here) and the .update().set(...) call in the
// action never references it, so the column stays unchanged.
export const updateOrderInputSchema = orderBaseSchema
  .superRefine(requireDeliveryAddressWhenNotPickup)
  .superRefine(requireAtLeastOneQty)
  .superRefine(requireUnitPriceCoupling)
  .superRefine(requireTotalWithinMax)

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
