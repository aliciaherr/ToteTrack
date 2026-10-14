import { MONTHS_IN_YEAR } from './checks.constants'

/**
 * Date parsing shared by the date checks and the value-in-quote check. Only
 * the forms real POs print; anything else parses to `null`, and callers
 * treat `null` conservatively (flag, or leave to another check).
 */

/**
 * A numeric date with the day and month in front: 3/20/26, 08-31-2026,
 * 09.09.2026. The lookarounds stop a year-first date (2026-03-05) — which is
 * never ambiguous — from matching on its tail.
 */
const DAY_MONTH_FIRST = /(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?!\d)/g

/** A year-first numeric date: 2026-03-05, 2026/3/5. */
const YEAR_FIRST = /(?<!\d)(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?!\d)/g

/** Highest day number any month has. */
const DAYS_IN_LONGEST_MONTH = 31

/** The model's normalised value: exactly `YYYY-MM-DD`. */
const ISO_VALUE = /^(\d{4})-(\d{2})-(\d{2})$/

/** One numeric date as printed: its two leading numbers, in printed order, and its year text. */
export interface NumericDate {
  first: number
  second: number
  /** As printed: two or four digits. */
  year: string
}

/** A calendar date, from the model's `YYYY-MM-DD` value. */
export interface IsoDate {
  year: number
  month: number
  day: number
}

/**
 * Every day/month-first numeric date in a quote, in printed order.
 *
 * @param quote - The date's quote as the model copied it.
 * @returns One entry per numeric date; empty for written-out or year-first dates.
 */
export function numericDates(quote: string): NumericDate[] {
  return [...quote.normalize('NFKC').matchAll(DAY_MONTH_FIRST)].map((match) => ({
    first: Number(match[1]),
    second: Number(match[2]),
    year: match[3],
  }))
}

/**
 * Every year-first numeric date in a quote, as calendar parts.
 *
 * @param quote - The date's quote as the model copied it.
 */
export function yearFirstDates(quote: string): IsoDate[] {
  return [...quote.normalize('NFKC').matchAll(YEAR_FIRST)].map((match) => ({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  }))
}

/**
 * Parses the model's date value.
 *
 * @param value - Should be `YYYY-MM-DD`.
 * @returns The parts, or `null` for any other shape or an impossible month/day.
 */
export function parseIsoDate(value: string): IsoDate | null {
  const match = ISO_VALUE.exec(value)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (month < 1 || month > MONTHS_IN_YEAR || day < 1 || day > DAYS_IN_LONGEST_MONTH) return null
  return { year, month, day }
}

/**
 * True when a printed year names the value's year: four digits exactly, or
 * two digits as its last two.
 */
export function yearMatches(printed: string, year: number): boolean {
  return printed.length === 4 ? Number(printed) === year : Number(printed) === year % 100
}
