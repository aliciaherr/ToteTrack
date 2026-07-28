'use server'

import { eq, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/db'
import { orders, invoices } from '@/db/schema'
import { assertAuthenticated, GENERIC_FAILURE_MESSAGE } from './auth.guard'
import { UUID_RE } from './orders.validation'

// Every surface a revert changes: the orders list, the invoices list (a total
// was recomputed or an invoice deleted), customer detail's order history, the
// production calendar (a reverted order rejoins it, and its card becomes
// draggable again) and the dashboard's production widget. `/dashboard`, not
// `/` — `app/page.tsx` only redirects, so revalidating `/` would refresh
// nothing. Same idiom as `ORDER_REVALIDATE_PATHS` in `orders.ts`.
const REVERT_REVALIDATE_PATHS = [
  '/orders',
  '/invoices',
  '/customers',
  '/calendar',
  '/dashboard',
] as const

interface RemainingInvoiceTotals {
  count: number
  total: string
}

/**
 * Reverts a terminal-state order back to `scheduled`. Three terminal states
 * can be reverted:
 *   - `completed` → `scheduled`: simple status flip. The
 *     auto-set-on-completion `requested_delivery_date` is preserved.
 *   - `cancelled` → `scheduled`: simple status flip.
 *   - `invoiced` → `scheduled`: also detaches the order from its invoice
 *     (`invoice_id` → null), recomputes the invoice's `total_amount` to the
 *     sum of the remaining attached orders, and **deletes the invoice
 *     entirely if it ends up with zero orders** (a $0 zombie draft is
 *     worse UX than the slim risk of an invoice number being reused later).
 *
 * `scheduled` orders cannot be reverted — they are already in the in-flight
 * state — and the action returns an error in that case.
 *
 * The whole revert runs in a single DB transaction so partial state cannot
 * leak (e.g., the order detaches from the invoice but the invoice total
 * doesn't recompute).
 */
export async function revertOrderToScheduled(
  id: string,
): Promise<{ success: true } | { error: string }> {
  if (!UUID_RE.test(id)) return { error: 'Invalid order id.' }

  try {
    // Inside the try per auth.guard's contract — getUser() can itself throw.
    const authError = await assertAuthenticated()
    if (authError) return authError

    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ status: orders.status, invoice_id: orders.invoice_id })
        .from(orders)
        .where(eq(orders.id, id))
        .limit(1)

      if (!row) return { error: 'Order not found.' as string }
      if (row.status === 'scheduled') {
        return { error: 'Order is already scheduled.' as string }
      }

      await tx
        .update(orders)
        .set({
          status: 'scheduled',
          invoice_id: null,
          updated_at: new Date(),
        })
        .where(eq(orders.id, id))

      if (row.invoice_id) {
        const remaining = (await tx.execute(sql`
          SELECT
            COUNT(*)::int AS count,
            COALESCE(SUM(price), 0)::text AS total
          FROM orders
          WHERE invoice_id = ${row.invoice_id}
        `)) as unknown as RemainingInvoiceTotals[]
        const summary = remaining[0] ?? { count: 0, total: '0' }

        if (summary.count === 0) {
          await tx.delete(invoices).where(eq(invoices.id, row.invoice_id))
        } else {
          await tx
            .update(invoices)
            .set({ total_amount: summary.total, updated_at: new Date() })
            .where(eq(invoices.id, row.invoice_id))
        }
      }

      return { success: true as const }
    })

    if ('success' in result) {
      for (const path of REVERT_REVALIDATE_PATHS) revalidatePath(path)
    }
    return result
  } catch (cause) {
    console.error('revertOrderToScheduled: failed', { orderId: id, cause })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}
