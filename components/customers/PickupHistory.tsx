'use client'

import { useTransition, useMemo } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { formatPoTotal } from '@/components/shared/qtyGridValues'
import PickupStatusBadge from '@/components/pickups/PickupStatusBadge'
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

function PickupRowItem({ pickup }: { pickup: CustomerPickupRow }) {
  const router = useRouter()
  const goToPickup = () => router.push(`/pickups?id=${pickup.id}`)
  return (
    <tr
      role="link"
      tabIndex={0}
      aria-label={
        pickup.pickup_date ? `View pickup on ${pickup.pickup_date}` : 'View pickup'
      }
      onClick={goToPickup}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          goToPickup()
        }
      }}
      className="border-b border-border last:border-0 cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <td className="py-3 px-3 text-sm text-secondary">{pickup.pickup_date ?? '—'}</td>
      <td className="py-3 px-3 text-sm text-foreground tabular-nums text-right">
        {formatPoTotal(pickup.qty_275)}
      </td>
      <td className="py-3 px-3 text-sm text-foreground tabular-nums text-right">
        {formatPoTotal(pickup.qty_330)}
      </td>
      <td className="py-3 px-3 text-sm">
        <PickupStatusBadge status={pickup.status} size="sm" />
      </td>
    </tr>
  )
}

function PickupsTable({ pickups }: { pickups: CustomerPickupRow[] }) {
  if (pickups.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm text-muted-foreground">
        No pickups in this window.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
            <th className="py-2 px-3 font-medium">Date</th>
            <th className="py-2 px-3 font-medium text-right">275</th>
            <th className="py-2 px-3 font-medium text-right">330</th>
            <th className="py-2 px-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {pickups.map((pickup) => (
            <PickupRowItem key={pickup.id} pickup={pickup} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Pickups-by-time-window panel inside the customer detail view, rendered below
 * Order History with the same card chrome and tab behaviour. Owns the active
 * window as its own URL query param (`?pwindow=1M|3M|6M|1Y|YTD`) so it neither
 * drives nor is driven by Order History's `?window=`; switching tabs calls
 * `router.push` inside a transition so the server re-renders the pickup list
 * without blocking the UI. Rows link to `/pickups?id=…`.
 */
export default function PickupHistory({ pickups, window }: PickupHistoryProps) {
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
        <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary">
          Pickup History
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
            <PickupsTable pickups={pickups} />
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  )
}
