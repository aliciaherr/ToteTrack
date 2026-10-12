/**
 * Named failures for PO extraction (EH-05). Each is a distinct mode Task 101's
 * worker must tell apart: a config error is permanent, a timeout is worth a
 * retry, a too-long PDF needs a human. Messages carry identifiers, counts and
 * statuses only — never document text or extracted values (SEC-01 / SEC-05).
 */

/** A required environment variable is missing or empty. */
export class ExtractionConfigError extends Error {
  readonly variable: string

  constructor(variable: string, reason: string) {
    super(`Extraction config: ${variable} ${reason}`)
    this.name = 'ExtractionConfigError'
    this.variable = variable
  }
}

/** A PDF has more pages than `MAX_PDF_PAGES`. Never truncated silently (CONSTRAINT-34). */
export class PdfTooManyPagesError extends Error {
  readonly pageCount: number
  readonly maxPages: number

  constructor(pageCount: number, maxPages: number) {
    super(`PDF has ${pageCount} pages; extraction reads at most ${maxPages}. Needs manual entry.`)
    this.name = 'PdfTooManyPagesError'
    this.pageCount = pageCount
    this.maxPages = maxPages
  }
}

/** The PDF could not be opened or a page could not be rendered. */
export class PdfRenderError extends Error {
  constructor(reason: string, options?: { cause?: unknown }) {
    super(`PDF render failed: ${reason}`, options)
    this.name = 'PdfRenderError'
  }
}

/** OpenRouter answered with a non-2xx status (including "no ZDR route available"). */
export class OpenRouterHttpError extends Error {
  readonly status: number
  readonly model: string

  constructor(status: number, model: string, detail: string, options?: { cause?: unknown }) {
    super(`OpenRouter returned ${status} for model ${model}: ${detail}`, options)
    this.name = 'OpenRouterHttpError'
    this.status = status
    this.model = model
  }
}

/** The call did not finish within `EXTRACTION_TIMEOUT_MS`. */
export class OpenRouterTimeoutError extends Error {
  readonly model: string
  readonly timeoutMs: number

  constructor(model: string, timeoutMs: number, options?: { cause?: unknown }) {
    super(`OpenRouter call for model ${model} timed out after ${timeoutMs}ms`, options)
    this.name = 'OpenRouterTimeoutError'
    this.model = model
    this.timeoutMs = timeoutMs
  }
}

/** The model answered, but not with JSON matching the extraction schema. */
export class ExtractionResponseError extends Error {
  readonly model: string

  constructor(model: string, reason: string, options?: { cause?: unknown }) {
    super(`Extraction response from ${model} unusable: ${reason}`, options)
    this.name = 'ExtractionResponseError'
    this.model = model
  }
}

/** A PDF page would need a canvas larger than `MAX_RENDER_PIXELS` (@security H-02). */
export class PdfPageTooLargeError extends Error {
  readonly pageNumber: number
  readonly pixels: number

  constructor(pageNumber: number, pixels: number, maxPixels: number) {
    super(`PDF page ${pageNumber} needs ${pixels} pixels; the renderer allows at most ${maxPixels}. Needs manual entry.`)
    this.name = 'PdfPageTooLargeError'
    this.pageNumber = pageNumber
    this.pixels = pixels
  }
}

/** Rendering the PDF exceeded `PDF_RENDER_TIMEOUT_MS` (@security M-04). */
export class PdfRenderTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`PDF render exceeded ${timeoutMs}ms. Needs manual entry.`)
    this.name = 'PdfRenderTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/** An email-body PO is longer than `MAX_TEXT_INPUT_CHARS` (@security M-05). */
export class TextInputTooLongError extends Error {
  readonly length: number
  readonly maxChars: number

  constructor(length: number, maxChars: number) {
    super(`Email body is ${length} characters; extraction reads at most ${maxChars}. Needs manual entry.`)
    this.name = 'TextInputTooLongError'
    this.length = length
    this.maxChars = maxChars
  }
}
