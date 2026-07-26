'use client'

import { useTransition, useMemo } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import BackhaulTag from '@/components/shared/BackhaulTag'
import { sumPoSize, formatPoTotal } from '@/components/shared/qtyGridValues'
import { formatCurrency } from '@/lib/format-currency'
import type {
  CustomerOrdersWindow,
  CustomerOrderRow,
} from '@/db/queries/customers'

const WINDOWS: CustomerOrdersWindow[] = ['1M', '3M', '6M', '1Y', 'YTD']

const STATUS_CLASS: Record<CustomerOrderRow['status'], string> = {
  scheduled: 'bg-slate-100 text-slate-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-200 text-slate-600',
  invoiced: 'bg-primary/10 text-primary',
}

interface OrderHistoryProps {
  orders: CustomerOrderRow[]
  window: CustomerOrdersWindow
}

function buildTabContentVariants(shouldReduceMotion: boolean | null) {
  const duration = shouldReduceMotion ? 0 : 0.15
  const ease = 'easeInOut' as const
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration, ease } },
    exit: { opacity: 0, transition: { duration, ease } },
  }
}

function WindowTabs({
  window,
  onChange,
  isPending,
}: {
  window: CustomerOrdersWindow
  onChange: (next: CustomerOrdersWindow) => void
  isPending: boolean
}) {
  const shouldReduceMotion = useReducedMotion()
  return (
    <div role="tablist" aria-label="Order history time window" className="flex items-center gap-1 border-b border-border relative">
      {WINDOWS.map((windowOption) => {
        const isActive = window === windowOption
        return (
          <button
            key={windowOption}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => !isActive && onChange(windowOption)}
            disabled={isPending}
            className={`relative min-h-[44px] px-4 text-sm font-medium transition-colors ${
              isActive ? 'text-primary' : 'text-secondary hover:text-foreground'
            }`}
          >
            {windowOption}
            {isActive && (
              <motion.span
                layoutId="order-history-underline"
                className="absolute left-2 right-2 -bottom-px h-0.5 bg-primary"
                transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.15, ease: 'easeInOut' as const }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

function OrderRowItem({ order }: { order: CustomerOrderRow }) {
  const router = useRouter()
  const total275 = sumPoSize(order, '275')
  const total330 = sumPoSize(order, '330')
  const goToOrder = () => router.push(`/orders?id=${order.id}`)
  return (
    <tr
      role="link"
      tabIndex={0}
      aria-label={`View order ${order.po_number}`}
      onClick={goToOrder}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          goToOrder()
        }
      }}
      className="border-b border-border last:border-0 cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <td className="py-3 px-3 text-sm font-medium text-foreground">{order.po_number}</td>
      <td className="py-3 px-3 text-sm text-secondary">{order.requested_delivery_date ?? '—'}</td>
      <td className="py-3 px-3 text-sm text-foreground tabular-nums text-right">
        {formatPoTotal(total275)}
      </td>
      <td className="py-3 px-3 text-sm text-foreground tabular-nums text-right">
        {formatPoTotal(total330)}
      </td>
      <td className="py-3 px-3 text-sm">
        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_CLASS[order.status]}`}>
          {order.status}
        </span>
      </td>
      <td className="py-3 px-3 text-sm text-foreground text-right">{formatCurrency(order.price)}</td>
      <td className="py-3 px-3 w-8 text-center">
        {order.backhaul && <BackhaulTag />}
      </td>
    </tr>
  )
}

function OrdersTable({ orders }: { orders: CustomerOrderRow[] }) {
  if (orders.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm text-muted-foreground">
        No orders in this window.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
            <th className="py-2 px-3 font-medium">PO#</th>
            <th className="py-2 px-3 font-medium">Date</th>
            <th className="py-2 px-3 font-medium text-right">275</th>
            <th className="py-2 px-3 font-medium text-right">330</th>
            <th className="py-2 px-3 font-medium">Status</th>
            <th className="py-2 px-3 font-medium text-right">Price</th>
            <th className="py-2 px-3 w-8 text-center font-medium">
              <span className="sr-only">Backhaul</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <OrderRowItem key={order.id} order={order} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Orders-by-time-window panel inside the customer detail view. Owns the active
 * window as a URL query param (`?window=1M|3M|6M|1Y|YTD`); switching tabs calls
 * `router.push` inside a transition so the server re-renders the orders list
 * without blocking the UI. Uses a `layoutId` underline that slides between
 * tabs and an `AnimatePresence` crossfade keyed on the active window.
 */
export default function OrderHistory({ orders, window }: OrderHistoryProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const shouldReduceMotion = useReducedMotion()
  const contentVariants = useMemo(
    () => buildTabContentVariants(shouldReduceMotion),
    [shouldReduceMotion],
  )

  const handleChange = (next: CustomerOrdersWindow) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set('window', next)
    startTransition(() => router.push(`${pathname}?${params.toString()}`))
  }

  return (
    <section aria-label="Order history" className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary">
          Order History
        </h3>
      </div>
      <WindowTabs window={window} onChange={handleChange} isPending={isPending} />
      <div className={`mt-3 transition-opacity ${isPending ? 'opacity-60' : 'opacity-100'}`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={window}
            initial="initial"
            animate="animate"
            exit="exit"
            variants={contentVariants}
          >
            <OrdersTable orders={orders} />
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}
