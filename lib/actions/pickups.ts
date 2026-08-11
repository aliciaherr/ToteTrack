'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { pickups } from '@/db/schema'
import type { PickupStatus } from '@/db/queries/pickups'
import { UUID_RE } from '@/lib/validators/uuid'
import { firstZodMessage, nullIfBlank } from './orders.validation'
import {
  createPickupInputSchema,
  updatePickupInputSchema,
  updatePickupStatusInputSchema,
  type CreatePickupInput,
  type UpdatePickupInput,
  type UpdatePickupStatusTarget,
  type ValidatedPickup,
} from './pickups.validation'
import { recordDeliveryAddressUsage } from './orders.addresses'
import { assertAuthenticated, GENERIC_FAILURE_MESSAGE } from './auth.guard'

const INVALID_PICKUP_ID_MESSAGE = 'Invalid pickup id.'
const PICKUP_NOT_FOUND_MESSAGE = 'Pickup not found.'

// Routes a pickup appears on, revalidated on every write: the pickups list,
// the calendar (the card lands in the column its `pickup_date` names, and
// leaves the calendar entirely when it is cancelled) and the customer detail
// panel, which shows Pickup History alongside Order History.
//
// `/dashboard` is deliberately ABSENT — no dashboard widget reads pickups, and
// the PRD keeps them off every revenue and dashboard surface. Adding it here
// would be the first crack in that rule.
const PICKUP_REVALIDATE_PATHS = ['/pickups', '/calendar', '/customers'] as const

// Status-transition rules. Keys are every possible current status; values are
// the set of allowed targets. Unlike an order, a terminal pickup can be
// reopened: it carries no price, invoice or document, so returning it to
// `scheduled` has nothing to unwind (compare `revertOrderToScheduled`, which
// needs a whole transaction to detach an invoice). A no-op move to the status
// the row already holds is rejected rather than silently written.
const VALID_PICKUP_TRANSITIONS: Record<PickupStatus, readonly PickupStatus[]> = {
  scheduled: ['completed', 'cancelled'],
  completed: ['scheduled'],
  cancelled: ['scheduled'],
}

// Shared write-shape for both create and update: trims/normalizes the columns
// a human edits. `status` and `sort_index` are never written here — status
// belongs to `updatePickupStatus`, and the calendar's placement actions own
// `sort_index` (Task 81).
function buildPickupWriteBase(data: ValidatedPickup) {
  return {
    customer_id: data.customer_id,
    qty_275: data.qty_275,
    qty_330: data.qty_330,
    pickup_date: nullIfBlank(data.pickup_date),
    address: nullIfBlank(data.address),
    notes: nullIfBlank(data.notes),
  }
}

/**
 * Creates a tote pickup. Validates input server-side via Zod (customer id
 * shape, whole-number quantities within `QUANTITY_MAX`, at least one of
 * 275/330 greater than 0, ISO date format). `pickup_date` is optional —
 * omitting it leaves the pickup unscheduled, in the calendar's callout.
 *
 * An address is optional; when one is given it is snapshotted on the pickup
 * row (CONSTRAINT-21 — never an FK) and also upserted into the customer's
 * saved address book through the same `recordDeliveryAddressUsage` path
 * `createOrder` uses.
 *
 * @param input Pickup data: customer, tote counts, optional date, address and
 *   notes. No price, number or document — a pickup is never billed.
 * @returns The new pickup id, or a user-facing error message.
 */
export async function createPickup(
  input: CreatePickupInput,
): Promise<{ id: string } | { error: string }> {
  const parsed = createPickupInputSchema.safeParse(input)
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    // Inside the try per auth.guard's contract — getUser() can itself throw.
    const authError = await assertAuthenticated()
    if (authError) return authError

    const values = buildPickupWriteBase(parsed.data)
    const [row] = await db.insert(pickups).values(values).returning({ id: pickups.id })
    // Address-book bookkeeping, same helper and same containment rules as
    // `createOrder`: it swallows and logs its own failures because the pickup
    // row is already committed. `customer_collects: false` is the "we travel
    // to an address" case, which is exactly what a pickup is; a null address
    // makes the helper a no-op. Its "did the book change?" return value is
    // deliberately ignored — `/customers` revalidates on every pickup write
    // anyway, because the customer panel also shows Pickup History.
    await recordDeliveryAddressUsage(
      {
        customer_id: values.customer_id,
        customer_collects: false,
        delivery_address: values.address,
      },
      row.id,
      'createPickup',
    )
    for (const path of PICKUP_REVALIDATE_PATHS) revalidatePath(path)
    return { id: row.id }
  } catch (cause) {
    console.error('createPickup: insert failed', {
      operation: 'createPickup',
      customerId: parsed.data.customer_id,
      cause,
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/**
 * Updates an existing pickup's non-status fields. Status transitions are
 * intentionally NOT editable here — use `updatePickupStatus`. There is no
 * edit lock: a pickup has no price or invoice to protect, so quantities stay
 * editable in every status.
 *
 * @param id UUID of the pickup to update.
 * @param input Updated pickup data (no status field).
 */
export async function updatePickup(
  id: string,
  input: UpdatePickupInput,
): Promise<{ success: true } | { error: string }> {
  if (!UUID_RE.test(id)) return { error: INVALID_PICKUP_ID_MESSAGE }

  const parsed = updatePickupInputSchema.safeParse(input)
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    // Inside the try per auth.guard's contract — getUser() can itself throw.
    const authError = await assertAuthenticated()
    if (authError) return authError

    const [current] = await db
      .select({ id: pickups.id })
      .from(pickups)
      .where(eq(pickups.id, id))
      .limit(1)

    if (!current) return { error: PICKUP_NOT_FOUND_MESSAGE }

    await db
      .update(pickups)
      .set({ ...buildPickupWriteBase(parsed.data), updated_at: new Date() })
      .where(eq(pickups.id, id))
    for (const path of PICKUP_REVALIDATE_PATHS) revalidatePath(path)
    return { success: true }
  } catch (cause) {
    console.error('updatePickup: update failed', {
      operation: 'updatePickup',
      pickupId: id,
      cause,
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/**
 * Moves a pickup through its status lifecycle. Valid transitions:
 * scheduled→completed, scheduled→cancelled, and completed/cancelled→scheduled
 * (reopening a terminal pickup). Any other move — including a no-op to the
 * status the row already holds — is rejected with a transition-shaped message.
 *
 * @param id UUID of the pickup to update.
 * @param target Status to move to.
 */
export async function updatePickupStatus(
  id: string,
  target: UpdatePickupStatusTarget,
): Promise<{ success: true } | { error: string }> {
  if (!UUID_RE.test(id)) return { error: INVALID_PICKUP_ID_MESSAGE }

  const parsed = updatePickupStatusInputSchema.safeParse({ target })
  if (!parsed.success) return { error: firstZodMessage(parsed.error) }

  try {
    // Inside the try per auth.guard's contract — getUser() can itself throw.
    const authError = await assertAuthenticated()
    if (authError) return authError

    const [row] = await db
      .select({ status: pickups.status })
      .from(pickups)
      .where(eq(pickups.id, id))
      .limit(1)

    if (!row) return { error: PICKUP_NOT_FOUND_MESSAGE }

    if (!VALID_PICKUP_TRANSITIONS[row.status].includes(parsed.data.target)) {
      return {
        error: `Invalid status transition from ${row.status} to ${parsed.data.target}.`,
      }
    }

    await db
      .update(pickups)
      .set({ status: parsed.data.target, updated_at: new Date() })
      .where(eq(pickups.id, id))
    for (const path of PICKUP_REVALIDATE_PATHS) revalidatePath(path)
    return { success: true }
  } catch (cause) {
    console.error('updatePickupStatus: update failed', {
      operation: 'updatePickupStatus',
      pickupId: id,
      target,
      cause,
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}
