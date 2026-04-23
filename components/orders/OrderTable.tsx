'use client'

import { useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import OrderStatusTabs from './OrderStatusTabs'
import OrderRow from './OrderRow'
import OrderPagination from './OrderPagination'
import type { OrderListStatus, OrderTableRow } from '@/db/queries/orders'

interface OrderTableProps {
  orders: OrderTableRow[]
  totalCount: number
  totalPages: number
  currentPage: number
  status: OrderListStatus
  selectedId: string | null
  onNewOrder: () => void
}

function buildListHref(status: OrderListStatus, selectedId: string | null): string {
  const params = new URLSearchParams()
  if (status !== 'all') params.set('status', status)
  if (selectedId) params.set('id', selectedId)
  const query = params.toString()
  return query ? `/orders?${query}` : '/orders'
}

function buildRowHref(
  orderId: string,
  status: OrderListStatus,
  currentPage: number,
): string {
  const params = new URLSearchParams()
  params.set('id', orderId)
  if (status !== 'all') params.set('status', status)
  if (currentPage > 1) params.set('page', String(currentPage))
  return `/orders?${params.toString()}`
}

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="px-4 py-12 text-center text-sm text-muted-foreground">
      {hasFilter ? 'No orders match this filter.' : 'No orders yet.'}
    </div>
  )
}

function TableHeader() {
  return (
    <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
      <tr>
        <th scope="col" className="px-4 py-3 text-left font-medium">PO #</th>
        <th scope="col" className="px-4 py-3 text-left font-medium">Customer</th>
        <th scope="col" className="px-4 py-3 text-left font-medium">Qty / Size</th>
        <th scope="col" className="px-4 py-3 text-left font-medium">Type / Status</th>
        <th scope="col" className="px-4 py-3 text-left font-medium">Req. Date</th>
        <th scope="col" className="px-4 py-3 text-right font-medium">Price</th>
      </tr>
    </thead>
  )
}

/**
 * Orders table with status filter tabs, "+ New Order" button, the row list,
 * and a pagination footer. Filter state is driven by URL query params
 * (`status`, `page`, `id`) so the server-rendered row list always reflects
 * the active view. Status changes reset pagination to page 1; row clicks
 * preserve the current filter and page.
 */
export default function OrderTable({
  orders,
  totalCount,
  totalPages,
  currentPage,
  status,
  selectedId,
  onNewOrder,
}: OrderTableProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const shouldReduceMotion = Boolean(useReducedMotion())

  const handleStatusChange = useCallback(
    (nextStatus: OrderListStatus) => {
      // Reset to page 1 whenever the status filter changes — the previous
      // page number rarely maps to a meaningful position in the new result set.
      const href = buildListHref(nextStatus, selectedId)
      startTransition(() => router.push(href))
    },
    [router, selectedId],
  )

  const hasFilter = status !== 'all'

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="px-4 pt-4 pb-3 border-b border-border space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-foreground">Active Shipments</h1>
          <Button
            onClick={onNewOrder}
            className="min-h-[44px]"
            aria-label="Create new order"
          >
            + New Order
          </Button>
        </div>
        <OrderStatusTabs status={status} onChange={handleStatusChange} />
      </div>

      <div
        className={`flex-1 overflow-y-auto transition-opacity ${
          isPending ? 'opacity-60' : 'opacity-100'
        }`}
      >
        {orders.length === 0 ? (
          <EmptyState hasFilter={hasFilter} />
        ) : (
          <table className="w-full border-collapse">
            <TableHeader />
            <tbody>
              {orders.map((order, index) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  isSelected={selectedId === order.id}
                  animationIndex={index}
                  shouldReduceMotion={shouldReduceMotion}
                  href={buildRowHref(order.id, status, currentPage)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalCount > 0 && (
        <OrderPagination
          totalCount={totalCount}
          totalPages={totalPages}
          currentPage={currentPage}
          status={status}
          selectedId={selectedId}
        />
      )}
    </div>
  )
}
