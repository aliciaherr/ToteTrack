'use client'

import { useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { MAX_PDF_PAGES } from '@/lib/extraction/extraction.constants'
import ExpandedSource from './ExpandedSource'
import { usePdfPages } from './usePdfPages'

/** The file itself, in Safari's own viewer: on every PDF view (the A-15 fallback). */
function OpenFileLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-md border border-border text-sm font-medium text-primary hover:bg-muted"
    >
      <ExternalLink className="size-4" aria-hidden="true" />
      Open the file
    </a>
  )
}

/** Mounts a canvas the hook already drew. */
function PageCanvas({ canvas }: { canvas: HTMLCanvasElement }) {
  return (
    <div
      className="[&>canvas]:block [&>canvas]:w-full [&>canvas]:h-auto [&>canvas]:rounded-md [&>canvas]:bg-white"
      ref={(holder) => holder?.replaceChildren(canvas)}
    />
  )
}

function PageList({ canvases, onExpand }: { canvases: HTMLCanvasElement[]; onExpand: (canvas: HTMLCanvasElement) => void }) {
  return (
    <ol className="space-y-2">
      {canvases.map((canvas, index) => (
        <li key={index}>
          <button
            type="button"
            onClick={() => onExpand(canvas)}
            aria-label={`Enlarge page ${index + 1}`}
            className="block w-full cursor-zoom-in"
          >
            <PageCanvas canvas={canvas} />
          </button>
        </li>
      ))}
    </ol>
  )
}

/**
 * A PDF PO drawn page by page with pdf.js (Task 117). Shows the first
 * `MAX_PDF_PAGES` pages; tapping one opens it full screen with zoom. Mount it
 * with `key={url}`.
 */
export default function PdfPages({ url }: { url: string }) {
  const state = usePdfPages(url)
  const [expandedUrl, setExpandedUrl] = useState<string | null>(null)

  if (state.status === 'loading') {
    return (
      <p className="flex items-center gap-2 p-4 text-sm text-secondary">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading PDF…
      </p>
    )
  }
  if (state.status === 'error') {
    return (
      <div role="alert" className="space-y-3 p-4">
        <p className="text-sm text-destructive">Couldn&apos;t display this PDF.</p>
        <OpenFileLink url={url} />
      </div>
    )
  }
  return (
    <div className="space-y-3 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {state.totalPages > MAX_PDF_PAGES ? (
          <p className="text-sm text-secondary">Only the first {MAX_PDF_PAGES} pages are shown.</p>
        ) : (
          <span />
        )}
        <OpenFileLink url={url} />
      </div>
      <PageList canvases={state.canvases} onExpand={(canvas) => setExpandedUrl(canvas.toDataURL('image/png'))} />
      {expandedUrl && <ExpandedSource source={{ kind: 'image', url: expandedUrl }} onClose={() => setExpandedUrl(null)} />}
    </div>
  )
}
