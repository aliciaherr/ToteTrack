'use client'

import { useRef, useState } from 'react'
import { Loader2, Maximize2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ReviewSource } from '@/lib/review/review-source'
import type { SourceState } from './useReviewQueue'
import ExpandedSource, { TRUNCATED_BODY_NOTE, type ExpandableSource } from './ExpandedSource'
import PdfPages from './PdfPages'
import RefusalCard from './RefusalCard'

interface SourcePaneProps {
  state: SourceState
  onRetry: () => void
  /** The image URL was signed but the browser could not draw it. */
  onLoadError: () => void
}

function LoadingView() {
  return (
    <p className="flex items-center gap-2 p-4 text-sm text-secondary">
      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
      Loading document…
    </p>
  )
}

function ErrorView({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="space-y-3 p-4">
      <p className="text-sm text-destructive">Couldn&apos;t load this document.</p>
      <Button type="button" variant="outline" onClick={onRetry} className="min-h-[44px]">
        <RotateCw aria-hidden="true" />
        Retry
      </Button>
    </div>
  )
}

/** Opens the expanded view; `opener` is the button tapped, where focus returns on close. */
type ExpandHandler = (opener: HTMLElement) => void

function ImageView({ url, onExpand, onLoadError }: { url: string; onExpand: ExpandHandler; onLoadError: () => void }) {
  return (
    <button type="button" onClick={(event) => onExpand(event.currentTarget)} aria-label="Enlarge PO image" className="block w-full p-2 cursor-zoom-in">
      {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Storage URL; next/image would need the host allow-listed and would cache it. */}
      <img src={url} alt="PO image" onError={onLoadError} className="w-full h-auto rounded-md" />
    </button>
  )
}

/**
 * Email text as plain text: React escapes it, so HTML shows as literal characters.
 * A capped body says so above the text (LOW-T106-1).
 */
function TextView({ text, truncated, onExpand }: { text: string; truncated: boolean; onExpand: ExpandHandler }) {
  return (
    <div className="space-y-2 p-4">
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={(event) => onExpand(event.currentTarget)} className="min-h-[44px]">
          <Maximize2 aria-hidden="true" />
          Expand
        </Button>
      </div>
      {truncated && <p className="text-sm text-secondary">{TRUNCATED_BODY_NOTE}</p>}
      <pre className="whitespace-pre-wrap break-words font-sans text-sm text-foreground">{text}</pre>
    </div>
  )
}

function ReadyView({ source, onExpand, onLoadError }: { source: ReviewSource; onExpand: ExpandHandler; onLoadError: () => void }) {
  switch (source.kind) {
    case 'image':
      return <ImageView url={source.url} onExpand={onExpand} onLoadError={onLoadError} />
    case 'text':
      return <TextView text={source.text} truncated={source.truncated} onExpand={onExpand} />
    case 'pdf':
      // No `key` by URL: a re-signed link must not redraw the pages (see PdfPages).
      return <PdfPages url={source.url} />
    case 'refused':
      return <RefusalCard refusal={source.refusal} email={source.email} />
  }
}

function expandableOf(state: SourceState): ExpandableSource | null {
  if (state.status !== 'ready') return null
  const { source } = state
  if (source.kind === 'image') return { kind: 'image', url: source.url }
  if (source.kind === 'text') return source
  return null
}

/** The review overlay's left pane: one PO's source, by kind (Task 106). */
export default function SourcePane({ state, onRetry, onLoadError }: SourcePaneProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const openerRef = useRef<HTMLElement | null>(null)
  const expandable = expandableOf(state)

  function handleExpand(opener: HTMLElement) {
    openerRef.current = opener
    setIsExpanded(true)
  }

  if (state.status === 'loading') return <LoadingView />
  if (state.status === 'error') return <ErrorView onRetry={onRetry} />
  return (
    <>
      <ReadyView source={state.source} onExpand={handleExpand} onLoadError={onLoadError} />
      {isExpanded && expandable && (
        <ExpandedSource source={expandable} onClose={() => setIsExpanded(false)} returnFocusRef={openerRef} />
      )}
    </>
  )
}
