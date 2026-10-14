import type { ExtractedPo } from '@/lib/extraction/types'
import { CENTS_PER_DOLLAR, MONEY_TOLERANCE_CENTS } from './checks.constants'
import { type IsoDate, numericDates, parseIsoDate, yearFirstDates, yearMatches } from './date-parts'
import type { CheckFailure } from './types'

/**
 * Does each value appear in **its own** quote? Quote verification proves the
 * quote is on the page; this proves the value was read from that quote — a
 * PO number `10627` quoting "PO 10672" passes the first and fails here.
 *
 * Conservative: a value it cannot confirm is flagged. Works without the
 * document's text, so images and scans are covered too.
 */

/** A money amount as printed: `7,800.18`, `7800`, `130.00`. */
const AMOUNT = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g

/** A month name or its abbreviation, at a word start. */
const MONTH_NAME = /(?<!\p{L})(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\p{L}*/gu

const MONTH_ABBREVIATIONS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function canonical(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

function alphanumeric(text: string): string {
  return canonical(text).replace(/[^\p{L}\p{N}]/gu, '')
}

function digitRuns(text: string): string[] {
  return canonical(text).match(/\p{N}+/gu) ?? []
}

/**
 * Letters and digits of the value, in order, inside the quote's — and every
 * run of digits in the value is a whole run of digits in the quote, so
 * `1067` is not found in "PO# 10672".
 */
export function poNumberInQuote(value: string, quote: string): boolean {
  const wanted = alphanumeric(value)
  if (!alphanumeric(quote).includes(wanted)) return false
  const quoteRuns = new Set(digitRuns(quote))
  return digitRuns(value).every((run) => quoteRuns.has(run))
}

function toCents(dollars: number): number {
  return Math.round(dollars * CENTS_PER_DOLLAR)
}

/** Some amount printed in the quote equals the value to the cent. */
export function totalInQuote(value: number, quote: string): boolean {
  const amounts = canonical(quote).match(AMOUNT) ?? []
  const wanted = toCents(value)
  return amounts.some(
    (amount) => Math.abs(toCents(Number(amount.replace(/,/g, ''))) - wanted) <= MONEY_TOLERANCE_CENTS,
  )
}

/** A numeric date in the quote reads as the value, month-first or day-first (order is `checkDates`' job). */
function numericMatch(date: IsoDate, quote: string): boolean {
  return numericDates(quote).some(
    ({ first, second, year }) =>
      yearMatches(year, date.year) &&
      ((first === date.month && second === date.day) || (first === date.day && second === date.month)),
  )
}

function yearFirstMatch(date: IsoDate, quote: string): boolean {
  return yearFirstDates(quote).some(({ year, month, day }) => year === date.year && month === date.month && day === date.day)
}

/** "January 20, 2026", "20 Jan 2026": one month name, plus the day and a four-digit year as numbers. */
function writtenMatch(date: IsoDate, quote: string): boolean {
  const text = canonical(quote)
  const months = [...text.matchAll(MONTH_NAME)].map((match) => MONTH_ABBREVIATIONS.indexOf(match[1]) + 1)
  if (months.length !== 1 || months[0] !== date.month) return false
  const numbers = text.match(/\p{N}+/gu) ?? []
  const hasDay = numbers.some((number) => number.length <= 2 && Number(number) === date.day)
  const hasYear = numbers.some((number) => number.length === 4 && Number(number) === date.year)
  return hasDay && hasYear
}

/** The `YYYY-MM-DD` value is a date printed in the quote, in any form we can read. */
export function dateInQuote(value: string, quote: string): boolean {
  const date = parseIsoDate(value)
  if (date === null) return false
  return numericMatch(date, quote) || yearFirstMatch(date, quote) || writtenMatch(date, quote)
}

function failure(field: string, what: string): CheckFailure {
  return { check: 'value_not_in_quote', field, detail: `the ${what} value is not in its own quote` }
}

/**
 * Checks PO number candidates, the stated total and dates against their own
 * quotes. A blank quote is skipped: `quote_not_found` already flags it. A
 * blank PO number is `missing_po_number`'s job.
 *
 * @param extracted - A validated extraction.
 * @returns One `value_not_in_quote` failure per mismatching field. The detail
 *   names the field kind only — never document text.
 */
export function checkValuesInQuotes(extracted: ExtractedPo): CheckFailure[] {
  const failures: CheckFailure[] = []
  extracted.poNumberCandidates.forEach(({ value, quote }, index) => {
    if (value.trim() === '' || quote.trim() === '') return
    if (!poNumberInQuote(value, quote)) failures.push(failure(`poNumberCandidates[${index}]`, 'PO number'))
  })
  const total = extracted.statedTotal
  if (total.value !== null && total.quote.trim() !== '' && !totalInQuote(total.value, total.quote)) {
    failures.push(failure('statedTotal', 'stated total'))
  }
  extracted.dates.forEach(({ value, quote }, index) => {
    if (quote.trim() === '') return
    if (!dateInQuote(value, quote)) failures.push(failure(`dates[${index}]`, 'date'))
  })
  return failures
}
