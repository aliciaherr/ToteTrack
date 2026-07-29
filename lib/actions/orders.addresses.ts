import { and, eq } from 'drizzle-orm'
import { db } from '@/db'
import { customerAddresses } from '@/db/schema'
import { nullIfBlank } from './orders.validation'

// Address-book bookkeeping for `createOrder` (Feature 14). Split out of
// `orders.ts` for the same reason as `orders.internal.ts`: the action file
// keeps exporting only async server actions and stays inside the CQ-02
// service cap. No `'use server'` directive on purpose — these helpers are
// internal to the action, never client-invokable.

/**
 * The address-relevant slice of a validated create-order payload. A structural
 * subset of `ValidatedCreate` so tests and callers don't need the full order
 * shape to exercise the bookkeeping.
 */
export interface DeliveryAddressUsage {
  customer_id: string
  pickup_only: boolean
  delivery_address?: string | null
  delivery_address_id?: string | null
}

/**
 * SEC-03 ownership gate: true when `addressId` names a `customer_addresses`
 * row that belongs to `customerId`. `createOrder` calls this BEFORE inserting
 * the order, so a forged/foreign id fails the whole create instead of letting
 * one customer's submit bump another customer's address book.
 */
export async function addressBelongsToCustomer(
  addressId: string,
  customerId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: customerAddresses.id })
    .from(customerAddresses)
    .where(
      and(
        eq(customerAddresses.id, addressId),
        eq(customerAddresses.customer_id, customerId),
      ),
    )
    .limit(1)
  return Boolean(row)
}

/**
 * MRU bookkeeping after a successful order insert (Feature 14):
 * - saved address picked (`delivery_address_id` present) → bump its
 *   `last_used_at` to now
 * - fresh text, no id → single atomic upsert against the unique
 *   `(customer_id, address)` index (migration 0013, audit L-03; same plain
 *   SQL `=` dedupe rule as `addCustomerAddress`, Task 71): a new row is
 *   inserted with `last_used_at = now()`, an exact-text match gets its
 *   `last_used_at` bumped instead — usage always bumps, so `last_used_at`
 *   is set on both sides of the conflict
 * - pickup-only or blank address → no writes at all
 *
 * Returns true when the address book was written, so the caller can
 * revalidate `/customers`. Failures are contained here — the order row is
 * already committed, and failing the create now would tell the salesperson
 * it failed when it didn't (pushing them into a duplicate-PO retry). The
 * failure is logged loudly with full context instead (EH-01 via logs).
 * @param usage Address fields from the validated create payload.
 * @param orderId The just-created order's id, for the failure log.
 */
export async function recordDeliveryAddressUsage(
  usage: DeliveryAddressUsage,
  orderId: string,
): Promise<boolean> {
  try {
    if (usage.pickup_only) return false
    if (usage.delivery_address_id) {
      await db
        .update(customerAddresses)
        .set({ last_used_at: new Date() })
        .where(eq(customerAddresses.id, usage.delivery_address_id))
      return true
    }
    const text = nullIfBlank(usage.delivery_address)
    if (text === null) return false

    const now = new Date()
    await db
      .insert(customerAddresses)
      .values({ customer_id: usage.customer_id, address: text, last_used_at: now })
      .onConflictDoUpdate({
        target: [customerAddresses.customer_id, customerAddresses.address],
        set: { last_used_at: now, updated_at: now },
      })
    return true
  } catch (cause) {
    console.error('createOrder: address bookkeeping failed', {
      orderId,
      customerId: usage.customer_id,
      cause,
    })
    return false
  }
}
