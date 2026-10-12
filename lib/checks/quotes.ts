import type { ExtractedPo } from '@/lib/extraction/types'
import { FUZZY_MIN_TOKEN_CHARS, MAX_FUZZY_WORK, MAX_QUOTE_CHARS, MAX_SOURCE_TEXT_CHARS } from './checks.constants'
import { containsWithinOneEdit } from './fuzzy'
import type { CheckFailure, QuoteResult, QuoteStatus } from './types'

/**
 * Quote verification (FB-40, CONSTRAINT-35 amended): is each value the model
 * read actually backed by text on the document? A PDF's text layer is only
 * ever used here — never sent to the model, never used to fill a field.
 */

/**
 * Case, Unicode form (ligatures like "ﬁ"), curly quotes and **all** whitespace
 * are erased. The text layer splits words across items and runs table cells
 * together, so spacing carries no signal; the characters do.
 */
function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, '')
}

/**
 * Words, numbers (with their own `,` / `.`), and punctuation runs, each a
 * token. Splitting letters from digits lets "PO-10672" match a layer that
 * printed "PO-" and "10672" in separate cells.
 */
function tokenize(quote: string): string[] {
  const lowered = quote.normalize('NFKC').toLowerCase()
  return (lowered.match(/\p{L}+|\p{N}+(?:[.,]\p{N}+)*|[^\s\p{L}\p{N}]+/gu) ?? []).map(normalize)
}

/**
 * Fuzzy-matcher work left for one document, in edit-table cells (MEDIUM-07).
 * Shared by every quote of the document, so the total is capped, not each call.
 */
interface FuzzyBudget {
  cellsLeft: number
}

function newBudget(): FuzzyBudget {
  return { cellsLeft: MAX_FUZZY_WORK }
}

/**
 * Only longer all-letter words may match with a typo; anything numeric is
 * exact. A fuzzy search is charged its worst case up front; once the budget
 * cannot cover it the token counts as absent — the quote turns `not_found`
 * and sorts to the top, never silently `verified`.
 */
function tokenOnPage(token: string, page: string, budget: FuzzyBudget): boolean {
  if (page.includes(token)) return true
  const fuzzyEligible = token.length >= FUZZY_MIN_TOKEN_CHARS && /^\p{L}+$/u.test(token)
  if (!fuzzyEligible) return false
  const cost = token.length * page.length
  if (cost > budget.cellsLeft) return false
  budget.cellsLeft -= cost
  return containsWithinOneEdit(token, page)
}

function totalLength(sourceText: string[]): number {
  return sourceText.reduce((sum, page) => sum + page.length, 0)
}

/** The matching itself, on pages already normalised once per document. */
function matchQuote(quote: string, pages: string[], budget: FuzzyBudget): QuoteStatus {
  const whole = normalize(quote)
  if (whole === '') return 'not_found'
  if (pages.some((page) => page.includes(whole))) return 'verified'
  const tokens = tokenize(quote)
  return pages.some((page) => tokens.every((token) => tokenOnPage(token, page, budget))) ? 'verified' : 'not_found'
}

/**
 * Checks one quote against the document's own text.
 *
 * First the whole quote is looked for on each page, whitespace ignored. If
 * that misses, the fallback accepts the quote when **every token** of it is on
 * one page in any order — the model reads a table row left to right, while the
 * text layer may list its cells in another order. All-letter tokens of
 * `FUZZY_MIN_TOKEN_CHARS`+ may differ by one typo; numbers never may.
 *
 * Known limit: the fallback does not require the tokens to sit near each
 * other, so a quote stitched from words found elsewhere on the same page
 * passes. Every number in it must still be printed on that page.
 *
 * Work is bounded (MEDIUM-07): text over `MAX_SOURCE_TEXT_CHARS` or a quote
 * over `MAX_QUOTE_CHARS` is not matched, and typo matching stops at
 * `MAX_FUZZY_WORK` (a token past it counts as absent).
 *
 * @param quote - The model's quote.
 * @param sourceText - One string per page, or `null` when there is none.
 * @returns `unverifiable` without text or when a size limit is exceeded;
 *   `not_found` for an empty quote.
 */
export function verifyQuote(quote: string, sourceText: string[] | null): QuoteStatus {
  if (sourceText === null || totalLength(sourceText) > MAX_SOURCE_TEXT_CHARS) return 'unverifiable'
  if (quote.length > MAX_QUOTE_CHARS) return 'unverifiable'
  return matchQuote(quote, sourceText.map(normalize), newBudget())
}

/** One quote the model gave, with where it sits in the extraction. */
interface ClaimedQuote {
  field: string
  quote: string
}

/** Every quote backing a non-null value. A null value has nothing to verify. */
function collectQuotes(extracted: ExtractedPo): ClaimedQuote[] {
  const claimed: ClaimedQuote[] = []
  extracted.poNumberCandidates.forEach((candidate, index) =>
    claimed.push({ field: `poNumberCandidates[${index}]`, quote: candidate.quote }),
  )
  const single = ['customerName', 'shipToAddress', 'billToAddress', 'statedTotal'] as const
  for (const field of single) {
    if (extracted[field].value !== null) claimed.push({ field, quote: extracted[field].quote })
  }
  extracted.dates.forEach((date, index) => claimed.push({ field: `dates[${index}]`, quote: date.quote }))
  extracted.lines.forEach((line, index) => claimed.push({ field: `lines[${index}]`, quote: line.quote }))
  return claimed
}

/**
 * Verifies every quote in an extraction.
 *
 * `not_found` and an over-long quote are failures; `unverifiable` is recorded
 * in `quotes` only. A document with more text than `MAX_SOURCE_TEXT_CHARS`
 * is not matched at all: every quote is `unverifiable` and one failure says
 * so, rather than letting a huge text layer stall the matcher. Pages are
 * normalised once, and one `MAX_FUZZY_WORK` budget covers every quote.
 *
 * @returns The failures, and one status per quote (no quote text).
 */
export function checkQuotes(
  extracted: ExtractedPo,
  sourceText: string[] | null,
): { failures: CheckFailure[]; quotes: QuoteResult[] } {
  const claimed = collectQuotes(extracted)
  const failures: CheckFailure[] = []
  const sourceLength = sourceText === null ? 0 : totalLength(sourceText)
  const tooMuchText = sourceLength > MAX_SOURCE_TEXT_CHARS
  const pages = sourceText === null || tooMuchText ? null : sourceText.map(normalize)
  const budget = newBudget()
  if (tooMuchText) {
    failures.push({
      check: 'source_text_too_long',
      field: 'sourceText',
      detail: `document text is ${sourceLength} characters, over the ${MAX_SOURCE_TEXT_CHARS} limit; quotes were not checked`,
    })
  }
  const quotes = claimed.map(({ field, quote }): QuoteResult => {
    if (quote.length > MAX_QUOTE_CHARS) {
      failures.push({
        check: 'quote_too_long',
        field,
        detail: `quote is ${quote.length} characters, over the ${MAX_QUOTE_CHARS} limit; not checked`,
      })
      return { field, status: 'unverifiable' }
    }
    const status = pages === null ? 'unverifiable' : matchQuote(quote, pages, budget)
    if (status === 'not_found') {
      failures.push({ check: 'quote_not_found', field, detail: 'quoted text is not in the document' })
    }
    return { field, status }
  })
  return { failures, quotes }
}
