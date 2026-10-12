/**
 * Every tunable value in PO extraction (Feature 16, Task 98), in one place.
 *
 * Same rule as `lib/ingest/ingest.constants.ts`: each of these changes program
 * behaviour, so it is a code decision that goes through review — not an
 * environment variable that can differ silently between deployments. The two
 * exceptions are `OPENROUTER_API_KEY` (a secret) and `OPENROUTER_MODEL` (swapped
 * without a code change by design), both read in `config.ts`.
 *
 * `zdr: true` is deliberately NOT here. It is a literal in `openrouter.ts`, so
 * no constant, env var or config object can ever switch it off (plan.md,
 * Feature 16 preamble).
 */

/** Model used when `OPENROUTER_MODEL` is unset. Agreed 2026-10-07 (plan.md). */
export const DEFAULT_EXTRACTION_MODEL = 'openai/gpt-4.1-mini'

/** OpenRouter's OpenAI-compatible chat endpoint. */
export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Zero randomness: the same document should read the same way every run, so a
 * changed reading points at a changed prompt or model, not at chance.
 */
export const EXTRACTION_TEMPERATURE = 0

/**
 * Abort the model call after this long. A one-page PO returns in a few
 * seconds; this leaves headroom for multi-page documents while staying well
 * inside a Vercel function's limit, so a hung call fails loudly in our code
 * instead of being killed silently by the platform.
 */
export const EXTRACTION_TIMEOUT_MS = 60_000

/**
 * Pages rendered and sent per PDF. Every sample PO so far is one page; a PO
 * over this is far more likely a catalogue or statement than an order. Over
 * the limit throws `PdfTooManyPagesError` — never silently truncated
 * (CONSTRAINT-34).
 */
export const MAX_PDF_PAGES = 5

/**
 * PDF render scale relative to 72 dpi. 2 ≈ 144 dpi — small print and table
 * figures stay legible to the model without sending oversized images.
 */
export const PDF_RENDER_SCALE = 2

/**
 * Our own company's names as they appear in a PO's vendor block. The model is
 * told these are the VENDOR, never the customer. Variants seen across real
 * POs; add new ones here, not in prompt prose.
 */
export const OWN_COMPANY_NAMES = ['Housher Container Group', 'Housher Enterprises', 'Housher'] as const

/** The six tote types — one per `qty_*` / `unit_price_*` column pair on `orders`. */
export const TOTE_TYPES = [
  '275_recon',
  '275_rebot',
  '275_new',
  '330_recon',
  '330_rebot',
  '330_new',
] as const
