import { addDays, format, getDay, isValid, parseISO, startOfWeek, subDays } from 'date-fns'
import { InvalidDateError } from './errors'

/**
 * ISO date format (`yyyy-MM-dd`) that Postgres accepts for `date` column
 * literals and comparisons. Shared across server actions and queries so the
 * wire format for date columns stays consistent and does not drift.
 */
export const DB_DATE_FORMAT = 'yyyy-MM-dd'

/** `date-fns` day-of-week index for Sunday. */
const SUNDAY = 0
/** `date-fns` day-of-week index for Monday — also `weekStartsOn` for a business week. */
const MONDAY = 1
/** `date-fns` day-of-week index for Saturday. */
const SATURDAY = 6
/** Mon–Fri: the number of columns the production calendar renders. */
const BUSINESS_DAYS_PER_WEEK = 5
/** Offset from any Monday to the following Monday. */
const DAYS_IN_WEEK = 7

/**
 * Parses a `DB_DATE_FORMAT` string into a local-midnight Date.
 *
 * Uses `parseISO` rather than `new Date(string)`: the latter reads a date-only
 * string as UTC midnight, which lands on the *previous* calendar day in any
 * negative-offset timezone and would silently shift every card one column left.
 *
 * `helper` names the caller so the thrown error identifies where the bad value
 * entered the system rather than pointing at this function.
 *
 * @throws {InvalidDateError} when the string is not a parseable date.
 */
export function parseDbDate(helper: string, value: string): Date {
  const parsed = parseISO(value)
  if (!isValid(parsed)) {
    throw new InvalidDateError(helper, value, `expected a ${DB_DATE_FORMAT} date string`)
  }
  return parsed
}

/**
 * True for Monday–Friday. Weekends only — there is no holiday calendar in this
 * project and none is planned (CONSTRAINT-19).
 */
export function isBusinessDay(date: Date): boolean {
  const day = getDay(date)
  return day !== SATURDAY && day !== SUNDAY
}

/**
 * The last Mon–Fri strictly before `date`. Monday, Saturday and Sunday all
 * resolve to the prior Friday. Crosses month and year boundaries naturally.
 *
 * This is the single source of the weekday rule behind a PO's default calendar
 * position (CONSTRAINT-19) — no component may inline its own date math.
 */
export function prevBusinessDay(date: Date): Date {
  let candidate = subDays(date, 1)
  while (!isBusinessDay(candidate)) {
    candidate = subDays(candidate, 1)
  }
  return candidate
}

/**
 * The next Mon–Fri strictly after `date`. Friday, Saturday and Sunday all
 * resolve to the following Monday. Used by the dashboard Production widget's
 * "next 2 business days" window.
 */
export function nextBusinessDay(date: Date): Date {
  let candidate = addDays(date, 1)
  while (!isBusinessDay(candidate)) {
    candidate = addDays(candidate, 1)
  }
  return candidate
}

/**
 * The Monday that opens `date`'s business week.
 *
 * On a weekday this is the Monday of the current week. On a Saturday or Sunday
 * it is the *following* Monday, not the preceding one — a salesperson opening
 * the calendar over the weekend is planning the week ahead, so "Current week"
 * must land on the next Mon–Fri rather than the week that already ended.
 */
export function startOfBusinessWeek(date: Date): Date {
  const monday = startOfWeek(date, { weekStartsOn: MONDAY })
  return isBusinessDay(date) ? monday : addDays(monday, DAYS_IN_WEEK)
}

/**
 * The 5 weekday Dates (Mon–Fri) of the week opened by `monday`.
 *
 * @throws {InvalidDateError} when `monday` is not a Monday — accepting any
 * other day would silently emit weekend columns, which the calendar must never
 * render (CONSTRAINT-19). Callers pass the result of `startOfBusinessWeek`.
 */
export function businessWeekDays(monday: Date): Date[] {
  if (!isValid(monday)) {
    throw new InvalidDateError('businessWeekDays', String(monday), 'expected a valid Date')
  }
  if (getDay(monday) !== MONDAY) {
    throw new InvalidDateError(
      'businessWeekDays',
      format(monday, DB_DATE_FORMAT),
      'expected a Monday — pass the result of startOfBusinessWeek',
    )
  }
  return Array.from({ length: BUSINESS_DAYS_PER_WEEK }, (_, offset) => addDays(monday, offset))
}

/**
 * The calendar position of a PO, as a `DB_DATE_FORMAT` string.
 *
 * The COALESCE rule from CONSTRAINT-19 expressed as a pure function:
 * an explicitly placed `production_date` wins; otherwise the card falls back to
 * the business day before the customer's requested delivery date; a PO with
 * neither is unscheduled and returns null.
 *
 * `productionDate` is returned verbatim — it is an explicit placement, not a
 * derived value. The no-weekend invariant is enforced where the column is
 * written, never by silently relocating a stored date on read.
 *
 * @throws {InvalidDateError} when either argument is a non-null unparseable string.
 */
export function effectiveProductionDate(
  productionDate: string | null,
  requestedDeliveryDate: string | null,
): string | null {
  if (productionDate !== null) {
    parseDbDate('effectiveProductionDate', productionDate)
    return productionDate
  }
  if (requestedDeliveryDate !== null) {
    const delivery = parseDbDate('effectiveProductionDate', requestedDeliveryDate)
    return format(prevBusinessDay(delivery), DB_DATE_FORMAT)
  }
  return null
}
