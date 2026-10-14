import type { ExtractedPo } from '@/lib/extraction/types'
import { MONTHS_IN_YEAR } from './checks.constants'
import { numericDates, parseIsoDate } from './date-parts'
import type { CheckFailure } from './types'

/** The first two numbers of a date quote's first numeric date, or `null` for any other form. */
function leadingParts(quote: string): [number, number] | null {
  const [first] = numericDates(quote)
  return first ? [first.first, first.second] : null
}

type DateOrder = 'month_first' | 'day_first'

/**
 * What one numeric date proves about the document's order. A component over
 * 12 can only be a day; both over 12 is no valid date in either order.
 */
function proofOf(pair: [number, number] | null): DateOrder | 'impossible' | null {
  if (pair === null) return null
  const [first, second] = pair
  if (first > MONTHS_IN_YEAR && second > MONTHS_IN_YEAR) return 'impossible'
  if (second > MONTHS_IN_YEAR) return 'month_first'
  if (first > MONTHS_IN_YEAR) return 'day_first'
  return null
}

function orderName(order: DateOrder): string {
  return order === 'month_first' ? 'month-first' : 'day-first'
}

function checkAmbiguous(parts: Array<[number, number] | null>): CheckFailure[] {
  if (parts.some((pair) => proofOf(pair) !== null)) return []
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

/** Each numeric date's value must be its quote read in the proven order. */
function checkValuesInOrder(
  extracted: ExtractedPo,
  parts: Array<[number, number] | null>,
  order: DateOrder,
): CheckFailure[] {
  const failures: CheckFailure[] = []
  extracted.dates.forEach((date, index) => {
    const pair = parts[index]
    const iso = parseIsoDate(date.value)
    // No numeric quote, or an unparseable value: `value_not_in_quote` covers it.
    if (pair === null || iso === null) return
    const [month, day] = order === 'month_first' ? pair : [pair[1], pair[0]]
    if (iso.month === month && iso.day === day) return
    failures.push({
      check: 'date_order_mismatch',
      field: `dates[${index}]`,
      detail: `the value does not match ${pair[0]}/${pair[1]} read ${orderName(order)}, the order the document proves`,
    })
  })
  return failures
}

/** Dates no order can make valid (both leading numbers over 12). */
function impossibleDates(parts: Array<[number, number] | null>): CheckFailure[] {
  return parts.flatMap((pair, index): CheckFailure[] =>
    pair !== null && proofOf(pair) === 'impossible'
      ? [{ check: 'date_order_mismatch', field: `dates[${index}]`, detail: `${pair[0]}/${pair[1]} is not a valid date in either order` }]
      : [],
  )
}

/**
 * The safety net behind the prompt's "US documents are month-first" rule.
 * Flags a document that proves day-first, one whose dates prove both orders,
 * and any date whose value disagrees with its quote under the proven order.
 */
function checkOrder(extracted: ExtractedPo, parts: Array<[number, number] | null>): CheckFailure[] {
  const proofs = parts.map(proofOf)
  const monthFirst = proofs.indexOf('month_first')
  const dayFirst = proofs.indexOf('day_first')
  const failures = impossibleDates(parts)
  if (monthFirst !== -1 && dayFirst !== -1) {
    const detail = `dates[${monthFirst}] can only be month-first but dates[${dayFirst}] can only be day-first; check every date`
    return [...failures, { check: 'date_order_mismatch', field: 'dates', detail }]
  }
  if (dayFirst !== -1) {
    const detail = `dates[${dayFirst}] can only be read day-first, but US POs are month-first; check every date`
    failures.push({ check: 'date_order_mismatch', field: 'dates', detail })
  }
  const order: DateOrder | null = dayFirst !== -1 ? 'day_first' : monthFirst !== -1 ? 'month_first' : null
  return order === null ? failures : [...failures, ...checkValuesInOrder(extracted, parts, order)]
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
 * - **Order (`date_order_mismatch`):** POs are US-only and month-first, so a
 *   document that proves day-first (31/08/26) is flagged, as is one whose
 *   dates prove both orders, a date valid in neither order (13/20/26), and a
 *   date whose value is not its quote read in the proven order.
 * - **Multiple delivery dates:** more than one *different* `delivery` date.
 *   The same date printed twice is not ambiguous.
 *
 * @param extracted - A validated extraction.
 */
export function checkDates(extracted: ExtractedPo): CheckFailure[] {
  const parts = extracted.dates.map((date) => leadingParts(date.quote))
  return [...checkAmbiguous(parts), ...checkOrder(extracted, parts), ...checkDeliveryCount(extracted)]
}
