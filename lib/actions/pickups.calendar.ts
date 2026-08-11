'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { pickups } from '@/db/schema'
import type { PickupStatus } from '@/db/queries/pickups'
import { UUID_RE } from '@/lib/validators/uuid'
import { firstZodMessage } from './orders.validation'
import {
  setPickupPlacementInputSchema,
  type SetPickupPlacementInput,
} from './pickups.calendar.validation'
import { assertAuthenticated, GENERIC_FAILURE_MESSAGE } from './auth.guard'

// The pickup half of the calendar's placement writes — the deliberate sibling
// of `lib/actions/calendar.ts`, which owns the order half. Two modules rather
// than four exports in one, for the same reason there are two tables
// (CONSTRAINT-25): a shared action would need a branch on every line that names
// a column, and one wrong branch writes a pickup id into `orders`.

const INVALID_PICKUP_ID_MESSAGE = 'Invalid pickup id.'
const PICKUP_NOT_FOUND_MESSAGE = 'Pickup not found.'

// Statuses whose cards are not draggable on the calendar, and so may not have
// their placement changed by any route. Cancelled pickups are excluded from the
// calendar query entirely; completed ones render greyed and locked. Mirrors
// `PLACEMENT_BLOCKED_MESSAGES` in `calendar.ts`, message shape included, so a
// blocked pickup reads like a blocked order rather than a different product.
const PLACEMENT_BLOCKED_MESSAGES: Partial<Record<PickupStatus, string>> = {
  cancelled: 'Cancelled pickups cannot be placed on the calendar.',
  completed: 'Completed pickups cannot be moved on the calendar.',
}

// Routes a placement write is visible on. `/calendar` draws the card and
// `/pickups` lists the date; `/customers` is included because the customer
// panel's Pickup History renders `pickup_date` in a column of its own, and a
// drag that did not revalidate it would leave that panel showing the old day.
//
// `/dashboard` is deliberately ABSENT — no dashboard widget reads pickups, and
// the PRD keeps them off every revenue and dashboard surface (CONSTRAINT-25).
const PICKUP_CALENDAR_REVALIDATE_PATHS = ['/calendar', '/pickups', '/customers'] as const

/**
 * Loads the pickup's status and rejects it against the placement block list.
 * Returns null when the mutation may proceed.
 *
 * This lookup is also the id's group check: pickups and orders live in separate
 * tables, so an order id sent to a pickup action simply is not here and comes
 * back as not-found. `assertMutable` in `calendar.ts` gives the order actions
 * the same guarantee in the other direction.
 */
async function assertPlaceable(id: string): Promise<{ error: string } | null> {
  const [row] = await db
    .select({ status: pickups.status })
    .from(pickups)
    .where(eq(pickups.id, id))
    .limit(1)

  if (!row) return { error: PICKUP_NOT_FOUND_MESSAGE }
  const blocked = PLACEMENT_BLOCKED_MESSAGES[row.status]
  return blocked ? { error: blocked } : null
}

function revalidatePickupCalendarSurfaces(): void {
  for (const path of PICKUP_CALENDAR_REVALIDATE_PATHS) {
    revalidatePath(path)
  }
}

/**
 * Places a pickup on the calendar: writes `pickup_date` and `sort_index` in a
 * single statement.
 *
 * A pickup has **one** date and it *is* the placement (CONSTRAINT-25), unlike
 * an order where the delivery promise and the build day are separate columns
 * and the calendar may never touch the promise. Dragging a pickup card is
 * therefore expected to rewrite its date — that is the whole gesture.
 *
 * The group is checked twice, on purpose. `input.group` must be the literal
 * `'pickup'`, which rejects a payload built for the order action before any
 * query runs; and the id must resolve to a row in `pickups`, which rejects an
 * order id whatever the payload claims. Neither check trusts the client, and
 * the UI's group discriminator is not part of either.
 *
 * @param id UUID of the pickup to place.
 * @param input `group: 'pickup'`, the target `pickupDate` (`yyyy-MM-dd`) and `sortIndex`.
 * @returns `{ success: true }`, or `{ error }` carrying a user-facing message —
 * not signed in, invalid id, a Zod rejection (wrong group, impossible date,
 * out-of-range sort index), an unknown or locked pickup, or
 * `GENERIC_FAILURE_MESSAGE` when the write itself fails (the real cause is
 * logged, never returned).
 */
export async function setPickupPlacement(
  id: string,
  input: SetPickupPlacementInput,
): Promise<{ success: true } | { error: string }> {
  if (!UUID_RE.test(id)) return { error: INVALID_PICKUP_ID_MESSAGE }

  const parsed = setPickupPlacementInputSchema.safeParse(input)
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    // Inside the try per auth.guard's contract — getUser() can itself throw.
    const authError = await assertAuthenticated()
    if (authError) return authError

    const statusError = await assertPlaceable(id)
    if (statusError) return statusError

    await db
      .update(pickups)
      .set({
        pickup_date: parsed.data.pickupDate,
        sort_index: parsed.data.sortIndex,
        updated_at: new Date(),
      })
      .where(eq(pickups.id, id))

    revalidatePickupCalendarSurfaces()
    return { success: true }
  } catch (cause) {
    console.error('setPickupPlacement: update failed', {
      operation: 'setPickupPlacement',
      pickupId: id,
      pickupDate: parsed.data.pickupDate,
      sortIndex: parsed.data.sortIndex,
      cause,
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/**
 * Removes a pickup's calendar placement by nulling `pickup_date` **and**
 * `sort_index`. Backs the popup's `Remove from calendar` item, the
 * drag-onto-callout gesture and the armed tap on the callout — three entry
 * points, one operation.
 *
 * This supersedes the Task 80 shortcut, which cleared the date by resending the
 * whole editable row through `updatePickup` (recorded as INFO-05). That path
 * was last-write-wins against a concurrent edit from the Pickups tab and left
 * `sort_index` pointing at a column the pickup no longer sits in. Two columns
 * and nothing else move here, so a concurrent quantity edit survives, and the
 * stale index cannot resurface when the pickup is placed again.
 *
 * Status, quantities, address and notes are untouched: this clears a day, not
 * the collection.
 *
 * @param id UUID of the pickup to unplace.
 * @returns `{ success: true }`, or `{ error }` — not signed in, invalid id, an
 * unknown or locked pickup, or `GENERIC_FAILURE_MESSAGE` on a write failure.
 */
export async function clearPickupPlacement(
  id: string,
): Promise<{ success: true } | { error: string }> {
  if (!UUID_RE.test(id)) return { error: INVALID_PICKUP_ID_MESSAGE }

  try {
    // Inside the try per auth.guard's contract — getUser() can itself throw.
    const authError = await assertAuthenticated()
    if (authError) return authError

    const statusError = await assertPlaceable(id)
    if (statusError) return statusError

    await db
      .update(pickups)
      .set({ pickup_date: null, sort_index: null, updated_at: new Date() })
      .where(eq(pickups.id, id))

    revalidatePickupCalendarSurfaces()
    return { success: true }
  } catch (cause) {
    console.error('clearPickupPlacement: update failed', {
      operation: 'clearPickupPlacement',
      pickupId: id,
      cause,
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}
