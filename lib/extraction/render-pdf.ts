import { createRequire } from 'node:module'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import {
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDF_RENDER_SCALE } from './extraction.constants'
import { PdfRenderError, PdfTooManyPagesError } from './errors'

/**
 * Turns a PDF into one PNG per page — the only form in which a PDF reaches the
 * model (CONSTRAINT-35/36). The model never sees PDF bytes, so a PDF and a
 * scanned image of the same PO are read by exactly the same path.
 *
 * **Node only.** This uses pdfjs-dist's legacy build, which is the one that
 * runs outside a browser, and `@napi-rs/canvas` as its drawing surface. In
 * Node, pdfjs parses on the main thread (a "fake worker") rather than in a
 * Web Worker, and every fetch-, font-face- and OffscreenCanvas-dependent
 * feature is pinned off below rather than left to environment detection, so a
 * future pdfjs default change cannot quietly start reaching for the network.
 *
 * **Page count is checked before any page is drawn.** A document over the
 * limit fails with `PdfTooManyPagesError` and nothing is rendered — never
 * truncated to the first N pages (CONSTRAINT-34).
 */

/**
 * pdfjs-dist's install directory. Fonts, CMaps, colour profiles and image
 * decoders ship inside the package and are read from disk, never fetched.
 */
const PDFJS_ROOT = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))

/**
 * A pdfjs data directory. In Node pdfjs reads these with `fs.readFile`, so they
 * are plain paths — but pdfjs insists on a trailing `/` (not `\`), and Node
 * accepts forward slashes on Windows too.
 */
function pdfjsDir(name: string): string {
  return `${path.join(PDFJS_ROOT, name).split(path.sep).join('/')}/`
}

/**
 * Renders every page of `pdf` to a PNG at `PDF_RENDER_SCALE`.
 *
 * @param pdf - The raw PDF bytes. Not mutated; pdfjs is handed a copy.
 * @param maxPages - Most pages accepted. Callers pass `MAX_PDF_PAGES`; it is a
 *   parameter so tests can exercise the limit without building large PDFs.
 * @returns One PNG buffer per page, in page order.
 * @throws {PdfTooManyPagesError} The document has more than `maxPages` pages.
 *   Thrown before any page is rendered.
 * @throws {PdfRenderError} The bytes are not a readable PDF, or a page failed
 *   to render or encode. The underlying error is attached as `cause`.
 */
export async function renderPdfPages(pdf: Buffer, maxPages: number): Promise<Buffer[]> {
  const task = startLoading(pdf)
  try {
    const doc = await openDocument(task)
    if (doc.numPages > maxPages) {
      throw new PdfTooManyPagesError(doc.numPages, maxPages)
    }
    const pages: Buffer[] = []
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      pages.push(await renderPage(doc, pageNumber))
    }
    return pages
  } finally {
    // The loading task owns the document and its fake worker; destroying it
    // releases both, on success and on every failure path. Awaited so a
    // teardown failure surfaces rather than leaking past the caller.
    await task.destroy()
  }
}

/** Starts parsing the bytes. Node-only, network-free options throughout. */
function startLoading(pdf: Buffer): PDFDocumentLoadingTask {
  return getDocument({
    // pdfjs transfers (detaches) the buffer it is given; copy so the caller's
    // Buffer stays intact for whatever the caller does with it next.
    data: new Uint8Array(pdf),
    standardFontDataUrl: pdfjsDir('standard_fonts'),
    cMapUrl: pdfjsDir('cmaps'),
    cMapPacked: true,
    iccUrl: pdfjsDir('iccs'),
    wasmUrl: pdfjsDir('wasm'),
    useWorkerFetch: false,
    useSystemFonts: false,
    disableFontFace: true,
    isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false,
    stopAtErrors: true,
    // Errors only: pdfjs otherwise warns to the console about recoverable
    // oddities, which is noise in server logs. Failures still throw.
    verbosity: 0,
  })
}

/** Waits for the parse, mapping any failure to `PdfRenderError`. */
async function openDocument(task: PDFDocumentLoadingTask): Promise<PDFDocumentProxy> {
  try {
    return await task.promise
  } catch (error) {
    throw new PdfRenderError(`could not open document (${describe(error)})`, { cause: error })
  }
}

/** Draws one page onto a fresh canvas and encodes it as PNG. */
async function renderPage(doc: PDFDocumentProxy, pageNumber: number): Promise<Buffer> {
  try {
    const page = await doc.getPage(pageNumber)
    try {
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      // pdfjs types its canvas as a DOM element; @napi-rs/canvas is the Node
      // implementation pdfjs itself uses for its NodeCanvasFactory.
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise
      return await canvas.encode('png')
    } finally {
      page.cleanup()
    }
  } catch (error) {
    throw new PdfRenderError(`page ${pageNumber} of ${doc.numPages} failed (${describe(error)})`, {
      cause: error,
    })
  }
}

/** Error class name only — a pdfjs message can quote document content (SEC-01). */
function describe(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}
