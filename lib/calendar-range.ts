import { addDays, addWeeks, format, isValid, parseISO, subWeeks } from 'date-fns'
import { CALENDAR_WEEKS_BUFFER } from '@/db/queries/calendar.constants'
import { ISO_DATE_RE, PO_NUMBER_MAX } from './actions/orders.validation'
import { DB_DATE_FORMAT, startOfBusinessWeek } from './dates'
import type { CalendarRange } from '@/db/queries/calendar'

// Offset from a week's Monday to its Saturday — the last day the calendar
// renders. There is no Sunday column (CONSTRAINT-19), so the fetch window
// closes on a Saturday rather than a Sunday.
const MONDAY_TO_SATURDAY_OFFSET = 5

/**
 * Resolves the `/calendar` route's anchor week from an optional
 * `?week=yyyy-MM-dd` query param, returning the Monday that opens that
 * business week.
 *
 * A missing, malformed, or impossible-but-well-shaped value (`2026-02-31`) is
 * ignored and `today` is used instead — a stale bookmark should open the
 * current week, not an error page. `ISO_DATE_RE` rejects anything that is not
 * bare `yyyy-MM-dd`, so a full ISO timestamp is treated as malformed rather
 * than silently accepted with a time component.
 *
 * Uses `parseISO`, never `new Date(string)`: the latter reads a date-only
 * string as UTC midnight, which lands on the previous calendar day in any
 * negative-offset timezone and would open the wrong week for a US user.
 *
 * A Sunday value — and only a Sunday — resolves *forward* to the coming Monday
 * (`startOfBusinessWeek`), because someone opening the calendar on the one
 * non-production day is planning the week ahead, not reviewing the one that
 * just ended. A Saturday resolves *back* to its own week's Monday: Saturday is
 * a production day and its column lives in the week it falls in.
 *
 * A repeated `?week=a&week=b` arrives as an **array**, which is why the
 * parameter is typed for one: the shape check is `typeof value === 'string'`
 * before any string method is reached, so an array falls through to the
 * fallback rather than throwing at request time (SEC-02, finding T78-L01).
 *
 * @param value Raw `?week=` query param, if present — a string, or an array
 * when the param was repeated in the URL.
 * @param today Reference date for the fallback. Injected so callers — and
 * tests — control "now" rather than depending on the system clock.
 */
export function parseCalendarWeek(value: string | string[] | undefined, today: Date): Date {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return startOfBusinessWeek(today)
  const parsed = parseISO(value)
  return startOfBusinessWeek(isValid(parsed) ? parsed : today)
}

/**
 * The `/calendar` fetch window: `CALENDAR_WEEKS_BUFFER` whole business weeks
 * either side of the anchor week, as `DB_DATE_FORMAT` strings.
 *
 * Buffering both directions means the week strip's arrow navigation stays
 * instant for roughly a month each way without a server round-trip.
 *
 * @param weekStart The anchor week's Monday — pass the result of
 * `parseCalendarWeek`.
 */
export function buildCalendarRange(weekStart: Date): CalendarRange {
  const firstMonday = subWeeks(weekStart, CALENDAR_WEEKS_BUFFER)
  const lastSaturday = addDays(addWeeks(weekStart, CALENDAR_WEEKS_BUFFER), MONDAY_TO_SATURDAY_OFFSET)
  return {
    from: format(firstMonday, DB_DATE_FORMAT),
    to: format(lastSaturday, DB_DATE_FORMAT),
  }
}

/**
 * Resolves the `/calendar` route's `?find=` param — the PO number a cross-week
 * search jump asked to be revealed once the new week has loaded.
 *
 * Length-capped at `PO_NUMBER_MAX` because no real PO number is longer, and
 * rejected outright when the param was repeated (an array, the same shape trap
 * `parseCalendarWeek` documents). Anything rejected yields null, which simply
 * means no card is highlighted — a stale or hand-edited link should open the
 * calendar, never fail it.
 *
 * The value never reaches SQL. It is compared against `data-po-number` in the
 * DOM and against already-loaded rows, so this is a sanity bound rather than
 * the injection boundary — that one is `searchCalendarOrders`, which binds its
 * term as a parameter (SEC-02).
 *
 * @param value Raw `?find=` query param, if present.
 */
export function parseCalendarFind(value: string | string[] | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > PO_NUMBER_MAX) return null
  return trimmed
}
