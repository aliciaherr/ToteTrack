import { ExtractionResponseError, TextInputTooLongError } from './errors'
import { MAX_PDF_PAGES, MAX_TEXT_INPUT_CHARS } from './extraction.constants'
import { callOpenRouter } from './openrouter'
import { buildSystemPrompt, fenceEmailBody } from './prompt'
import { renderPdfPages } from './render-pdf'
import { extractedPoSchema } from './schema'
import type {
  ChatContentPart,
  ExtractionConfig,
  ExtractionDeps,
  ExtractionInput,
  ExtractionRequest,
  ExtractionResult,
  ImageDataUrl,
} from './types'

/** Issue paths listed in a schema-mismatch error before the rest are counted. */
const MAX_REPORTED_ISSUES = 10

/** Production dependencies: the global `fetch` and the real PDF renderer. */
export const defaultExtractionDeps: ExtractionDeps = { fetchImpl: fetch, renderPdfPages }

/**
 * Reads one purchase-order document with the model (Task 98).
 *
 * A PDF is rendered to page images first (CONSTRAINT-35/36), an image is sent
 * unmodified, and an email body is sent as text between fixed markers
 * (`fenceEmailBody`). An email body longer than
 * `MAX_TEXT_INPUT_CHARS` throws `TextInputTooLongError` before any network
 * call — it is never truncated (@security M-05). Renderer errors — including
 * `PdfTooManyPagesError` — propagate unchanged. The model's answer is
 * validated against `extractedPoSchema`; a mismatch throws
 * `ExtractionResponseError` naming the failing paths, never their values.
 *
 * Alongside the reading it returns the document's own text for Task 101's
 * quote checks (FB-40). **That text is never added to the model request** —
 * for a PDF it is the text layer from the same parse that drew the pages.
 *
 * @param input - The document, by kind.
 * @param config - API key and model, resolved by `readExtractionConfig`.
 * @param deps - `fetch` and the PDF renderer; injected in tests.
 * @returns The validated reading, plus the source text (`null` for an image
 *   or a PDF with a blank text layer).
 */
export async function extractPo(
  input: ExtractionInput,
  config: ExtractionConfig,
  deps: ExtractionDeps = defaultExtractionDeps
): Promise<ExtractionResult> {
  const { content, sourceText } = await prepareDocument(input, deps)
  const request: ExtractionRequest = { system: buildSystemPrompt(), content }
  const raw = await callOpenRouter(request, config, deps.fetchImpl)

  const parsed = extractedPoSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ExtractionResponseError(config.model, summarizeIssues(parsed.error.issues))
  }
  return { extracted: parsed.data, sourceText }
}

/** One document as model input, plus its own text kept back for quote checks. */
interface PreparedDocument {
  content: ChatContentPart[]
  sourceText: string[] | null
}

/** Turns one document into the user-message parts, led by a short framing line. */
async function prepareDocument(input: ExtractionInput, deps: ExtractionDeps): Promise<PreparedDocument> {
  switch (input.kind) {
    case 'pdf': {
      const { images, text } = await deps.renderPdfPages(input.bytes, MAX_PDF_PAGES)
      const content = [
        textPart(`The purchase order is a PDF, rendered as ${images.length} page image(s) in page order.`),
        ...images.map((png) => imagePart('image/png', png)),
      ]
      // A scan has no text layer: nothing to verify against, so `null`.
      return { content, sourceText: text.some((page) => page.trim() !== '') ? text : null }
    }
    case 'image': {
      const content = [textPart('The purchase order is a single image.'), imagePart(input.mimeType, input.bytes)]
      return { content, sourceText: null }
    }
    case 'text':
      if (input.text.length > MAX_TEXT_INPUT_CHARS) {
        throw new TextInputTooLongError(input.text.length, MAX_TEXT_INPUT_CHARS)
      }
      return {
        content: [
          textPart('The purchase order is the email body below, between its markers.'),
          textPart(fenceEmailBody(input.text)),
        ],
        sourceText: [input.text],
      }
  }
}

function textPart(text: string): ChatContentPart {
  return { type: 'text', text }
}

function imagePart(mimeType: `image/${string}`, bytes: Buffer): ChatContentPart {
  const url: ImageDataUrl = `data:${mimeType};base64,${bytes.toString('base64')}`
  return { type: 'image_url', image_url: { url } }
}

/** Paths and issue codes only — zod messages can echo received values. */
function summarizeIssues(issues: ReadonlyArray<{ path: PropertyKey[]; code: string }>): string {
  const listed = issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'} (${issue.code})`)
  const more = issues.length - listed.length
  return `schema mismatch at ${listed.join(', ')}${more > 0 ? ` and ${more} more` : ''}`
}
