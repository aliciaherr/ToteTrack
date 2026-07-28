'use client'

import { useCallback, useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useReducedMotion } from 'framer-motion'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import OrderStatusTabs from './OrderStatusTabs'
import OrderRow from './OrderRow'
import type { OrderListStatus, OrderTableRow } from '@/db/queries/orders'

// The list is unbounded (no pagination), so every keystroke would refetch the
// full result set. Wait for a pause in typing before navigating.
const SEARCH_DEBOUNCE_MS = 250

interface OrderTableProps {
  orders: OrderTableRow[]
  status: OrderListStatus
  search: string
  selectedId: string | null
  onNewOrder: () => void
}

// Single href builder for both the status tabs and the row links, so switching
// tabs or selecting an order always carries the other params along.
function buildOrdersHref(
  status: OrderListStatus,
  search: string,
  orderId: string | null,
): string {
  const params = new URLSearchParams()
  if (status !== 'all') params.set('status', status)
  if (search.trim()) params.set('search', search)
  if (orderId) params.set('id', orderId)
  const query = params.toString()
  return query ? `/orders?${query}` : '/orders'
}

function EmptyState({ hasSearch, hasFilter }: { hasSearch: boolean; hasFilter: boolean }) {
  return (
    <div className="px-4 py-12 text-center text-sm text-muted-foreground">
      {hasSearch
        ? 'No orders match that search.'
        : hasFilter
          ? 'No orders match this filter.'
          : 'No orders yet.'}
    </div>
  )
}

function TableHeader() {
  return (
    <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
      <tr>
        <th scope="col" className="px-4 py-3 text-left font-medium">PO #</th>
        <th scope="col" className="px-4 py-3 text-left font-medium">Customer</th>
        <th scope="col" className="px-4 py-3 text-right font-medium">275</th>
        <th scope="col" className="px-4 py-3 text-right font-medium">330</th>
        <th scope="col" className="px-4 py-3 text-left font-medium">Status</th>
        <th scope="col" className="px-4 py-3 text-left font-medium">Req. Date</th>
        <th scope="col" className="px-4 py-3 text-right font-medium">Price</th>
        <th scope="col" className="px-4 py-3 w-8 text-center font-medium">
          <span className="sr-only">Backhaul</span>
        </th>
      </tr>
    </thead>
  )
}

/**
 * Orders table with status filter tabs, a PO/customer search box, the
 * "+ New Order" button, and the row list. Filter state is driven by URL query
 * params (`status`, `search`, `id`) so the server-rendered row list always
 * reflects the active view; every row is rendered in one scroll. Tab changes
 * and row clicks preserve the active search term.
 */
export default function OrderTable({
  orders,
  status,
  search,
  selectedId,
  onNewOrder,
}: OrderTableProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    },
    [],
  )

  const handleStatusChange = useCallback(
    (nextStatus: OrderListStatus) => {
      const href = buildOrdersHref(nextStatus, search, selectedId)
      startTransition(() => router.push(href))
    },
    [router, search, selectedId],
  )

  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const term = event.target.value
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const href = buildOrdersHref(status, term, selectedId)
        startTransition(() => router.push(href))
      }, SEARCH_DEBOUNCE_MS)
    },
    [router, status, selectedId],
  )

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="pl-20 pr-4 pt-4 pb-3 border-b border-border space-y-3">
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
        <div className="flex items-center justify-between gap-3">
          <OrderStatusTabs status={status} onChange={handleStatusChange} />
          <div className="relative w-64 max-w-[50%]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              defaultValue={search}
              placeholder="Search PO or customer..."
              aria-label="Search orders"
              onChange={handleSearchChange}
              className="w-full pl-9 pr-3 h-11 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
            />
          </div>
        </div>
      </div>

      <div
        className={`flex-1 overflow-y-auto transition-opacity ${
          isPending ? 'opacity-60' : 'opacity-100'
        }`}
      >
        {orders.length === 0 ? (
          <EmptyState hasSearch={Boolean(search.trim())} hasFilter={status !== 'all'} />
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
                  href={buildOrdersHref(status, search, order.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
