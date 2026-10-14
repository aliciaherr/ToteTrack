'use client'

import { useRef, useState } from 'react'
import { Loader2, RotateCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useEscapeClose, useFocusTrap } from '@/components/calendar/productionCardDialogHooks'
import ReviewFieldsPane from './ReviewFieldsPane'
import SourcePane from './SourcePane'
import { useReviewQueue, type ReviewQueueState } from './useReviewQueue'

interface ReviewOverlayProps {
  onClose: () => void
}

function QueueMessage({ queue, onRetry }: { queue: ReviewQueueState['queue']; onRetry: () => void }) {
  if (queue.status === 'loading') {
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-secondary">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading the review queue…
      </p>
    )
  }
  if (queue.status === 'empty') return <p className="p-6 text-sm text-secondary">You are all caught up.</p>
  return (
    <div role="alert" className="space-y-3 p-6">
      <p className="text-sm text-destructive">Couldn&apos;t load the review queue.</p>
      <Button type="button" variant="outline" onClick={onRetry} className="min-h-[44px]">
        <RotateCw aria-hidden="true" />
        Retry
      </Button>
    </div>
  )
}

interface HeaderProps {
  position: string | null
  onClose: () => void
  /** True while a decision is saving: closing now would hide its outcome. */
  closeDisabled: boolean
}

function Header({ position, onClose, closeDisabled }: HeaderProps) {
  return (
    <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-card">
      <div className="flex items-baseline gap-3">
        <h2 id="review-overlay-title" className="text-lg font-semibold text-foreground">
          Review
        </h2>
        {position && <p className="text-sm text-secondary">{position}</p>}
      </div>
      <Button
        type="button"
        variant="outline"
        aria-label="Close review"
        onClick={onClose}
        disabled={closeDisabled}
        className="min-h-[44px] min-w-[44px]"
      >
        <X aria-hidden="true" />
      </Button>
    </header>
  )
}

/**
 * The review screen (Task 106): a full-screen overlay over the current page,
 * opened from "Review" in the menu. Not a route, so a refresh closes it.
 * Left pane is the PO's source; the right pane is its pre-filled order form
 * (Tasks 118, 119), with Approve, Skip and Delete at its foot (Task 120); each
 * decision reloads the queue and shows its new first PO, so the header always
 * reads "1 of N". Side by side from iPad landscape width up, stacked below it.
 * Esc and the close button leave the page underneath untouched, and do
 * nothing while a decision is saving, so its error can never be hidden; `AppShell`
 * mounts this only while open and returns focus to the menu button.
 */
export default function ReviewOverlay({ onClose }: ReviewOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const { queue, source, fields, retry, retryFields, markSourceFailed, advance } = useReviewQueue()
  // Set by the decision buttons while Approve, Skip or Delete is in flight.
  const [decisionBusy, setDecisionBusy] = useState(false)
  useEscapeClose(true, onClose, decisionBusy)
  useFocusTrap(true, panelRef)

  const position = queue.status === 'ready' ? `1 of ${queue.ids.length}` : null

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-overlay-title"
      className="fixed inset-0 z-50 flex flex-col bg-app-bg"
    >
      <Header position={position} onClose={onClose} closeDisabled={decisionBusy} />
      {queue.status === 'ready' ? (
        // Each pane scrolls on its own, never the page: halves stacked below
        // iPad landscape width, side by side above it. The right pane pins
        // its decision buttons below its own scroll area.
        <div className="flex-1 min-h-0 grid grid-rows-2 gap-4 overflow-hidden p-4 lg:grid-cols-2 lg:grid-rows-1">
          <section aria-label="PO document" className="min-h-0 overflow-auto rounded-lg bg-card shadow-sm">
            {/* Keyed by PO: a new PO starts fresh, while its re-signed link keeps the drawn view. */}
            <SourcePane key={queue.ids[0]} state={source} onRetry={retry} onLoadError={markSourceFailed} />
          </section>
          <section aria-label="PO details" className="min-h-0 overflow-hidden rounded-lg bg-card shadow-sm">
            <ReviewFieldsPane
              key={queue.ids[0]}
              poId={queue.ids[0]}
              state={fields}
              onRetry={retryFields}
              onDecided={advance}
              onBusyChange={setDecisionBusy}
            />
          </section>
        </div>
      ) : (
        <QueueMessage queue={queue} onRetry={retry} />
      )}
    </div>
  )
}
