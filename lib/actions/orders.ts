'use server'

import { eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { orders } from '@/db/schema'
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
import {
  addressBelongsToCustomer,
  recordDeliveryAddressUsage,
} from './orders.addresses'
import { assertAuthenticated, GENERIC_FAILURE_MESSAGE } from './auth.guard'

const DUPLICATE_PO_MESSAGE = 'PO number already exists.'
const ADDRESS_NOT_OWNED_MESSAGE =
  'Selected delivery address does not belong to this customer.'
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

// Routes a PO appears on, revalidated whenever one is created, edited, or its
// status changes: the orders list, the production calendar (the card lands in
// the column its `production_date` names, and leaves the calendar entirely when
// it is cancelled) and the dashboard (its production widget reads the same
// column). `/dashboard`, not `/` — `app/page.tsx` only redirects, so
// revalidating `/` would refresh nothing. Same set as
// `CALENDAR_REVALIDATE_PATHS` in `calendar.ts`, plus the orders list.
const ORDER_REVALIDATE_PATHS = ['/orders', '/calendar', '/dashboard'] as const

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
 * Feature 14: an optional `delivery_address_id` is ownership-checked against
 * the customer before the insert, then the address book's MRU state is
 * updated after it (see `orders.addresses.ts`).
 * @param input Order data including `initial_status` (defaults to 'scheduled')
 *   and an optional `production_date` build-day override — supplied when the PO
 *   is created from a calendar day column, rejected when it names a Saturday or
 *   Sunday, and otherwise defaulted from the delivery date by `normalizeCreate`.
 */
export async function createOrder(
  input: CreateOrderInput,
): Promise<{ id: string } | { error: string }> {
  const parsed = createOrderInputSchema.safeParse(input)
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    // Inside the try per auth.guard's contract — getUser() can itself throw.
    const authError = await assertAuthenticated()
    if (authError) return authError

    // SEC-03: a submitted saved-address id must belong to the submitted
    // customer, checked BEFORE the order insert so a forged id fails the
    // whole create. Skipped on pickup-only — no address is used at all.
    if (!parsed.data.pickup_only && parsed.data.delivery_address_id) {
      const owned = await addressBelongsToCustomer(
        parsed.data.delivery_address_id,
        parsed.data.customer_id,
      )
      if (!owned) return { error: ADDRESS_NOT_OWNED_MESSAGE }
    }

    const [row] = await db
      .insert(orders)
      .values(normalizeCreate(parsed.data))
      .returning({ id: orders.id })
    // Feature 14 MRU bookkeeping (no transaction — mirrors the plain insert
    // above): bump the picked address, or dedupe/insert typed text. Contains
    // its own failures (see its JSDoc); true means the address book changed,
    // which the /customers detail panel renders.
    if (await recordDeliveryAddressUsage(parsed.data, row.id)) {
      revalidatePath('/customers')
    }
    // A new PO lands on three screens at once: the orders list, the calendar
    // column its `production_date` names, and the dashboard production widget
    // when that day is inside the widget's window. Revalidate all three or the
    // salesperson has to reload to see the card they just created.
    for (const path of ORDER_REVALIDATE_PATHS) revalidatePath(path)
    return { id: row.id }
  } catch (cause) {
    if (isUniqueViolation(cause)) return { error: DUPLICATE_PO_MESSAGE }
    console.error('createOrder: insert failed', {
      poNumber: parsed.data.po_number,
      customerId: parsed.data.customer_id,
      cause,
    })
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
  if (!UUID_RE.test(id)) return { error: 'Invalid order id.' }

  const parsed = updateOrderInputSchema.safeParse(input)
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    // Inside the try per auth.guard's contract — getUser() can itself throw.
    const authError = await assertAuthenticated()
    if (authError) return authError

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
    // Edits change fields the calendar card and dashboard widget draw —
    // backhaul, delivery date, the quantity mix — so all three surfaces
    // revalidate, same as a create or status change.
    for (const path of ORDER_REVALIDATE_PATHS) revalidatePath(path)
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
  if (!UUID_RE.test(id)) return { error: 'Invalid order id.' }

  const parsed = updateOrderStatusInputSchema.safeParse({ newStatus })
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    // Inside the try per auth.guard's contract — getUser() can itself throw.
    const authError = await assertAuthenticated()
    if (authError) return authError

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
    // Not just `/orders`: a cancelled PO drops out of the calendar query
    // (`status <> 'cancelled'`) and a completed one changes how both the
    // calendar card and the dashboard widget render it. Without these two the
    // card the salesperson just cancelled stays on screen until a hard reload.
    for (const path of ORDER_REVALIDATE_PATHS) revalidatePath(path)
    return { success: true }
  } catch (cause) {
    console.error('updateOrderStatus: update failed', { orderId: id, cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}
