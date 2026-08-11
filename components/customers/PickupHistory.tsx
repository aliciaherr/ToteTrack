'use client'

import { useTransition, useMemo } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { PickupsTable } from './PickupHistoryParts'
import type { CustomerPickupRow, CustomerPickupsWindow } from '@/db/queries/pickups'

const WINDOWS: CustomerPickupsWindow[] = ['1M', '3M', '6M', '1Y', 'YTD']

// The query param this panel owns. Deliberately NOT `window` — Order History
// already owns that one on this same screen, and sharing it would make a click
// on either panel's tabs silently re-filter the other.
const WINDOW_PARAM = 'pwindow'

// Framer Motion slides one shared element between every tab declaring the same
// `layoutId`. This MUST differ from Order History's `order-history-underline`:
// both panels are mounted together on the customer detail view, so a shared id
// would make a single underline fly between the two sections on every click.
const UNDERLINE_LAYOUT_ID = 'pickup-history-underline'

const TAB_TRANSITION_SECONDS = 0.15

interface PickupHistoryProps {
  pickups: CustomerPickupRow[]
  window: CustomerPickupsWindow
  // Total undated open pickups for this customer. Not window-scoped and not
  // derivable from `pickups` — every window excludes a NULL date — so it is the
  // same number on every tab.
  unscheduledCount: number
}

function buildTabContentVariants(shouldReduceMotion: boolean | null) {
  const duration = shouldReduceMotion ? 0 : TAB_TRANSITION_SECONDS
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
  window: CustomerPickupsWindow
  onChange: (next: CustomerPickupsWindow) => void
  isPending: boolean
}) {
  const shouldReduceMotion = useReducedMotion()
  return (
    <div role="tablist" aria-label="Pickup history time window" className="flex items-center gap-1 border-b border-border relative">
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
                layoutId={UNDERLINE_LAYOUT_ID}
                className="absolute left-2 right-2 -bottom-px h-0.5 bg-primary"
                transition={shouldReduceMotion ? { duration: 0 } : { duration: TAB_TRANSITION_SECONDS, ease: 'easeInOut' as const }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

// The undated-pickup note. `text-muted-foreground` is the palette's quietest
// text — the same token the table's column labels and empty state already use,
// one step back from the heading's `text-secondary`. Weight and case are reset
// so the suffix reads as an aside to the heading rather than part of it. No
// badge, pill, accent or icon: this is a fact, not an alert.
const UNSCHEDULED_NOTE_CLASS =
  'font-normal normal-case tracking-normal text-muted-foreground'

function PickupHistoryHeading({ unscheduledCount }: { unscheduledCount: number }) {
  return (
    <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary">
      Pickup History
      {/* Explicit space: JSX drops the newline between the title and the span,
          which would run the two together in the accessible name. */}
      {unscheduledCount > 0 && (
        <>
          {' '}
          <span className={UNSCHEDULED_NOTE_CLASS}>· {unscheduledCount} unscheduled</span>
        </>
      )}
    </h3>
  )
}

/**
 * Pickups-by-time-window panel inside the customer detail view, rendered below
 * Order History with the same card chrome and tab behaviour. Owns the active
 * window as its own URL query param (`?pwindow=1M|3M|6M|1Y|YTD`) so it neither
 * drives nor is driven by Order History's `?window=`; switching tabs calls
 * `router.push` inside a transition so the server re-renders the pickup list
 * without blocking the UI. Rows link to `/pickups?id=…`.
 *
 * The row list is date-filtered by the window, which by definition excludes
 * pickups with no date. Those are reported quietly in the heading instead —
 * `Pickup History · N unscheduled` — so a customer whose pickups are all
 * undated no longer reads as a customer with no pickups at all.
 */
export default function PickupHistory({
  pickups,
  window,
  unscheduledCount,
}: PickupHistoryProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const shouldReduceMotion = useReducedMotion()
  const contentVariants = useMemo(
    () => buildTabContentVariants(shouldReduceMotion),
    [shouldReduceMotion],
  )

  const handleChange = (next: CustomerPickupsWindow) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.set(WINDOW_PARAM, next)
    startTransition(() => router.push(`${pathname}?${params.toString()}`))
  }

  return (
    <section aria-label="Pickup history" className="bg-card rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <PickupHistoryHeading unscheduledCount={unscheduledCount} />
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
            <PickupsTable pickups={pickups} />
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}
