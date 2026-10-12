import { createRequire } from 'node:module'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import {
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PageViewport,
  type RenderTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import {
  MAX_EMBEDDED_IMAGE_PIXELS,
  MAX_RENDER_PIXELS,
  PDF_RENDER_SCALE,
  PDF_RENDER_TIMEOUT_MS,
} from './extraction.constants'
import {
  PdfPageTooLargeError,
  PdfRenderError,
  PdfRenderTimeoutError,
  PdfTooManyPagesError,
} from './errors'

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
 *
 * **Resource use is bounded** (@security H-02, M-04): each page's canvas size
 * is checked before it is allocated, embedded images are capped, and the whole
 * render runs under a wall-clock deadline.
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
 * The whole call runs under one wall-clock deadline (@security M-04). **Known
 * limit:** it is checked only when the event loop gets a turn. In Node, pdfjs
 * schedules render chunks as microtasks and @napi-rs/canvas rasterises
 * synchronously inside `encode`, so neither yields to a timer — one hostile
 * page runs to completion before the deadline can act. The deadline stops
 * further pages and fails the call; a hard per-page bound needs a terminable
 * worker thread (not built here).
 *
 * @param pdf - The raw PDF bytes. Not mutated; pdfjs is handed a copy.
 * @param maxPages - Most pages accepted. Callers pass `MAX_PDF_PAGES`; it is a
 *   parameter so tests can exercise the limit without building large PDFs.
 * @param timeoutMs - Deadline for the whole call. Production callers omit it
 *   and get `PDF_RENDER_TIMEOUT_MS`; it is a parameter so tests can trip it.
 * @returns One PNG buffer per page, in page order.
 * @throws {PdfTooManyPagesError} The document has more than `maxPages` pages.
 *   Thrown before any page is rendered.
 * @throws {PdfPageTooLargeError} A page would need a canvas over
 *   `MAX_RENDER_PIXELS`. Thrown before that canvas is allocated; the page is
 *   never silently scaled down (CONSTRAINT-34).
 * @throws {PdfRenderTimeoutError} Rendering did not finish within `timeoutMs`.
 * @throws {PdfRenderError} The bytes are not a readable PDF, a page has
 *   unusable dimensions, or a page failed to render or encode. The underlying
 *   error, if any, is attached as `cause`.
 */
export async function renderPdfPages(
  pdf: Buffer,
  maxPages: number,
  timeoutMs: number = PDF_RENDER_TIMEOUT_MS,
): Promise<Buffer[]> {
  const task = startLoading(pdf)
  const deadline = startDeadline(timeoutMs)
  try {
    return await Promise.race([renderAll(task, maxPages, deadline), deadline.expired])
  } finally {
    deadline.clear()
    // The loading task owns the document and its fake worker; destroying it
    // releases both on every path — after a timeout it also fails any page
    // fetch or render still pending. Awaited so a teardown failure surfaces
    // rather than leaking past the caller.
    await task.destroy()
  }
}

/** The render deadline: a rejecting promise plus the render it must cancel. */
interface Deadline {
  /** Rejects with `PdfRenderTimeoutError` when time runs out; never resolves. */
  readonly expired: Promise<never>
  /** True once the deadline has fired. */
  readonly timedOut: () => boolean
  /** Registers the render to cancel if the deadline fires mid-page. */
  readonly track: (render: RenderTask | null) => void
  /** Stops the timer. Called on every path, success or failure. */
  readonly clear: () => void
}

/**
 * Arms a timer that, on expiry, rejects and cancels the tracked render. The
 * cancel takes effect wherever pdfjs is waiting on a real async step (e.g. a
 * font or image load); see renderPdfPages for what it cannot interrupt.
 */
function startDeadline(timeoutMs: number): Deadline {
  let current: RenderTask | null = null
  let fired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      fired = true
      reject(new PdfRenderTimeoutError(timeoutMs))
      current?.cancel()
    }, timeoutMs)
  })
  // Not a swallow: the race in renderPdfPages is what surfaces this rejection.
  // This handler only stops Node flagging it as unhandled if it ever settles
  // outside that race's lifetime.
  expired.catch(() => undefined)
  return {
    expired,
    timedOut: () => fired,
    track: (render) => {
      current = render
    },
    clear: () => clearTimeout(timer),
  }
}

/** Opens the document, checks the page count, and renders page by page. */
async function renderAll(
  task: PDFDocumentLoadingTask,
  maxPages: number,
  deadline: Deadline,
): Promise<Buffer[]> {
  const doc = await openDocument(task)
  if (doc.numPages > maxPages) {
    throw new PdfTooManyPagesError(doc.numPages, maxPages)
  }
  const pages: Buffer[] = []
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    // After a timeout the caller already has its PdfRenderTimeoutError; this
    // result is discarded, so stop instead of starting another page.
    if (deadline.timedOut()) return pages
    pages.push(await renderPage(doc, pageNumber, deadline))
  }
  return pages
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
    // pdfjs defaults to unlimited. Larger embedded images are not decoded;
    // the rest of the page still renders (@security M-04).
    maxImageSize: MAX_EMBEDDED_IMAGE_PIXELS,
    // Pinned to the canvas budget (RGBA bytes) rather than left at -1, where
    // pdfjs probes for a limit itself.
    canvasMaxAreaInBytes: MAX_RENDER_PIXELS * 4,
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
async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  deadline: Deadline,
): Promise<Buffer> {
  try {
    const page = await doc.getPage(pageNumber)
    try {
      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
      const { width, height } = checkCanvasSize(viewport, pageNumber)
      const canvas = createCanvas(width, height)
      // pdfjs types its canvas as a DOM element; @napi-rs/canvas is the Node
      // implementation pdfjs itself uses for its NodeCanvasFactory.
      const render = page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport })
      deadline.track(render)
      try {
        await render.promise
      } finally {
        deadline.track(null)
      }
      return await canvas.encode('png')
    } finally {
      page.cleanup()
    }
  } catch (error) {
    // Our own typed errors already say what went wrong; pass them through.
    if (error instanceof PdfPageTooLargeError || error instanceof PdfRenderError) throw error
    throw new PdfRenderError(`page ${pageNumber} of ${doc.numPages} failed (${describe(error)})`, {
      cause: error,
    })
  }
}

/**
 * The canvas size a page needs, validated before anything is allocated
 * (@security H-02). The page box comes from the PDF itself and is untrusted:
 * an oversized page is refused, never scaled down, so a human sees it.
 */
function checkCanvasSize(
  viewport: PageViewport,
  pageNumber: number,
): { width: number; height: number } {
  const width = Math.ceil(viewport.width)
  const height = Math.ceil(viewport.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new PdfRenderError(`page ${pageNumber} has unusable dimensions`)
  }
  const pixels = width * height
  if (pixels > MAX_RENDER_PIXELS) {
    throw new PdfPageTooLargeError(pageNumber, pixels, MAX_RENDER_PIXELS)
  }
  return { width, height }
}

/** Error class name only — a pdfjs message can quote document content (SEC-01). */
function describe(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}
