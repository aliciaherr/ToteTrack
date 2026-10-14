'use client'

import { useEffect, useState } from 'react'
import { X, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** The two kinds of source that can be expanded. `truncated`: only the body's start was sent (LOW-T106-1). */
export type ExpandableSource = { kind: 'image'; url: string } | { kind: 'text'; text: string; truncated: boolean }

/** Shown under a capped email body, here and in the source pane (LOW-T106-1). */
export const TRUNCATED_BODY_NOTE = 'Only the start is shown; open it in Gmail for the rest.'

interface ExpandedSourceProps {
  source: ExpandableSource
  onClose: () => void
}

// Zoom bounds: 1× fits the screen; 4× is enough to read a phone photo's small print.
export const ZOOM_MIN = 1
export const ZOOM_MAX = 4
export const ZOOM_STEP = 0.5

/**
 * Esc closes this view only. Captured at the window and stopped there, so the
 * overlay's own Esc handler underneath never sees the key.
 */
function useEscapeFirst(onClose: () => void) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', handleKey, { capture: true })
    return () => window.removeEventListener('keydown', handleKey, { capture: true })
  }, [onClose])
}

function ZoomControls({ zoom, setZoom }: { zoom: number; setZoom: (zoom: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        aria-label="Zoom out"
        disabled={zoom <= ZOOM_MIN}
        onClick={() => setZoom(Math.max(ZOOM_MIN, zoom - ZOOM_STEP))}
        className="min-h-[44px] min-w-[44px]"
      >
        <ZoomOut aria-hidden="true" />
      </Button>
      <span className="w-12 text-center text-sm text-white tabular-nums" aria-live="polite">
        {Math.round(zoom * 100)}%
      </span>
      <Button
        type="button"
        variant="outline"
        aria-label="Zoom in"
        disabled={zoom >= ZOOM_MAX}
        onClick={() => setZoom(Math.min(ZOOM_MAX, zoom + ZOOM_STEP))}
        className="min-h-[44px] min-w-[44px]"
      >
        <ZoomIn aria-hidden="true" />
      </Button>
    </div>
  )
}

/**
 * A PO image or email text, full screen, with zoom between `ZOOM_MIN` and
 * `ZOOM_MAX` (Task 106). Rendered inside the overlay, which narrows its focus
 * trap to this dialog while it is up.
 */
export default function ExpandedSource({ source, onClose }: ExpandedSourceProps) {
  const [zoom, setZoom] = useState(ZOOM_MIN)
  useEscapeFirst(onClose)

  return (
    <div role="dialog" aria-modal="true" aria-label="Expanded document" className="fixed inset-0 z-[60] flex flex-col bg-black/90">
      <div className="flex items-center justify-between gap-2 p-3">
        <ZoomControls zoom={zoom} setZoom={setZoom} />
        <Button type="button" variant="outline" aria-label="Close expanded view" onClick={onClose} className="min-h-[44px] min-w-[44px]">
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {source.kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed Storage URL; next/image would need the host allow-listed and would cache it.
          <img src={source.url} alt="PO image, enlarged" style={{ width: `${zoom * 100}%` }} className="max-w-none mx-auto" />
        ) : (
          <>
            {source.truncated && <p className="mb-2 text-sm text-white">{TRUNCATED_BODY_NOTE}</p>}
            <pre
              style={{ fontSize: `${zoom}rem` }}
              className="whitespace-pre-wrap break-words font-sans text-white bg-transparent"
            >
              {source.text}
            </pre>
          </>
        )}
      </div>
    </div>
  )
}
