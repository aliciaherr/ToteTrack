import type { ExtractedPo } from '@/lib/extraction/types'
import { MONTHS_IN_YEAR } from './checks.constants'
import type { CheckFailure } from './types'

/**
 * A numeric date with the day and month in front: 3/20/26, 08-31-2026,
 * 09.09.2026. The lookarounds stop a year-first date (2026-03-05) — which is
 * never ambiguous — from matching on its tail.
 */
const DAY_MONTH_FIRST = /(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?!\d)/

/** The first two numbers of a numeric date quote, or `null` for any other form. */
function leadingParts(quote: string): [number, number] | null {
  const match = DAY_MONTH_FIRST.exec(quote)
  return match ? [Number(match[1]), Number(match[2])] : null
}

/**
 * A component over 12 is a day, so the document's order — month-first or
 * day-first — is proven for every date on it.
 */
function orderProven(parts: Array<[number, number] | null>): boolean {
  return parts.some((pair) => pair !== null && (pair[0] > MONTHS_IN_YEAR || pair[1] > MONTHS_IN_YEAR))
}

function checkAmbiguous(extracted: ExtractedPo): CheckFailure[] {
  const parts = extracted.dates.map((date) => leadingParts(date.quote))
  if (orderProven(parts)) return []
  const failures: CheckFailure[] = []
  parts.forEach((pair, index) => {
    if (pair === null || pair[0] === pair[1]) return
    failures.push({
      check: 'ambiguous_date',
      field: `dates[${index}]`,
      detail: `${pair[0]}/${pair[1]} could be month-first or day-first, and no other date on the document settles it`,
    })
  })
  return failures
}

/** Several different delivery dates: the model could not tell which one is meant. */
function checkDeliveryCount(extracted: ExtractedPo): CheckFailure[] {
  const delivery = extracted.dates
    .map((date, index) => ({ date, index }))
    .filter(({ date }) => date.role === 'delivery')
  const distinct = new Set(delivery.map(({ date }) => date.value))
  if (distinct.size <= 1) return []
  return [
    {
      check: 'multiple_delivery_dates',
      field: 'dates',
      detail: `${distinct.size} different delivery dates: ${delivery.map(({ index }) => `dates[${index}]`).join(', ')}`,
    },
  ]
}

/**
 * Date checks.
 *
 * - **Ambiguous:** both leading numbers ≤ 12 and unequal (03/05/26), unless
 *   another date on the same document has a component over 12, which fixes
 *   the order for all of them. Equal numbers (09/09) read the same either way.
 * - **Multiple delivery dates:** more than one *different* `delivery` date.
 *   The same date printed twice is not ambiguous.
 *
 * @param extracted - A validated extraction.
 */
export function checkDates(extracted: ExtractedPo): CheckFailure[] {
  return [...checkAmbiguous(extracted), ...checkDeliveryCount(extracted)]
}
