import type { ExtractedPo } from '@/lib/extraction/types'
import { FUZZY_MIN_TOKEN_CHARS, MAX_FUZZY_WORK, MAX_QUOTE_CHARS, MAX_SOURCE_TEXT_CHARS } from './checks.constants'
import { containsWithinOneEdit } from './fuzzy'
import type { CheckFailure, QuoteResult, QuoteStatus } from './types'

/**
 * Quote verification (FB-40, CONSTRAINT-35 amended): is each value the model
 * read actually backed by text on the document? A PDF's text layer is only
 * ever used here — never sent to the model, never used to fill a field.
 */

/** Case, Unicode form (ligatures like "ﬁ") and curly quotes, made uniform. */
function canonical(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
}

/**
 * `canonical`, with **all** whitespace erased. The text layer splits words
 * across items ("Mans fi eld"), so spacing carries no signal for matching;
 * the characters do.
 */
function normalize(text: string): string {
  return canonical(text).replace(/\s+/g, '')
}

/**
 * One page, normalised once per document. Matching runs on `compact`; number
 * boundaries are judged on `spaced`, where whitespace still separates — so
 * "PO# 1067 2026" does not read as one number "10672026".
 */
interface PreparedPage {
  compact: string
  /** `canonical` with each whitespace run collapsed to one space. */
  spaced: string
  /** For each `compact` index, the same character's index in `spaced`. */
  toSpaced: number[]
  /** Bounded-search results by needle: quotes repeat numbers, and each search scans the page. */
  bounded: Map<string, boolean>
}

function preparePage(text: string): PreparedPage {
  const spaced = canonical(text).replace(/\s+/g, ' ')
  const kept: string[] = []
  const toSpaced: number[] = []
  for (let index = 0; index < spaced.length; index++) {
    if (spaced[index] === ' ') continue
    kept.push(spaced[index])
    toSpaced.push(index)
  }
  return { compact: kept.join(''), spaced, toSpaced, bounded: new Map() }
}

const DIGIT = /\p{N}/u

function isDigit(char: string | undefined): boolean {
  return char !== undefined && DIGIT.test(char)
}

/**
 * True when the page character at `at` carries a number on past a match edge:
 * a digit, or `.` / `,` with a digit beyond it (`step` points away from the match).
 */
function continuesNumber(spaced: string, at: number, step: 1 | -1): boolean {
  if (isDigit(spaced[at])) return true
  return (spaced[at] === '.' || spaced[at] === ',') && isDigit(spaced[at + step])
}

/**
 * A number in the quote must be a whole number on the page: "7,800" is not in
 * "7,800.18", "1067" not in "10672", "30" not in "300". Table cells are
 * separate text items, which `render-pdf` joins with a space, so a cell edge
 * is a number edge (Task 122).
 */
function boundedAt(page: PreparedPage, start: number, needle: string): boolean {
  const first = page.toSpaced[start]
  const last = page.toSpaced[start + needle.length - 1]
  if (isDigit(needle[0]) && continuesNumber(page.spaced, first - 1, -1)) return false
  return !(isDigit(needle[needle.length - 1]) && continuesNumber(page.spaced, last + 1, 1))
}

/** `page.compact.includes(needle)`, with number boundaries when the needle starts or ends with a digit. */
function onPage(page: PreparedPage, needle: string): boolean {
  if (!isDigit(needle[0]) && !isDigit(needle[needle.length - 1])) return page.compact.includes(needle)
  const known = page.bounded.get(needle)
  if (known !== undefined) return known
  let found = false
  for (let at = page.compact.indexOf(needle); at !== -1 && !found; at = page.compact.indexOf(needle, at + 1)) {
    found = boundedAt(page, at, needle)
  }
  page.bounded.set(needle, found)
  return found
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
function tokenOnPage(token: string, page: PreparedPage, budget: FuzzyBudget): boolean {
  if (onPage(page, token)) return true
  const fuzzyEligible = token.length >= FUZZY_MIN_TOKEN_CHARS && /^\p{L}+$/u.test(token)
  if (!fuzzyEligible) return false
  const cost = token.length * page.compact.length
  if (cost > budget.cellsLeft) return false
  budget.cellsLeft -= cost
  return containsWithinOneEdit(token, page.compact)
}

function totalLength(sourceText: string[]): number {
  return sourceText.reduce((sum, page) => sum + page.length, 0)
}

/** The matching itself, on pages already normalised once per document. */
function matchQuote(quote: string, pages: PreparedPage[], budget: FuzzyBudget): QuoteStatus {
  const whole = normalize(quote)
  if (whole === '') return 'not_found'
  if (pages.some((page) => onPage(page, whole))) return 'verified'
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
 * Numbers match whole (`boundedAt`): a quote or token that starts or ends
 * with a digit must not sit inside a longer number on the page.
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
  return matchQuote(quote, sourceText.map(preparePage), newBudget())
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
  const pages = sourceText === null || tooMuchText ? null : sourceText.map(preparePage)
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
