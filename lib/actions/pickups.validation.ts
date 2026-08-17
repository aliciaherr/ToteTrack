import { z } from 'zod'
import { UUID_RE } from '@/lib/validators/uuid'
import { calendarDateSchema } from './dates.validation'
import { DELIVERY_ADDRESS_MAX, NOTES_MAX, QUANTITY_MAX } from './orders.validation'

// Validation schemas + helpers for `lib/actions/pickups.ts`. CONSTRAINT-24:
// this file carries NO `'use server'` directive on purpose — the directive is
// the publication mechanism, so a helper module that wore it would become a
// second set of browser-callable endpoints. Everything here is imported
// directly by the action module and by nothing client-side.
//
// The shared limits (`QUANTITY_MAX`, `DELIVERY_ADDRESS_MAX`, `NOTES_MAX`) come
// from `orders.validation` rather than being re-declared — the same reuse
// `customers.ts` already relies on for `firstZodMessage` / `nullIfBlank` —
// and `UUID_RE` from the canonical `lib/validators/uuid`.

// Per-cell qty validator: ≥0 integer, capped to the shared QUANTITY_MAX. The
// "≥1 tote overall" invariant lives at the pickup level (275 + 330 > 0) and is
// enforced by `requireAtLeastOneQty` below.
const qtySchema = z
  .number()
  .int('Quantities must be whole numbers.')
  .min(0, 'Quantities must be 0 or greater.')
  .max(QUANTITY_MAX, `Quantities must be ${QUANTITY_MAX.toLocaleString('en-US')} or fewer.`)

interface PickupQuantities {
  qty_275: number
  qty_330: number
}

// A pickup that collects nothing is not a pickup. At least one of the two tote
// sizes must be greater than 0; the path lands on the 275 cell so the message
// surfaces next to the count grid in the form.
function requireAtLeastOneQty(data: PickupQuantities, ctx: z.RefinementCtx) {
  if (data.qty_275 + data.qty_330 <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['qty_275'],
      message: 'At least one quantity is required.',
    })
  }
}

// CONSTRAINT-21 makes the pickup row's `address` a text SNAPSHOT and
// `address_id` pure address-book bookkeeping. An id without text is therefore
// a self-contradicting pair: `recordDeliveryAddressUsage` would take its
// id branch and bump that saved address's `last_used_at` while the pickup row
// records no address at all. Reject the state at the boundary instead of
// letting the action silently drop the id — same idiom, same reason, as
// `requireDeliveryAddressWhenNotCollected` on the orders side. The picker
// cannot produce it (it writes text and id together), so this is defence in
// depth against a hand-rolled submit.
function requirePickedAddressText(
  data: { address?: string | null; address_id?: string | null },
  ctx: z.RefinementCtx,
) {
  if (data.address_id && (data.address ?? '').trim() === '') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['address'],
      message: 'Collection address text is required when a saved address is selected.',
    })
  }
}

const pickupBaseSchema = z.object({
  customer_id: z.string().regex(UUID_RE, 'Please choose a customer.'),
  qty_275: qtySchema,
  qty_330: qtySchema,
  // Optional — an absent date means the pickup is unscheduled and lives in the
  // calendar's callout. The form may submit "" before a date is chosen;
  // `nullIfBlank` normalizes that to NULL on write. `calendarDateSchema`
  // rejects impossible days (2026-02-31) with a message instead of letting
  // Postgres reject them as an opaque driver error; it carries NO
  // production-day rule — that belongs to production dates, and a pickup is
  // not production.
  pickup_date: calendarDateSchema.or(z.literal('')).nullable().optional(),
  // Optional. Unlike an order there is no "required unless…" rule — a pickup
  // from the customer's usual site needs no address at all. When present it is
  // snapshotted on the row AND remembered in the customer's address book
  // (CONSTRAINT-21).
  address: z.string().max(DELIVERY_ADDRESS_MAX).nullable().optional(),
  notes: z.string().max(NOTES_MAX).nullable().optional(),
})

// Create and update validate identically — a pickup has no create-only field
// (no PO number to make unique, no initial status to choose, no price to
// derive), so the two schemas are the base plus the same quantity invariant.
// They stay separate names so a future divergence has somewhere to land.
export const createPickupInputSchema = pickupBaseSchema
  .extend({
    // Id of the saved `customer_addresses` row the salesperson picked from the
    // address dropdown, so `createPickup` can bump its `last_used_at` instead
    // of re-upserting identical text. Null/absent when the address was typed
    // fresh ("+ Add new address") or left blank. Ownership — the row must
    // belong to `customer_id` — is verified in the action BEFORE the pickup
    // insert (SEC-03); this schema only guards the shape, exactly as
    // `createOrderInputSchema` does for `delivery_address_id`.
    address_id: z
      .string()
      .regex(UUID_RE, 'Invalid collection address id.')
      .nullable()
      .optional(),
  })
  .superRefine(requireAtLeastOneQty)
  .superRefine(requirePickedAddressText)

// The update schema intentionally has no `status` field. Status transitions
// are owned exclusively by `updatePickupStatus`; a status key sent to
// `updatePickup` is not whitelisted here and never reaches the column. It also
// has no `address_id`: edits keep snapshot semantics and never touch the
// address book, mirroring `updateOrderInputSchema`.
export const updatePickupInputSchema = pickupBaseSchema.superRefine(requireAtLeastOneQty)

export type CreatePickupInput = z.input<typeof createPickupInputSchema>
export type UpdatePickupInput = z.input<typeof updatePickupInputSchema>
export type ValidatedPickup = z.output<typeof createPickupInputSchema>

// Every pickup status is a legal transition target, unlike orders where
// `scheduled` is initial-only: a pickup carries no price, invoice or document,
// so reopening a completed or cancelled one has nothing to unwind. Which moves
// are actually allowed from the current state is decided by the transition map
// in the action.
export const updatePickupStatusInputSchema = z.object({
  target: z.enum(['scheduled', 'completed', 'cancelled']),
})

export type UpdatePickupStatusTarget = z.output<typeof updatePickupStatusInputSchema>['target']
