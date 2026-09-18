import { format, parseISO } from 'date-fns'

/**
 * App-wide short date formatter for table cells and card rows:
 *   2026-07-27 → Jul 27
 *   null       → —
 *
 * Single source of truth, the sibling of `format-currency.ts`. The same
 * `format(parseISO(iso), 'MMM d')` line had been copied into `ProductionCard`,
 * `PickupCard` and `OpenOrdersWidget` — three copies across two verticals, each
 * free to drift (CONSTRAINT-26). New callers use this one.
 *
 * **No year.** These surfaces show a working window of a few weeks either side
 * of today, where the year is noise that costs four characters in a column that
 * has none to spare (CONSTRAINT-19). Anywhere a date can be far from today, or
 * where an off-by-a-year reading would be costly, spell the year out — the card
 * popup does exactly that with `EEE, MMM d yyyy`.
 *
 * `parseISO`, never `new Date(string)`: the latter reads a date-only string as
 * UTC midnight, which lands on the previous calendar day in any negative-offset
 * timezone and would render every date one day early for a US viewer.
 *
 * @param isoDate A `yyyy-MM-dd` date, or null for an empty cell.
 * @param fallback What to render when there is no date.
 */
export function formatShortDate(isoDate: string | null | undefined, fallback = '—'): string {
  if (!isoDate) return fallback
  const parsed = parseISO(isoDate)
  // An unparseable value renders as itself rather than as "Invalid Date" or an
  // em dash: showing the raw string makes bad data visible instead of hiding it
  // behind the same placeholder a genuinely empty column uses.
  if (Number.isNaN(parsed.getTime())) return isoDate
  return format(parsed, 'MMM d')
}
