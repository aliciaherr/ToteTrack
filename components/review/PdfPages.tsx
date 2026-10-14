'use client'

import { useRef, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { MAX_PDF_PAGES } from '@/lib/extraction/extraction.constants'
import ExpandedSource from './ExpandedSource'
import { useEnlargedPage } from './useEnlargedPage'
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

interface PageListProps {
  canvases: HTMLCanvasElement[]
  /** `opener` is the page button tapped, where focus returns on close. */
  onExpand: (canvas: HTMLCanvasElement, opener: HTMLElement) => void
}

function PageList({ canvases, onExpand }: PageListProps) {
  return (
    <ol className="space-y-2">
      {canvases.map((canvas, index) => (
        <li key={index}>
          <button
            type="button"
            onClick={(event) => onExpand(canvas, event.currentTarget)}
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

/** The drawn pages, the file link, and the enlarged page while one is open. */
function ReadyPages({ url, canvases, totalPages }: { url: string; canvases: HTMLCanvasElement[]; totalPages: number }) {
  const enlarged = useEnlargedPage()
  const openerRef = useRef<HTMLElement | null>(null)

  function handleExpand(canvas: HTMLCanvasElement, opener: HTMLElement) {
    openerRef.current = opener
    enlarged.enlarge(canvas)
  }

  return (
    <div className="space-y-3 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {totalPages > MAX_PDF_PAGES ? (
          <p className="text-sm text-secondary">Only the first {MAX_PDF_PAGES} pages are shown.</p>
        ) : (
          <span />
        )}
        <OpenFileLink url={url} />
      </div>
      {enlarged.failed && (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t enlarge this page. Open the file to zoom in.
        </p>
      )}
      <PageList canvases={canvases} onExpand={handleExpand} />
      {enlarged.url && (
        <ExpandedSource source={{ kind: 'image', url: enlarged.url }} onClose={enlarged.close} returnFocusRef={openerRef} />
      )}
    </div>
  )
}

/**
 * A PDF PO drawn page by page with pdf.js (Task 117). Shows the first
 * `MAX_PDF_PAGES` pages; tapping one opens it full screen with zoom. Mount it
 * once per document (the review overlay keys its source pane by PO).
 *
 * The pages are drawn from the URL it mounted with; a later `url` is the same
 * file re-signed (`useSourceResign`), so it only refreshes the "Open the file"
 * link and never redraws the pages.
 */
export default function PdfPages({ url }: { url: string }) {
  const [drawUrl] = useState(url)
  const state = usePdfPages(drawUrl)

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
  return <ReadyPages url={url} canvases={state.canvases} totalPages={state.totalPages} />
}
