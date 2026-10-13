'use client'

import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { MAX_EMBEDDED_IMAGE_PIXELS } from '@/lib/extraction/extraction.constants'

/** An open PDF and the one call that releases it and its worker. */
export interface OpenedPdf {
  document: PDFDocumentProxy
  /** Destroys the document, then terminates its worker. Safe to call once per open. */
  close: () => Promise<void>
}

/** The worker, served by the app from pdfjs-dist — never from a CDN (Task 117). */
function startWorker(): Worker {
  return new Worker(new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url), { type: 'module' })
}

/**
 * Opens a PDF in the browser with pdf.js (Task 117, A-15).
 *
 * pdf.js is imported here on demand, so it never enters the main bundle. The
 * legacy build is used, as on the server: it supports older iPad Safari. Each
 * open gets its own worker, terminated by `close`; pdf.js does not terminate a
 * worker it was handed.
 *
 * No font, CMap, colour-profile or wasm URL is set, so pdf.js fetches nothing
 * but `url` itself. Embedded images are capped as on the server (@security
 * M-04). The spec's `isEvalSupported: false` no longer exists: pdf.js 6 never
 * compiles code from a file, so there is nothing to switch off.
 *
 * @param url - A signed Storage URL for the PDF.
 * @returns The open document plus its `close`.
 * @throws Whatever pdf.js throws for an unreadable file or a failed fetch;
 *   the worker is already released when it does.
 */
export async function openPdf(url: string): Promise<OpenedPdf> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const port = startWorker()
  // pdf.js's own types mistype `port` as `null`; it accepts a Worker.
  const worker = new pdfjs.PDFWorker({ port: port as unknown as null })
  const task = pdfjs.getDocument({ url, worker, maxImageSize: MAX_EMBEDDED_IMAGE_PIXELS })

  async function close() {
    try {
      await task.destroy()
    } finally {
      worker.destroy()
      port.terminate()
    }
  }

  try {
    return { document: await task.promise, close }
  } catch (cause) {
    await close().catch((closeError: unknown) => {
      console.error('openPdf: could not release a PDF that failed to open', { closeError })
    })
    throw cause
  }
}
