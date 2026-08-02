'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/db'
import { customerAddresses } from '@/db/schema'
import { UUID_RE } from '@/lib/validators/uuid'
import { DELIVERY_ADDRESS_MAX, firstZodMessage } from './orders.validation'
import { assertAuthenticated, GENERIC_FAILURE_MESSAGE } from './auth.guard'

// Saved addresses surface in three places: the customer detail panel
// (/customers) and the order form's address picker, which renders on the
// orders list and inside the calendar drawer (both consume addresses via
// `getActiveCustomersForSelect`). Mutations revalidate all three so a
// just-saved address appears without a reload. Same file-local idiom as
// `ORDER_REVALIDATE_PATHS` in `orders.ts` — that set is not reused here
// because it includes `/dashboard`, which never renders addresses.
const ADDRESS_REVALIDATE_PATHS = ['/customers', '/orders', '/calendar'] as const

// `.trim()` runs before `.min(1)` so whitespace-only strings are rejected
// server-side. The parsed output is the trimmed text — what gets stored.
// Shares `DELIVERY_ADDRESS_MAX` (orders) — an address is bounded identically
// everywhere.
const addressSchema = z
  .string()
  .trim()
  .min(1, 'Address is required.')
  .max(DELIVERY_ADDRESS_MAX, `Address must be ${DELIVERY_ADDRESS_MAX} characters or fewer.`)

function revalidateAddressPaths(): void {
  for (const path of ADDRESS_REVALIDATE_PATHS) revalidatePath(path)
}

/**
 * Saves a delivery address to a customer's address book. Dedupe: when the
 * customer already has a row whose text exactly equals the trimmed input,
 * that row's `last_used_at` is bumped to now and its existing id returned —
 * no duplicate row is inserted. Otherwise inserts the trimmed address with
 * `last_used_at` left NULL; it is only set when the address is used on an
 * order (Task 72).
 *
 * Dedupe is a single atomic upsert against the unique
 * `(customer_id, address)` index (migration 0013, audit L-03) — no
 * check-then-insert race. Plain SQL `=` equality (case- and
 * whitespace-sensitive): "123 Main St" and "123 main st" are intentionally
 * distinct rows. `onConflictDoUpdate`'s `set` applies only on conflict, so a
 * brand-new row still gets `last_used_at` NULL.
 * @param customer_id UUID of the owning customer.
 * @param address Free-text delivery address; stored trimmed.
 */
export async function addCustomerAddress(
  customer_id: string,
  address: string,
): Promise<{ id: string } | { error: string }> {
  try {
    // Inside the try per auth.guard's contract — getUser() can itself throw.
    const authError = await assertAuthenticated()
    if (authError) return authError

    if (!UUID_RE.test(customer_id)) return { error: 'Invalid customer id.' }
    const parsed = addressSchema.safeParse(address)
    if (!parsed.success) return { error: firstZodMessage(parsed.error) }

    const now = new Date()
    const [row] = await db
      .insert(customerAddresses)
      .values({ customer_id, address: parsed.data })
      .onConflictDoUpdate({
        target: [customerAddresses.customer_id, customerAddresses.address],
        set: { last_used_at: now, updated_at: now },
      })
      .returning({ id: customerAddresses.id })
    revalidateAddressPaths()
    return { id: row.id }
  } catch (cause) {
    console.error('addCustomerAddress: write failed', { customerId: customer_id, cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/**
 * Rewrites an existing saved address's text (stored trimmed) and touches
 * `updated_at`. Returns an error — not success — when no row matches the id;
 * the address may have been deleted from another screen.
 * @param id UUID of the `customer_addresses` row to update.
 * @param address Replacement address text.
 */
export async function updateCustomerAddress(
  id: string,
  address: string,
): Promise<{ success: true } | { error: string }> {
  try {
    // Inside the try per auth.guard's contract — getUser() can itself throw.
    const authError = await assertAuthenticated()
    if (authError) return authError

    if (!UUID_RE.test(id)) return { error: 'Invalid address id.' }
    const parsed = addressSchema.safeParse(address)
    if (!parsed.success) return { error: firstZodMessage(parsed.error) }

    const updated = await db
      .update(customerAddresses)
      .set({ address: parsed.data, updated_at: new Date() })
      .where(eq(customerAddresses.id, id))
      .returning({ id: customerAddresses.id })

    if (updated.length === 0) return { error: 'Address not found.' }

    revalidateAddressPaths()
    return { success: true }
  } catch (cause) {
    console.error('updateCustomerAddress: update failed', { addressId: id, cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/**
 * Hard-deletes a saved address. Past orders are unaffected by design —
 * orders store address text snapshots, not foreign keys into this table.
 * Returns an error — not success — when no row matches the id.
 * @param id UUID of the `customer_addresses` row to delete.
 */
export async function deleteCustomerAddress(
  id: string,
): Promise<{ success: true } | { error: string }> {
  try {
    // Inside the try per auth.guard's contract — getUser() can itself throw.
    const authError = await assertAuthenticated()
    if (authError) return authError

    if (!UUID_RE.test(id)) return { error: 'Invalid address id.' }

    const deleted = await db
      .delete(customerAddresses)
      .where(eq(customerAddresses.id, id))
      .returning({ id: customerAddresses.id })

    if (deleted.length === 0) return { error: 'Address not found.' }

    revalidateAddressPaths()
    return { success: true }
  } catch (cause) {
    console.error('deleteCustomerAddress: delete failed', { addressId: id, cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}
