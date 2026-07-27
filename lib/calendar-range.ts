import { addDays, addWeeks, format, isValid, parseISO, subWeeks } from 'date-fns'
import { CALENDAR_WEEKS_BUFFER } from '@/db/queries/calendar.constants'
import { ISO_DATE_RE } from './actions/orders.validation'
import { DB_DATE_FORMAT, startOfBusinessWeek } from './dates'
import type { CalendarRange } from '@/db/queries/calendar'

// Offset from a week's Monday to its Friday — the last day the calendar
// renders. There are no weekend columns (CONSTRAINT-19), so the fetch window
// closes on a Friday rather than a Sunday.
const MONDAY_TO_FRIDAY_OFFSET = 4

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
 * A weekend value resolves *forward* to the coming Monday
 * (`startOfBusinessWeek`) — someone opening the calendar on Sunday is planning
 * the week ahead, not reviewing the one that just ended.
 *
 * @param value Raw `?week=` query param, if present.
 * @param today Reference date for the fallback. Injected so callers — and
 * tests — control "now" rather than depending on the system clock.
 */
export function parseCalendarWeek(value: string | undefined, today: Date): Date {
  if (!value || !ISO_DATE_RE.test(value)) return startOfBusinessWeek(today)
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
  const lastFriday = addDays(addWeeks(weekStart, CALENDAR_WEEKS_BUFFER), MONDAY_TO_FRIDAY_OFFSET)
  return {
    from: format(firstMonday, DB_DATE_FORMAT),
    to: format(lastFriday, DB_DATE_FORMAT),
  }
}
