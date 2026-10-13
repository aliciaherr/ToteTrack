'use client'

import { useRef } from 'react'
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
  if (queue.status === 'empty') return <p className="p-6 text-sm text-secondary">Nothing to review.</p>
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

function Header({ position, onClose }: { position: string | null; onClose: () => void }) {
  return (
    <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-card">
      <div className="flex items-baseline gap-3">
        <h2 id="review-overlay-title" className="text-lg font-semibold text-foreground">
          Review
        </h2>
        {position && <p className="text-sm text-secondary">{position}</p>}
      </div>
      <Button type="button" variant="outline" aria-label="Close review" onClick={onClose} className="min-h-[44px] min-w-[44px]">
        <X aria-hidden="true" />
      </Button>
    </header>
  )
}

/**
 * The review screen (Task 106): a full-screen overlay over the current page,
 * opened from "Review" in the menu. Not a route, so a refresh closes it.
 * Left pane is the PO's source; the right pane is its pre-filled order form
 * (Tasks 118, 119). Side by side from iPad landscape width up, stacked below it.
 * Esc and the close button leave the page underneath untouched; `AppShell`
 * mounts this only while open and returns focus to the menu button.
 */
export default function ReviewOverlay({ onClose }: ReviewOverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const { queue, source, fields, retry, retryFields, markSourceFailed } = useReviewQueue()
  useEscapeClose(true, onClose, false)
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
      <Header position={position} onClose={onClose} />
      {queue.status === 'ready' ? (
        <div className="flex-1 min-h-0 grid gap-4 overflow-y-auto p-4 lg:grid-cols-2 lg:overflow-hidden">
          <section aria-label="PO document" className="rounded-lg bg-card shadow-sm lg:min-h-0 lg:overflow-auto">
            <SourcePane state={source} onRetry={retry} onLoadError={markSourceFailed} />
          </section>
          <section aria-label="PO details" className="rounded-lg bg-card shadow-sm lg:min-h-0 lg:overflow-auto">
            <ReviewFieldsPane key={queue.ids[0]} state={fields} onRetry={retryFields} />
          </section>
        </div>
      ) : (
        <QueueMessage queue={queue} onRetry={retry} />
      )}
    </div>
  )
}
