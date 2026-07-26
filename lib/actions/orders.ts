'use server'

import { eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { orders } from '@/db/schema'
import { createClient } from '@/lib/supabase/server'
import type { PoStatus } from '@/db/queries/orders'
import {
  UUID_RE,
  createOrderInputSchema,
  updateOrderInputSchema,
  updateOrderStatusInputSchema,
  firstZodMessage,
  type CreateOrderInput,
  type UpdateOrderInput,
  type UpdateOrderStatusTarget,
} from './orders.validation'
import {
  QTY_AND_PRICE_SNAPSHOT_COLUMNS,
  normalizeCreate,
  normalizeUpdate,
  detectQtyOrPriceChange,
} from './orders.internal'

// User-facing fallback for any server-side failure that isn't a validation,
// auth, or unique-constraint rejection. Detailed cause is logged server-side
// via console.error — never surfaced to the client (SEC-05, EH-04).
const GENERIC_FAILURE_MESSAGE = 'Something went wrong. Please try again.'
const DUPLICATE_PO_MESSAGE = 'PO number already exists.'
const PO_LOCKED_MESSAGE =
  'PO is locked. Revert to scheduled before editing quantities or price.'

// Postgres unique-violation SQLSTATE. The orders table has a unique constraint
// on po_number; when it trips, the driver error has this code. Captured as
// a named constant so the catch block reads self-documenting.
const POSTGRES_UNIQUE_VIOLATION = '23505'

// Statuses where qty + price edits are blocked. Other field edits remain
// allowed. The salesperson can revert via the existing FB-08 flow if a real
// correction is needed (revertOrderToScheduled returns the PO to
// `scheduled`, where qty/price edits are unrestricted).
const QTY_OR_PRICE_LOCKED_STATUSES: readonly PoStatus[] = ['invoiced', 'cancelled']

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

/**
 * Creates a new purchase order. Validates input server-side via Zod (PO#
 * uniqueness + length, sum of the 6 quantity cells > 0, price > 0,
 * delivery address required when not pickup-only); rejects duplicate
 * `po_number` via Postgres unique-violation (23505) with a user-facing
 * message. Returns the new order id on success.
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
 * are intentionally NOT editable here — use `updateOrderStatus`. Edit lock:
 * when status is `invoiced` or `cancelled`, qty + price changes are rejected
 * with `PO_LOCKED_MESSAGE`. Other field edits (notes, address, delivery
 * date, backhaul, pickup_only) are still allowed on locked POs. The
 * salesperson must use the revert flow (FB-08 — `revertOrderToScheduled`)
 * to bring the PO back to `scheduled` before adjusting quantities or price.
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
    const [current] = await db
      .select(QTY_AND_PRICE_SNAPSHOT_COLUMNS)
      .from(orders)
      .where(eq(orders.id, id))
      .limit(1)

    if (!current) return { error: 'Order not found.' }

    if (
      QTY_OR_PRICE_LOCKED_STATUSES.includes(current.status) &&
      detectQtyOrPriceChange(current, parsed.data)
    ) {
      return { error: PO_LOCKED_MESSAGE }
    }

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
