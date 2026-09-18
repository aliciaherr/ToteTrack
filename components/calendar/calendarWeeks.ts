import { addWeeks, format, subWeeks } from 'date-fns'
import { CALENDAR_WEEKS_BUFFER } from '@/db/queries/calendar.constants'
import { DB_DATE_FORMAT, businessWeekDays, parseDbDate, startOfBusinessWeek } from '@/lib/dates'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

/** `date-fns` token for a day header's weekday abbreviation, e.g. `Mon`. */
export const WEEKDAY_FORMAT = 'EEE'
/** `date-fns` token for a day header's day-of-month, e.g. `27`. */
export const DAY_OF_MONTH_FORMAT = 'd'

export interface WeekGroup {
  /** The week's Monday as `yyyy-MM-dd`. Stable React key and scroll target. */
  key: string
  /** Range label shown above the week's own columns, e.g. `Jul 27 – Aug 1`. */
  label: string
  /** The six Mon–Sat dates. Never contains a Sunday (CONSTRAINT-19). */
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
 * Formats a week's Mon–Sat span. The month is repeated only when the week
 * straddles a boundary (`Jun 29 – Jul 4`), so the common case stays short
 * enough to sit above a 176px column without wrapping.
 *
 * @param monday The week's first column.
 * @param lastDay The week's last column — the Saturday since Task 88, but the
 * function reads it as "whatever day closes the week" rather than assuming one,
 * so the caller's `days` array stays the single source of the week's length.
 */
export function formatWeekRange(monday: Date, lastDay: Date): string {
  const start = format(monday, 'MMM d')
  const sameMonth = format(monday, 'MMM') === format(lastDay, 'MMM')
  const end = sameMonth ? format(lastDay, 'd') : format(lastDay, 'MMM d')
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

/**
 * Buckets calendar pickups into their day columns, keyed by `yyyy-MM-dd`.
 *
 * Keys come straight from `pickup_date`, which **is** the placement
 * (CONSTRAINT-25) — there is no second date to fall back on. Pickups with no
 * date are unscheduled and are dropped; they belong to the callout.
 *
 * Deliberately **not** re-sorted here, unlike `groupRowsByDay`. The order comes
 * from `getCalendarPickups`' ORDER BY (`sort_index ASC NULLS LAST`, then
 * `created_at`), and a pickup carries no PO number for a client-side comparator
 * to tiebreak on — so a second ordering implementation could only disagree with
 * the first. Bucketing preserves the array order it is given.
 */
export function groupPickupsByDay(
  pickups: CalendarPickupRow[],
): Map<string, CalendarPickupRow[]> {
  const byDay = new Map<string, CalendarPickupRow[]>()

  for (const pickup of pickups) {
    const dayKey = pickup.pickup_date
    if (dayKey === null) continue

    const bucket = byDay.get(dayKey)
    if (bucket) {
      bucket.push(pickup)
    } else {
      byDay.set(dayKey, [pickup])
    }
  }

  return byDay
}

/**
 * The Monday whose business week holds `dateKey` — the strip's scroll target
 * for a card on that day, and the `?week=` value for a jump to it.
 *
 * Lives here rather than in the search hook because it is the same mapping
 * `buildWeekGroups` keys its groups by; two copies could disagree about a
 * Saturday and send a search to the week next door.
 *
 * @param dateKey A `DB_DATE_FORMAT` date, such as an order's `production_date`.
 * @throws {InvalidDateError} when `dateKey` is unparseable.
 */
export function weekKeyFor(dateKey: string): string {
  return format(startOfBusinessWeek(parseDbDate('weekKeyFor', dateKey)), DB_DATE_FORMAT)
}
