import { addWeeks, format, subWeeks } from 'date-fns'
import { CALENDAR_WEEKS_BUFFER } from '@/db/queries/calendar.constants'
import { DB_DATE_FORMAT, businessWeekDays, parseDbDate } from '@/lib/dates'
import type { CalendarOrderRow } from '@/db/queries/calendar'

/** `date-fns` token for a day header's weekday abbreviation, e.g. `Mon`. */
export const WEEKDAY_FORMAT = 'EEE'
/** `date-fns` token for a day header's day-of-month, e.g. `27`. */
export const DAY_OF_MONTH_FORMAT = 'd'

export interface WeekGroup {
  /** The week's Monday as `yyyy-MM-dd`. Stable React key and scroll target. */
  key: string
  /** Range label shown above the week's own columns, e.g. `Jul 27 – 31`. */
  label: string
  /** The five Mon–Fri dates. Never contains a weekend (CONSTRAINT-19). */
  days: Date[]
}

/**
 * Builds the week groups the strip renders: `CALENDAR_WEEKS_BUFFER` weeks
 * either side of the anchor, plus the anchor week itself.
 *
 * The count matches the range `buildCalendarRange` fetches, so every column the
 * strip draws has its rows already in hand and arrow navigation never hits an
 * empty week that actually has orders.
 *
 * @param weekStartKey The anchor week's Monday as `yyyy-MM-dd`.
 * @throws {InvalidDateError} when `weekStartKey` is unparseable or not a Monday.
 */
export function buildWeekGroups(weekStartKey: string): WeekGroup[] {
  const anchor = parseDbDate('buildWeekGroups', weekStartKey)
  const first = subWeeks(anchor, CALENDAR_WEEKS_BUFFER)
  const weekCount = CALENDAR_WEEKS_BUFFER * 2 + 1

  return Array.from({ length: weekCount }, (_, offset) => {
    const monday = addWeeks(first, offset)
    const days = businessWeekDays(monday)
    return {
      key: format(monday, DB_DATE_FORMAT),
      label: formatWeekRange(days[0], days[days.length - 1]),
      days,
    }
  })
}

/**
 * Formats a week's Mon–Fri span. The month is repeated only when the week
 * straddles a boundary (`Jun 29 – Jul 3`), so the common case stays short
 * enough to sit above a 176px column without wrapping.
 */
export function formatWeekRange(monday: Date, friday: Date): string {
  const start = format(monday, 'MMM d')
  const sameMonth = format(monday, 'MMM') === format(friday, 'MMM')
  const end = sameMonth ? format(friday, 'd') : format(friday, 'MMM d')
  return `${start} – ${end}`
}

/**
 * Compares two rows by their position within a day column: explicit sequence
 * first, then PO number as a stable tiebreak.
 *
 * Rows never placed by hand carry a null `production_sort_index` and sort after
 * placed ones — a card the salesperson positioned deliberately should not be
 * pushed down by one that landed on the day by default.
 */
function byColumnPosition(left: CalendarOrderRow, right: CalendarOrderRow): number {
  const leftIndex = left.production_sort_index
  const rightIndex = right.production_sort_index

  if (leftIndex !== rightIndex) {
    if (leftIndex === null) return 1
    if (rightIndex === null) return -1
    return leftIndex - rightIndex
  }
  return left.po_number.localeCompare(right.po_number)
}

/**
 * Buckets calendar rows into their day columns, keyed by `yyyy-MM-dd`.
 *
 * Keys come straight from `production_date`. There is no placement rule to
 * apply — a card's column *is* that column (CONSTRAINT-19).
 *
 * Rows with a null `production_date` are unscheduled and are dropped; they
 * belong to the callout, not to any day.
 */
export function groupRowsByDay(rows: CalendarOrderRow[]): Map<string, CalendarOrderRow[]> {
  const byDay = new Map<string, CalendarOrderRow[]>()

  for (const row of rows) {
    const dayKey = row.production_date
    if (dayKey === null) continue

    const bucket = byDay.get(dayKey)
    if (bucket) {
      bucket.push(row)
    } else {
      byDay.set(dayKey, [row])
    }
  }

  for (const bucket of byDay.values()) {
    bucket.sort(byColumnPosition)
  }

  return byDay
}
