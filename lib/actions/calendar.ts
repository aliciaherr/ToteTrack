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
import {
  clearAndRenumber,
  placeAndRenumber,
  type PlacementTable,
} from './placement.renumber'

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

// The order half of the shared column renumberer. `tiebreakColumn` is
// `po_number` because that is the read query's last ORDER BY term
// (`db/queries/calendar.ts`) — a column of untouched NULL indices must renumber
// into the order already on screen, not a different one. Pickups declare their
// own config against their own table, so the two lists sharing a day can never
// renumber each other (CONSTRAINT-25).
const PRODUCTION_PLACEMENT_TABLE: PlacementTable = {
  label: 'orders',
  table: orders,
  idColumn: orders.id,
  dateColumn: orders.production_date,
  sortIndexColumn: orders.production_sort_index,
  tiebreakColumn: orders.po_number,
  updatedAtColumn: orders.updated_at,
}

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
 * Places a PO on the production calendar: writes `production_date`, splices the
 * card in at the released position, and renumbers the whole destination column
 * — plus the origin column on a cross-day move — to a dense `0..n-1` sequence.
 * All of it in one transaction, so a mid-write failure leaves every index as it
 * was rather than half-renumbered.
 *
 * Renumbering is the placement, not an extra: the read query orders by
 * `production_sort_index ASC NULLS LAST`, so writing one row's index and
 * leaving its siblings `NULL` sorts the card above all of them whatever
 * position it was released at.
 *
 * **Never writes `requested_delivery_date`** (CONSTRAINT-19). The production
 * date is the day the order is built; the delivery date is the promise made to
 * the customer. Dragging a card must never silently rewrite that promise.
 *
 * Sunday dates are rejected — the calendar has no Sunday column and nothing
 * downstream re-homes a stored one. Saturday places like any other day (Task 88).
 *
 * The payload's `group: 'order'` literal is checked server-side, mirroring
 * `setPickupPlacement` (CONSTRAINT-25): a crossed payload is refused here rather
 * than relying on the id simply not existing in `orders`.
 *
 * @param id UUID of the order to place.
 * @param input `group: 'order'`, target `productionDate` (`yyyy-MM-dd`, Mon–Sat)
 * and `sortIndex`.
 * @returns `{ success: true }`, or `{ error }` carrying a user-facing message —
 * not signed in, invalid id, a Zod rejection (crossed group, Sunday, impossible
 * date, out-of-range sort index), a blocked status, or `GENERIC_FAILURE_MESSAGE`
 * when the write itself fails (the real cause is logged, never returned).
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

    await db.transaction((tx) =>
      placeAndRenumber(
        tx,
        PRODUCTION_PLACEMENT_TABLE,
        id,
        parsed.data.productionDate,
        parsed.data.sortIndex,
      ),
    )

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
 * columns, then renumbers the day it left so the remaining cards close the gap.
 * Backs the `Remove from calendar` menu item and the drag-onto-callout gesture.
 * Transactional, so the clear and the renumber land together.
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

    await db.transaction((tx) => clearAndRenumber(tx, PRODUCTION_PLACEMENT_TABLE, id))

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
