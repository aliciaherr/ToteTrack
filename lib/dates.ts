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
 * Called from exactly one place: order creation, where it sets the initial
 * `production_date` so a new PO lands on the calendar without being dragged
 * there. Nothing derives a card's position at read time — a card's day *is* its
 * `production_date` (CONSTRAINT-19).
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
