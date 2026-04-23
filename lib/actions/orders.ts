'use server'

import { eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/db'
import { orders, invoices } from '@/db/schema'
import { createClient } from '@/lib/supabase/server'
import type { PoStatus } from '@/db/queries/orders'

// User-facing fallback for any server-side failure that isn't a validation,
// auth, or unique-constraint rejection. Detailed cause is logged server-side
// via console.error — never surfaced to the client (SEC-05, EH-04).
const GENERIC_FAILURE_MESSAGE = 'Something went wrong. Please try again.'
const DUPLICATE_PO_MESSAGE = 'PO number already exists.'

// Postgres unique-violation SQLSTATE. The orders table has a unique constraint
// on po_number; when it trips, the driver error has this code. Captured as
// a named constant so the catch block reads self-documenting.
const POSTGRES_UNIQUE_VIOLATION = '23505'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const PO_NUMBER_MAX = 40
const DELIVERY_ADDRESS_MAX = 500
const NOTES_MAX = 2000
const QUANTITY_MAX = 100_000
// Exact max of the `price` column's `numeric(10, 2)` domain. Kept in sync with
// MAX_PRICE_USD in components/orders/OrderContainerFields.tsx — client-side
// mirroring is the project pattern since action files are `'use server'`.
const MAX_PRICE_USD = 9_999_999.99

const orderBaseSchema = z.object({
  po_number: z
    .string()
    .min(1, 'PO number is required.')
    .max(PO_NUMBER_MAX, `PO number must be ${PO_NUMBER_MAX} characters or fewer.`),
  customer_id: z.string().regex(UUID_RE, 'Please choose a customer.'),
  container_size: z.enum(['275', '330']),
  container_type: z.enum(['rebottled', 'reconditioned', 'brand_new']),
  quantity: z
    .number()
    .int('Quantity must be a whole number.')
    .min(1, 'Quantity must be at least 1.')
    .max(QUANTITY_MAX),
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

const createOrderInputSchema = orderBaseSchema
  .extend({
    // Single in-flight state after the v2 PO model dropped `pending`.
    initial_status: z.literal('scheduled').default('scheduled'),
  })
  .superRefine(requireDeliveryAddressWhenNotPickup)

// The update schema intentionally has no `status` / `initial_status` field.
// Order status transitions are exclusively owned by `updateOrderStatus`
// (Task 18); if an edit-form submission ever includes a status key, the
// object schema ignores it (not whitelisted here) and the .update().set(...)
// call below never references it, so the column stays unchanged.
const updateOrderInputSchema = orderBaseSchema.superRefine(
  requireDeliveryAddressWhenNotPickup,
)

export type CreateOrderInput = z.input<typeof createOrderInputSchema>
export type UpdateOrderInput = z.input<typeof updateOrderInputSchema>
type ValidatedCreate = z.output<typeof createOrderInputSchema>
type ValidatedUpdate = z.output<typeof updateOrderInputSchema>

function nullIfBlank(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function firstZodMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid input.'
}

async function assertAuthenticated(): Promise<{ error: string } | null> {
  const supabase = createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return { error: 'You are not signed in.' }
  return null
}

function isUniqueViolation(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION
  )
}

function normalizeCreate(data: ValidatedCreate) {
  return {
    po_number: data.po_number.trim(),
    customer_id: data.customer_id,
    status: data.initial_status,
    container_size: data.container_size,
    container_type: data.container_type,
    quantity: data.quantity,
    price: data.price.toFixed(2),
    pickup_only: data.pickup_only,
    delivery_address: data.pickup_only ? null : nullIfBlank(data.delivery_address),
    requested_delivery_date: nullIfBlank(data.requested_delivery_date),
    backhaul: data.backhaul,
    notes: nullIfBlank(data.notes),
  }
}

function normalizeUpdate(data: ValidatedUpdate) {
  return {
    po_number: data.po_number.trim(),
    customer_id: data.customer_id,
    container_size: data.container_size,
    container_type: data.container_type,
    quantity: data.quantity,
    price: data.price.toFixed(2),
    pickup_only: data.pickup_only,
    delivery_address: data.pickup_only ? null : nullIfBlank(data.delivery_address),
    requested_delivery_date: nullIfBlank(data.requested_delivery_date),
    backhaul: data.backhaul,
    notes: nullIfBlank(data.notes),
    updated_at: new Date(),
  }
}

/**
 * Creates a new purchase order. Validates input server-side via Zod (PO#,
 * quantity ≥ 1, price > 0, delivery address required when not pickup-only);
 * rejects duplicate `po_number` via Postgres unique-violation (23505) with a
 * user-facing message. Returns the new order id on success.
 * @param input Order data including `initial_status` (defaults to 'scheduled').
 */
export async function createOrder(
  input: CreateOrderInput,
): Promise<{ id: string } | { error: string }> {
  const authError = await assertAuthenticated()
  if (authError) return authError

  const parsed = createOrderInputSchema.safeParse(input)
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    const [row] = await db
      .insert(orders)
      .values(normalizeCreate(parsed.data))
      .returning({ id: orders.id })
    revalidatePath('/orders')
    return { id: row.id }
  } catch (cause) {
    if (isUniqueViolation(cause)) return { error: DUPLICATE_PO_MESSAGE }
    console.error('createOrder: insert failed', { cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/**
 * Updates an existing purchase order's non-status fields. Status transitions
 * are intentionally NOT editable here — use `updateOrderStatus` (Task 18).
 * Rejects a malformed id before touching the database; maps PO# conflicts to
 * a user-facing message.
 * @param id UUID of the order to update.
 * @param input Updated order data (no status field).
 */
export async function updateOrder(
  id: string,
  input: UpdateOrderInput,
): Promise<{ success: true } | { error: string }> {
  const authError = await assertAuthenticated()
  if (authError) return authError

  if (!UUID_RE.test(id)) return { error: 'Invalid order id.' }

  const parsed = updateOrderInputSchema.safeParse(input)
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    await db
      .update(orders)
      .set(normalizeUpdate(parsed.data))
      .where(eq(orders.id, id))
    revalidatePath('/orders')
    return { success: true }
  } catch (cause) {
    if (isUniqueViolation(cause)) return { error: DUPLICATE_PO_MESSAGE }
    console.error('updateOrder: update failed', { orderId: id, cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

// Status-transition rules. Keys are every possible current status; values are
// the set of allowed target statuses from that current state. Terminal states
// (completed, cancelled, invoiced) have no allowed transitions — the invoice
// flow owns the transition to `invoiced`, never the status-actions UI.
const VALID_STATUS_TRANSITIONS: Record<PoStatus, readonly PoStatus[]> = {
  scheduled: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  invoiced: [],
}

// The status-transition schema intentionally excludes 'scheduled' and 'invoiced'
// as target states. 'scheduled' is an initial-only state set at creation time;
// 'invoiced' is set exclusively by the invoice-creation action (Task 24).
const updateOrderStatusInputSchema = z.object({
  newStatus: z.enum(['completed', 'cancelled']),
})

export type UpdateOrderStatusTarget = z.output<typeof updateOrderStatusInputSchema>['newStatus']

/**
 * Advances an order through the status lifecycle. Valid transitions:
 * scheduled→completed, scheduled→cancelled. All other moves (including any
 * transition out of a terminal state, and any move to 'invoiced' which is
 * owned by the invoice-creation flow) are rejected.
 * @param id UUID of the order to update.
 * @param newStatus Target status. Zod rejects 'scheduled' and 'invoiced'.
 */
export async function updateOrderStatus(
  id: string,
  newStatus: UpdateOrderStatusTarget,
): Promise<{ success: true } | { error: string }> {
  const authError = await assertAuthenticated()
  if (authError) return authError

  if (!UUID_RE.test(id)) return { error: 'Invalid order id.' }

  const parsed = updateOrderStatusInputSchema.safeParse({ newStatus })
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    const [row] = await db
      .select({ status: orders.status })
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1)

    if (!row) return { error: 'Order not found.' }

    const allowed = VALID_STATUS_TRANSITIONS[row.status]
    if (!allowed.includes(parsed.data.newStatus)) {
      return {
        error: `Invalid status transition from ${row.status} to ${parsed.data.newStatus}.`,
      }
    }

    // CONSTRAINT-16: when marking an undated order complete, auto-set the
    // delivery date to today so completed orders always carry a date for
    // period-window stats and need-to-contact frequency. COALESCE leaves the
    // existing date untouched if one was already set.
    const setPayload =
      parsed.data.newStatus === 'completed'
        ? {
            status: parsed.data.newStatus,
            updated_at: new Date(),
            requested_delivery_date: sql`COALESCE(${orders.requested_delivery_date}, CURRENT_DATE)`,
          }
        : { status: parsed.data.newStatus, updated_at: new Date() }

    await db.update(orders).set(setPayload).where(eq(orders.id, id))
    revalidatePath('/orders')
    return { success: true }
  } catch (cause) {
    console.error('updateOrderStatus: update failed', { orderId: id, cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}
