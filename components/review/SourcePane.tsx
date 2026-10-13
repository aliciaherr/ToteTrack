'use client'

import { useState } from 'react'
import { ExternalLink, FileText, Loader2, Maximize2, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ReviewSource } from '@/lib/review/review-source'
import type { SourceState } from './useReviewQueue'
import ExpandedSource, { type ExpandableSource } from './ExpandedSource'
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

/** Until Task 117 draws PDFs in place: a holding message and the file itself. */
function PdfHoldingView({ url }: { url: string }) {
  return (
    <div className="space-y-3 p-4">
      <p className="flex items-center gap-2 text-sm text-secondary">
        <FileText className="size-4" aria-hidden="true" />
        PDF preview arrives with Task 117
      </p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-md border border-border text-sm font-medium text-primary hover:bg-muted"
      >
        <ExternalLink className="size-4" aria-hidden="true" />
        Open the file
      </a>
    </div>
  )
}

function ImageView({ url, onExpand, onLoadError }: { url: string; onExpand: () => void; onLoadError: () => void }) {
  return (
    <button type="button" onClick={onExpand} aria-label="Enlarge PO image" className="block w-full p-2 cursor-zoom-in">
      {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Storage URL; next/image would need the host allow-listed and would cache it. */}
      <img src={url} alt="PO image" onError={onLoadError} className="w-full h-auto rounded-md" />
    </button>
  )
}

/** Email text as plain text: React escapes it, so HTML shows as literal characters. */
function TextView({ text, onExpand }: { text: string; onExpand: () => void }) {
  return (
    <div className="space-y-2 p-4">
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={onExpand} className="min-h-[44px]">
          <Maximize2 aria-hidden="true" />
          Expand
        </Button>
      </div>
      <pre className="whitespace-pre-wrap break-words font-sans text-sm text-foreground">{text}</pre>
    </div>
  )
}

function ReadyView({ source, onExpand, onLoadError }: { source: ReviewSource; onExpand: () => void; onLoadError: () => void }) {
  switch (source.kind) {
    case 'image':
      return <ImageView url={source.url} onExpand={onExpand} onLoadError={onLoadError} />
    case 'text':
      return <TextView text={source.text} onExpand={onExpand} />
    case 'pdf':
      return <PdfHoldingView url={source.url} />
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
  const expandable = expandableOf(state)

  if (state.status === 'loading') return <LoadingView />
  if (state.status === 'error') return <ErrorView onRetry={onRetry} />
  return (
    <>
      <ReadyView source={state.source} onExpand={() => setIsExpanded(true)} onLoadError={onLoadError} />
      {isExpanded && expandable && <ExpandedSource source={expandable} onClose={() => setIsExpanded(false)} />}
    </>
  )
}
