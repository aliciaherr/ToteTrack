'use client'

import { Menu } from 'lucide-react'
import { badgeLabel } from '@/lib/ingest/ingest-status-display'

interface PillHamburgerProps {
  onClick: () => void
  /** Lets `AppShell` return focus here when the review overlay closes. */
  ref?: React.Ref<HTMLButtonElement>
  /** Undecided POs (Task 105). The bubble shows whenever this is above 0. */
  pendingCount?: number
  /** A stale last check or emails failing to import: the bubble turns warning-coloured. */
  needsAttention?: boolean
}

/**
 * Fixed-position pill-contained hamburger button rendered top-left on every
 * authenticated screen. Sole chrome element on `app/(app)/*` routes —
 * tapping it opens the slide-over NavDrawer.
 *
 * Size is 44×44px (touch-target minimum). Position is `top-6 left-6`
 * (24px from viewport edges, aligned with page content gutter).
 *
 * Carries the review-queue badge (Task 105): the count of every undecided PO,
 * hidden only at 0, so nothing ingested goes quiet before someone decides on it.
 */
export default function PillHamburger({ onClick, ref, pendingCount = 0, needsAttention = false }: PillHamburgerProps) {
  const hasPending = pendingCount > 0
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-label={hasPending ? `Open navigation, ${pendingCount} pending` : 'Open navigation'}
      className="fixed top-6 left-6 z-40 flex items-center justify-center w-11 h-11 rounded-full bg-card shadow-md hover:shadow-lg transition-shadow active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Menu className="h-5 w-5 text-secondary" aria-hidden="true" />
      {hasPending && (
        // White on amber-700 (#B45309) is ~5.0:1 and on primary teal ~5.1:1, both above
        // the 4.5:1 that 11px text needs. No warning token exists in globals.css yet.
        <span
          data-testid="pending-badge"
          data-attention={needsAttention}
          aria-hidden="true"
          className={`absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full text-[11px] font-semibold leading-5 text-center text-white ${needsAttention ? 'bg-amber-700' : 'bg-primary'}`}
        >
          {badgeLabel(pendingCount)}
        </span>
      )}
    </button>
  )
}
