'use client'

import { motion, useReducedMotion } from 'framer-motion'
import type { OrderListStatus } from '@/db/queries/orders'

// Tabs reflect the v2 PO model. `pending` is gone; `invoiced` is folded into
// the `Completed` tab (`getOrders` matches `status IN ('completed', 'invoiced')`
// when the filter is `'completed'`) so the salesperson doesn't need to think
// about whether something has been billed yet.
const STATUS_OPTIONS: { value: OrderListStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

// Shared layoutId — Framer Motion uses this to slide the active-tab pill
// background between tabs instead of cross-fading. Unique per tab group.
const ACTIVE_PILL_LAYOUT_ID = 'order-status-tab-pill'

interface OrderStatusTabsProps {
  status: OrderListStatus
  onChange: (next: OrderListStatus) => void
}

export default function OrderStatusTabs({ status, onChange }: OrderStatusTabsProps) {
  const shouldReduceMotion = useReducedMotion()
  const pillTransition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.15, ease: 'easeInOut' as const }

  return (
    <div
      role="tablist"
      className="inline-flex flex-wrap rounded-lg border border-border bg-card p-0.5"
    >
      {STATUS_OPTIONS.map(({ value, label }) => {
        const isActive = status === value
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(value)}
            className="relative min-h-[44px] px-4 text-sm font-medium rounded-md"
          >
            {isActive && (
              <motion.span
                layoutId={ACTIVE_PILL_LAYOUT_ID}
                className="absolute inset-0 bg-primary rounded-md"
                transition={pillTransition}
                aria-hidden="true"
              />
            )}
            <span
              className={`relative z-10 transition-colors ${
                isActive ? 'text-primary-foreground' : 'text-secondary hover:text-foreground'
              }`}
            >
              {label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
