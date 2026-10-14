'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { isCheckStale } from '@/lib/ingest/ingest-status-display'
import PillHamburger from './PillHamburger'
import NavDrawer from './NavDrawer'
import IngestStatusPanel from './IngestStatusPanel'
import ReviewOverlay from '@/components/review/ReviewOverlay'
import { DrawerStateProvider } from './drawer-state'
import { useIngestStatus } from './useIngestStatus'

/**
 * Root shell for all authenticated routes under `app/(app)/`. Owns drawer-open
 * state and mounts the chrome: the fixed pill-hamburger button (top-left) and
 * the Framer Motion slide-over NavDrawer that the button triggers.
 *
 * Children are wrapped in `DrawerStateProvider` so descendant client components
 * (e.g., the dashboard QuickAddFab) can read drawer-open state without
 * prop-drilling.
 *
 * Also owns the review-queue status (Task 105): the pill shows the undecided
 * count, the drawer shows the details. Held here, not in the drawer, so a
 * "Check mail now" keeps polling after the drawer closes.
 *
 * Owns the review overlay's open state too (Task 106): "Review" closes the
 * drawer and opens it; closing it returns focus to the menu button, because
 * the "Review" button left with the drawer.
 *
 * The `pt-3` on main keeps a thin 12px buffer at the very top so content
 * shares the same horizontal band as the pill (which sits at top-6/left-6,
 * 44×44px → occupies y=24–68px). Pages are responsible for left-padding
 * their first row enough to clear the pill horizontally (~80px from the
 * viewport edge).
 */
/**
 * The review overlay's open state, and the menu button focus returns to on
 * close. Closing also runs `onClosed` (the status re-read), so the badge counts
 * the decisions just taken (Task 120).
 */
function useReviewOverlayState(closeDrawer: () => void, onClosed: () => void) {
  const [isOpen, setIsOpen] = useState(false)
  const wasOpenRef = useRef(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const open = useCallback(() => {
    closeDrawer()
    setIsOpen(true)
  }, [closeDrawer])
  const close = useCallback(() => {
    setIsOpen(false)
    onClosed()
  }, [onClosed])

  useEffect(() => {
    if (wasOpenRef.current && !isOpen) menuButtonRef.current?.focus()
    wasOpenRef.current = isOpen
  }, [isOpen])

  return { isReviewOpen: isOpen, openReview: open, closeReview: close, menuButtonRef }
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const ingest = useIngestStatus()
  const { refresh } = ingest
  const openDrawer = useCallback(() => {
    setIsDrawerOpen(true)
    void refresh()
  }, [refresh])
  const closeDrawer = useCallback(() => setIsDrawerOpen(false), [])
  const refreshStatus = useCallback(() => void refresh(), [refresh])
  const { isReviewOpen, openReview, closeReview, menuButtonRef } = useReviewOverlayState(closeDrawer, refreshStatus)

  // A failed read hides the badge: a stale number would look trustworthy.
  const status = ingest.hasLoadError ? null : ingest.status
  const pendingCount = status ? status.toReview + status.beingRead : 0
  const needsAttention = status !== null && (status.failingCount > 0 || isCheckStale(status.lastRunAt, new Date()))

  return (
    <div className="min-h-svh bg-app-bg">
      <PillHamburger ref={menuButtonRef} onClick={openDrawer} pendingCount={pendingCount} needsAttention={needsAttention} />
      <NavDrawer
        isOpen={isDrawerOpen}
        onClose={closeDrawer}
        reviewQueue={
          <IngestStatusPanel
            status={ingest.status}
            hasLoadError={ingest.hasLoadError}
            isChecking={ingest.isChecking}
            onRetry={refresh}
            onCheckMail={ingest.checkMail}
            onReview={openReview}
          />
        }
      />
      {isReviewOpen && <ReviewOverlay onClose={closeReview} />}
      <DrawerStateProvider isOpen={isDrawerOpen}>
        <main className="pt-3">{children}</main>
      </DrawerStateProvider>
    </div>
  )
}
