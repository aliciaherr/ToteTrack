import { ExtractionResponseError, TextInputTooLongError } from './errors'
import { MAX_PDF_PAGES, MAX_TEXT_INPUT_CHARS, TOTE_TYPES } from './extraction.constants'
import { callOpenRouter } from './openrouter'
import { buildSystemPrompt } from './prompt'
import { renderPdfPages } from './render-pdf'
import { extractedPoSchema } from './schema'
import type {
  ChatContentPart,
  ExtractedPo,
  ExtractionConfig,
  ExtractionDeps,
  ExtractionInput,
  ExtractionRequest,
  ExtractionResult,
  ImageDataUrl,
  OrderQuantities,
  ToteSlot,
  ToteType,
} from './types'

/** Issue paths listed in a schema-mismatch error before the rest are counted. */
const MAX_REPORTED_ISSUES = 10

/** Production dependencies: the global `fetch` and the real PDF renderer. */
export const defaultExtractionDeps: ExtractionDeps = { fetchImpl: fetch, renderPdfPages }

/**
 * Reads one purchase-order document with the model (Task 98).
 *
 * A PDF is rendered to page images first (CONSTRAINT-35/36), an image is sent
 * unmodified, and an email body is sent as text. An email body longer than
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
        content: [textPart('The purchase order is the email body below.'), textPart(input.text)],
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

/**
 * Folds an extraction into the six `qty_*` / `unit_price_*` order slots.
 *
 * Only `tote` lines with a known type and a stated quantity contribute.
 * Quantities sum per type; the unit price is the first stated one, and a type
 * seen at two different unit prices is listed in `conflicts` — reported, never
 * averaged. Tote lines with an `unknown` or null type are counted in
 * `unknownLines`. `price` is Σ(quantity × unit price) over contributing lines
 * that state a unit price, rounded to cents. `other` lines never contribute.
 *
 * @param extracted - A validated extraction.
 * @returns All six slots (quantity 0 / unit price null when absent), the
 *   derived price, the conflicting types and the unknown-line count.
 */
export function toOrderQuantities(extracted: ExtractedPo): OrderQuantities {
  const slots = emptySlots()
  const conflicts: ToteType[] = []
  const priced = new Set<ToteType>()
  let unknownLines = 0
  let price = 0

  for (const line of extracted.lines) {
    if (line.kind !== 'tote') continue
    if (line.toteType === null || line.toteType === 'unknown') {
      unknownLines += 1
      continue
    }
    if (line.quantity === null) continue

    const slot = slots[line.toteType]
    slot.quantity += line.quantity
    if (line.unitPrice === null) continue

    price += line.quantity * line.unitPrice
    if (!priced.has(line.toteType)) {
      priced.add(line.toteType)
      slot.unitPrice = line.unitPrice
    } else if (slot.unitPrice !== line.unitPrice && !conflicts.includes(line.toteType)) {
      conflicts.push(line.toteType)
    }
  }

  return { slots, price: Math.round(price * 100) / 100, conflicts, unknownLines }
}

function emptySlots(): Record<ToteType, ToteSlot> {
  return Object.fromEntries(TOTE_TYPES.map((type) => [type, { quantity: 0, unitPrice: null }])) as Record<
    ToteType,
    ToteSlot
  >
}
