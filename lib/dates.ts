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
/** Mon–Sat: the number of columns the production calendar renders. */
const BUSINESS_DAYS_PER_WEEK = 6
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
 * True for Monday–Saturday. Sunday is the only non-production day — there is no
 * holiday calendar in this project and none is planned (CONSTRAINT-19).
 *
 * Saturday became a full production day in Task 88; the name is kept because
 * "business day" is what every caller and every stored comment means by it, and
 * the set it denotes is the thing that changed, not the concept.
 */
export function isBusinessDay(date: Date): boolean {
  const day = getDay(date)
  return day !== SUNDAY
}

/**
 * The last Mon–Sat strictly before `date`. Monday and Sunday both resolve to
 * the prior Saturday; every other day resolves to the previous calendar day.
 * Crosses month and year boundaries naturally.
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
 * The next Mon–Sat strictly after `date`. Saturday and Sunday both resolve to
 * the following Monday; every other day resolves to the next calendar day.
 * Used by the dashboard Production widget's "next 2 business days" window.
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
 * On Mon–Sat this is the Monday of the current week: Saturday is a production
 * day and belongs to the week it falls in, so "Current week" on a Saturday must
 * land on that Saturday's own week.
 *
 * On a Sunday it is the *following* Monday, not the preceding one — a
 * salesperson opening the calendar on the one non-production day is planning
 * the week ahead, not reviewing the one that already ended.
 *
 * The Mon–Sat / Sunday split is exactly `isBusinessDay`, so the branch reuses it
 * rather than re-testing the day index and risking the two drifting apart.
 */
export function startOfBusinessWeek(date: Date): Date {
  const monday = startOfWeek(date, { weekStartsOn: MONDAY })
  return isBusinessDay(date) ? monday : addDays(monday, DAYS_IN_WEEK)
}

/**
 * The 6 production Dates (Mon–Sat) of the week opened by `monday`.
 *
 * @throws {InvalidDateError} when `monday` is not a Monday — a Saturday
 * included. Accepting any other day would silently emit a Sunday column, which
 * the calendar must never render (CONSTRAINT-19), and would slide every week
 * group off its boundary. Callers pass the result of `startOfBusinessWeek`.
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
