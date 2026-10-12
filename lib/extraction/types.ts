import type { ToteType } from './schema'

export type { ExtractedPo, ExtractedLine, ExtractedDate, ToteType } from './schema'

/**
 * One document to extract, by kind. Matches the three `inbound_pos` source
 * kinds: a PDF is rendered to page images first (CONSTRAINT-35/36), an image
 * is sent unmodified, and an email body is sent as text.
 */
export type ExtractionInput =
  | { kind: 'pdf'; bytes: Buffer }
  | { kind: 'image'; bytes: Buffer; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' }
  | { kind: 'text'; text: string }

/** Resolved from the environment by `readExtractionConfig`. Passed in, never read inside. */
export interface ExtractionConfig {
  apiKey: string
  model: string
}

/** Lookup shape for env reads — `process.env` or a plain object in tests. */
export type EnvLookup = Readonly<Record<string, string | undefined>>

/** One image as the model receives it: a base64 data URL. */
export type ImageDataUrl = `data:image/${string};base64,${string}`

/** One part of the user message sent to the model (OpenAI-compatible format). */
export type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: ImageDataUrl } }

/** What `extractPo` hands to `callOpenRouter`: instructions plus the document. */
export interface ExtractionRequest {
  system: string
  content: ChatContentPart[]
}

/** Injected so tests never reach the network or the PDF renderer. */
export interface ExtractionDeps {
  fetchImpl: typeof fetch
  renderPdfPages: (pdf: Buffer, maxPages: number) => Promise<Buffer[]>
}

/** Per-type quantity and unit price, derived from tote lines. */
export interface ToteSlot {
  quantity: number
  unitPrice: number | null
}

/**
 * The extraction folded into the `orders` columns. `price` is derived —
 * Σ(qty × unit price) over tote lines only (PRD: price is never extracted).
 * `conflicts` lists tote types that appeared at two different unit prices;
 * those are reported, never averaged. `unknownLines` counts tote lines whose
 * type could not be determined — they contribute to no slot.
 */
export interface OrderQuantities {
  slots: Record<ToteType, ToteSlot>
  price: number
  conflicts: ToteType[]
  unknownLines: number
}
