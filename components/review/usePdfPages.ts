'use client'

import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { MAX_PDF_PAGES } from '@/lib/extraction/extraction.constants'
import { PdfPageDrawError } from '@/lib/review/errors'
import { errorSummary, openPdf, type OpenedPdf } from './pdfjsClient'
import { MAX_PDF_VIEW_PIXELS, PDF_VIEW_SCALE } from './pdfView.constants'

export type PdfPagesState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; canvases: HTMLCanvasElement[]; totalPages: number }

/** The scale that draws a page at `PDF_VIEW_SCALE` × device pixel ratio, within `MAX_PDF_VIEW_PIXELS`. */
export function pageScale(width: number, height: number, pixelRatio: number): number {
  const scale = PDF_VIEW_SCALE * pixelRatio
  const pixels = width * height * scale * scale
  return pixels > MAX_PDF_VIEW_PIXELS ? scale * Math.sqrt(MAX_PDF_VIEW_PIXELS / pixels) : scale
}

async function drawPage(pdf: PDFDocumentProxy, pageNumber: number, pixelRatio: number): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNumber)
  const natural = page.getViewport({ scale: 1 })
  if (!(natural.width > 0 && natural.height > 0)) {
    throw new PdfPageDrawError(pageNumber, `has unusable dimensions ${natural.width}×${natural.height}`)
  }
  const viewport = page.getViewport({ scale: pageScale(natural.width, natural.height, pixelRatio) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  try {
    await page.render({ canvas, viewport }).promise
  } catch (cause) {
    releaseCanvases([canvas])
    throw new PdfPageDrawError(pageNumber, 'failed to render', cause)
  } finally {
    page.cleanup()
  }
  return canvas
}

/** Zeroes each canvas: iPad Safari frees canvas memory only when the size drops. */
function releaseCanvases(canvases: HTMLCanvasElement[]) {
  for (const canvas of canvases) {
    canvas.width = 0
    canvas.height = 0
  }
}

function closeAndLog(opened: OpenedPdf) {
  opened.close().catch((cause: unknown) => {
    console.error('usePdfPages: could not release the PDF document', errorSummary(cause))
  })
}

/**
 * Opens the PDF at `url` and draws its first `MAX_PDF_PAGES` pages, one canvas
 * each (Task 117). Unmounting destroys the document and its worker, and frees
 * the canvases. Mount it with `key={url}` so a new URL starts from `loading`.
 *
 * @param url - A signed Storage URL for the PDF. Never logged: it carries a token,
 *   so failures are logged through `errorSummary`.
 * @returns `loading`, then `ready` with the canvases and the document's page
 *   count, or `error` if the file would not open or a page would not draw.
 */
export function usePdfPages(url: string): PdfPagesState {
  const [state, setState] = useState<PdfPagesState>({ status: 'loading' })

  useEffect(() => {
    let isCancelled = false
    const canvases: HTMLCanvasElement[] = []
    const opening = openPdf(url)

    async function draw() {
      const { document: pdf } = await opening
      const shown = Math.min(pdf.numPages, MAX_PDF_PAGES)
      for (let pageNumber = 1; pageNumber <= shown && !isCancelled; pageNumber++) {
        canvases.push(await drawPage(pdf, pageNumber, window.devicePixelRatio || 1))
      }
      if (isCancelled) releaseCanvases(canvases)
      else setState({ status: 'ready', canvases: [...canvases], totalPages: pdf.numPages })
    }

    draw().catch((cause: unknown) => {
      // After unmount, a failure is the teardown cancelling the draw, not a broken file.
      if (isCancelled) return
      // Never the message: pdf.js puts the signed URL in it (SEC-05, LOW-T117-1).
      console.error('usePdfPages: could not display the PDF', errorSummary(cause))
      setState({ status: 'error' })
    })

    return () => {
      isCancelled = true
      releaseCanvases(canvases)
      // A failed open has already released its worker (openPdf), and draw() reports it.
      opening.then(closeAndLog, () => undefined)
    }
  }, [url])

  return state
}
