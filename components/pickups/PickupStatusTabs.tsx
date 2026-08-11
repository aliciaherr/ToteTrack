'use client'

import { motion, useReducedMotion } from 'framer-motion'
import type { PickupListStatus } from '@/db/queries/pickups'

// A pickup has exactly three statuses and no billed sub-state, so each tab
// maps 1:1 onto a `pickups.status` value — unlike the Orders tabs, where
// "Completed" also matches `invoiced`.
const STATUS_OPTIONS: { value: PickupListStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

// Framer Motion slides one shared element between the tabs that declare the
// same `layoutId`. This value MUST be unique to this tab group — reusing the
// Orders tabs' `order-status-tab-pill` (or Order History's
// `order-history-underline`) would make the two groups fight over a single
// pill whenever both are mounted, animating it across the screen.
const PICKUP_TAB_PILL_LAYOUT_ID = 'pickup-status-tab-pill'

interface PickupStatusTabsProps {
  status: PickupListStatus
  onChange: (next: PickupListStatus) => void
}

/**
 * Status filter tabs for the pickups table: All / Scheduled / Completed /
 * Cancelled. Purely presentational — the active value comes from the URL and
 * `onChange` navigates.
 */
export default function PickupStatusTabs({ status, onChange }: PickupStatusTabsProps) {
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
                layoutId={PICKUP_TAB_PILL_LAYOUT_ID}
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
