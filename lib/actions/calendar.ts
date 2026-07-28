'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { orders } from '@/db/schema'
import type { PoStatus } from '@/db/queries/orders'
import { GENERIC_FAILURE_MESSAGE, assertAuthenticated } from './auth.guard'
import { UUID_RE, firstZodMessage } from './orders.validation'
import {
  orderFlagInputSchema,
  setProductionPlacementInputSchema,
  type SetProductionPlacementInput,
} from './calendar.validation'

// Statuses whose cards are not draggable on the production calendar, and so
// may not have their placement changed by any route. Cancelled orders are
// excluded from the calendar query entirely; completed and invoiced orders are
// rendered read-only. Each carries its own message so the toast names the
// actual reason rather than a generic "not allowed".
const PLACEMENT_BLOCKED_MESSAGES: Partial<Record<PoStatus, string>> = {
  cancelled: 'Cancelled orders cannot be placed on the production calendar.',
  completed: 'Completed orders cannot be moved on the production calendar.',
  invoiced: 'Invoiced orders cannot be moved on the production calendar.',
}

// Same-day delivery is a delivery-logistics flag, not a placement, so it stays
// editable on completed and invoiced orders. Only cancelled orders — which are
// not on the calendar at all — reject the toggle.
const SAME_DAY_BLOCKED_MESSAGES: Partial<Record<PoStatus, string>> = {
  cancelled: 'Cancelled orders cannot be marked for same-day delivery.',
}

// Backhaul is a haulage flag, not a quantity or a price, so it stays editable
// on completed and invoiced orders — CONSTRAINT-18's edit lock covers qty and
// price only. Only cancelled orders reject the toggle, and their cards are not
// on the calendar in the first place.
const BACKHAUL_BLOCKED_MESSAGES: Partial<Record<PoStatus, string>> = {
  cancelled: 'Cancelled orders cannot be marked as backhaul.',
}

// Every calendar mutation is visible on both surfaces: the calendar itself and
// the dashboard's production widget. Both are revalidated on success so no
// screen shows stale placement (CONSTRAINT-02 — no optimistic-only state).
const CALENDAR_REVALIDATE_PATHS = ['/calendar', '/dashboard'] as const

/**
 * Loads the order's status and rejects it against the supplied block list.
 * Returns null when the mutation may proceed.
 */
async function assertMutable(
  id: string,
  blockedMessages: Partial<Record<PoStatus, string>>,
): Promise<{ error: string } | null> {
  const [row] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1)

  if (!row) return { error: 'Order not found.' }
  const blocked = blockedMessages[row.status]
  return blocked ? { error: blocked } : null
}

function revalidateCalendarSurfaces(): void {
  for (const path of CALENDAR_REVALIDATE_PATHS) {
    revalidatePath(path)
  }
}

/**
 * Places a PO on the production calendar: writes `production_date` and
 * `production_sort_index` in a single statement.
 *
 * **Never writes `requested_delivery_date`** (CONSTRAINT-19). The production
 * date is the day the order is built; the delivery date is the promise made to
 * the customer. Dragging a card must never silently rewrite that promise.
 *
 * Weekend dates are rejected — the calendar has no Saturday or Sunday column
 * and nothing downstream re-homes a stored weekend date.
 *
 * @param id UUID of the order to place.
 * @param input Target `productionDate` (`yyyy-MM-dd`, weekday) and `sortIndex`.
 * @returns `{ success: true }`, or `{ error }` carrying a user-facing message —
 * not signed in, invalid id, a Zod rejection (weekend, impossible date, out-of-range
 * sort index), a blocked status, or `GENERIC_FAILURE_MESSAGE` when the write
 * itself fails (the real cause is logged, never returned).
 */
export async function setProductionPlacement(
  id: string,
  input: SetProductionPlacementInput,
): Promise<{ success: true } | { error: string }> {
  if (!UUID_RE.test(id)) return { error: 'Invalid order id.' }

  const parsed = setProductionPlacementInputSchema.safeParse(input)
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    const authError = await assertAuthenticated()
    if (authError) return authError

    const statusError = await assertMutable(id, PLACEMENT_BLOCKED_MESSAGES)
    if (statusError) return statusError

    await db
      .update(orders)
      .set({
        production_date: parsed.data.productionDate,
        production_sort_index: parsed.data.sortIndex,
        updated_at: new Date(),
      })
      .where(eq(orders.id, id))

    revalidateCalendarSurfaces()
    return { success: true }
  } catch (cause) {
    console.error('setProductionPlacement: update failed', {
      orderId: id,
      productionDate: parsed.data.productionDate,
      sortIndex: parsed.data.sortIndex,
      cause,
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/**
 * Removes a PO's explicit calendar placement by nulling both production
 * columns. Backs the `Remove from calendar` menu item and the
 * drag-onto-callout gesture.
 *
 * The order **leaves the calendar** and appears in the unscheduled callout,
 * whatever its delivery date — a card's day is its `production_date` and
 * nothing derives one (CONSTRAINT-19). `requested_delivery_date` and
 * `same_day_delivery` are left untouched: this clears a build day, not the
 * delivery promise.
 *
 * @param id UUID of the order to unplace.
 * @returns `{ success: true }`, or `{ error }` carrying a user-facing message —
 * not signed in, invalid id, a blocked status, or `GENERIC_FAILURE_MESSAGE`
 * when the write itself fails (the real cause is logged, never returned).
 */
export async function clearProductionPlacement(
  id: string,
): Promise<{ success: true } | { error: string }> {
  if (!UUID_RE.test(id)) return { error: 'Invalid order id.' }

  try {
    const authError = await assertAuthenticated()
    if (authError) return authError

    const statusError = await assertMutable(id, PLACEMENT_BLOCKED_MESSAGES)
    if (statusError) return statusError

    await db
      .update(orders)
      .set({
        production_date: null,
        production_sort_index: null,
        updated_at: new Date(),
      })
      .where(eq(orders.id, id))

    revalidateCalendarSurfaces()
    return { success: true }
  } catch (cause) {
    console.error('clearProductionPlacement: update failed', { orderId: id, cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/**
 * Sets a PO's same-day-delivery flag, which drives the `SD` tag on the
 * production card. Takes the target state rather than flipping the stored
 * value, so a double-fired click cannot toggle twice.
 *
 * Touches neither production column nor `requested_delivery_date`.
 *
 * @param id UUID of the order to flag.
 * @param next Target state of the flag.
 * @returns `{ success: true }`, or `{ error }` — not signed in, invalid id,
 * cancelled order, or `GENERIC_FAILURE_MESSAGE` on a write failure.
 */
export async function toggleSameDayDelivery(
  id: string,
  next: boolean,
): Promise<{ success: true } | { error: string }> {
  if (!UUID_RE.test(id)) return { error: 'Invalid order id.' }

  const parsed = orderFlagInputSchema.safeParse({ next })
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    const authError = await assertAuthenticated()
    if (authError) return authError

    const statusError = await assertMutable(id, SAME_DAY_BLOCKED_MESSAGES)
    if (statusError) return statusError

    await db
      .update(orders)
      .set({ same_day_delivery: parsed.data.next, updated_at: new Date() })
      .where(eq(orders.id, id))

    revalidateCalendarSurfaces()
    return { success: true }
  } catch (cause) {
    console.error('toggleSameDayDelivery: update failed', {
      orderId: id,
      next,
      cause,
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/**
 * Sets a PO's backhaul flag, which drives the `B` tag on the production card
 * and every other PO list surface. Takes the target state rather than flipping
 * the stored value, so a double-fired click cannot toggle twice.
 *
 * Touches neither production column nor `requested_delivery_date`, and stays
 * available on completed and invoiced orders — CONSTRAINT-18 locks quantities
 * and price on those, not logistics flags.
 *
 * @param id UUID of the order to flag.
 * @param next Target state of the flag.
 * @returns `{ success: true }`, or `{ error }` — not signed in, invalid id,
 * cancelled order, or `GENERIC_FAILURE_MESSAGE` on a write failure.
 */
export async function toggleBackhaul(
  id: string,
  next: boolean,
): Promise<{ success: true } | { error: string }> {
  if (!UUID_RE.test(id)) return { error: 'Invalid order id.' }

  const parsed = orderFlagInputSchema.safeParse({ next })
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    const authError = await assertAuthenticated()
    if (authError) return authError

    const statusError = await assertMutable(id, BACKHAUL_BLOCKED_MESSAGES)
    if (statusError) return statusError

    await db
      .update(orders)
      .set({ backhaul: parsed.data.next, updated_at: new Date() })
      .where(eq(orders.id, id))

    revalidateCalendarSurfaces()
    return { success: true }
  } catch (cause) {
    console.error('toggleBackhaul: update failed', {
      orderId: id,
      next,
      cause,
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}
