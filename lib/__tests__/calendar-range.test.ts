import { describe, it, expect } from 'vitest'
import { format, getDay, parseISO } from 'date-fns'
import { parseCalendarWeek, parseCalendarFind, buildCalendarRange } from '../calendar-range'
import { DB_DATE_FORMAT } from '../dates'
import { CALENDAR_WEEKS_BUFFER } from '@/db/queries/calendar.constants'
import { PO_NUMBER_MAX } from '../actions/orders.validation'

// 2026-07-27 is a Monday. The surrounding days anchor every case below.
const MONDAY = '2026-07-27'
const WEDNESDAY = '2026-07-29'
const SATURDAY = '2026-07-25'
const SUNDAY = '2026-07-26'
const PRIOR_MONDAY = '2026-07-20'

const DAY_OF_WEEK_MONDAY = 1

function asDate(value: string): Date {
  return parseISO(value)
}

function iso(value: Date): string {
  return format(value, DB_DATE_FORMAT)
}

describe('parseCalendarWeek', () => {
  it('resolves a weekday param to the Monday of that week', () => {
    expect(iso(parseCalendarWeek(WEDNESDAY, asDate(MONDAY)))).toBe(MONDAY)
  })

  it('resolves a Monday param to itself', () => {
    expect(iso(parseCalendarWeek(MONDAY, asDate(MONDAY)))).toBe(MONDAY)
  })

  it('resolves a Saturday param BACK to its own week Monday', () => {
    // Saturday is a production day (Task 88), so its column lives in the week
    // it falls in — a `?week=` bookmark on a Saturday must open that week.
    expect(iso(parseCalendarWeek(SATURDAY, asDate(PRIOR_MONDAY)))).toBe(PRIOR_MONDAY)
  })

  it('resolves a Sunday param forward to the coming Monday', () => {
    // Someone opening the calendar on the one non-production day is planning
    // the week ahead, not reviewing the one that just ended.
    expect(iso(parseCalendarWeek(SUNDAY, asDate(PRIOR_MONDAY)))).toBe(MONDAY)
  })

  it('falls back to the current business week when the param is absent', () => {
    expect(iso(parseCalendarWeek(undefined, asDate(WEDNESDAY)))).toBe(MONDAY)
  })

  it.each([
    ['a non-date string', 'next-week'],
    ['a US-format date', '07/27/2026'],
    ['a full ISO timestamp', '2026-07-27T10:00:00Z'],
    ['an impossible but well-shaped date', '2026-02-31'],
    ['an empty string', ''],
  ])('ignores %s and falls back to the current business week', (_label, malformed) => {
    expect(iso(parseCalendarWeek(malformed, asDate(WEDNESDAY)))).toBe(MONDAY)
  })

  it('ignores a repeated ?week= param, which Next delivers as an array', () => {
    // SEC-02 / finding T78-L01: the shape check runs before any string method,
    // so `['2026-07-27', 'garbage']` falls back instead of throwing on `.test`
    // of a non-string — or worse, matching on the joined `"a,b"` form.
    const OTHER_WEEK = '2026-08-24'
    expect(iso(parseCalendarWeek([OTHER_WEEK], asDate(WEDNESDAY)))).toBe(MONDAY)
    expect(iso(parseCalendarWeek([OTHER_WEEK, 'garbage'], asDate(WEDNESDAY)))).toBe(MONDAY)
    expect(iso(parseCalendarWeek([], asDate(WEDNESDAY)))).toBe(MONDAY)
  })

  it('always returns a Monday, whatever it is given', () => {
    const inputs = [MONDAY, WEDNESDAY, SATURDAY, SUNDAY, 'garbage', undefined]
    for (const input of inputs) {
      expect(getDay(parseCalendarWeek(input, asDate(SUNDAY)))).toBe(DAY_OF_WEEK_MONDAY)
    }
  })
})

describe('buildCalendarRange', () => {
  it('spans CALENDAR_WEEKS_BUFFER whole weeks either side of the anchor', () => {
    const range = buildCalendarRange(asDate(MONDAY))

    // 4 weeks back from Mon 2026-07-27 is Mon 2026-06-29; 4 weeks forward is
    // Mon 2026-08-24, whose Saturday is 2026-08-29.
    expect(range).toEqual({ from: '2026-06-29', to: '2026-08-29' })
  })

  it('opens on a Monday and closes on a Saturday — never on a Sunday', () => {
    const range = buildCalendarRange(asDate(MONDAY))
    const DAY_OF_WEEK_SATURDAY = 6

    expect(getDay(parseISO(range.from))).toBe(DAY_OF_WEEK_MONDAY)
    expect(getDay(parseISO(range.to))).toBe(DAY_OF_WEEK_SATURDAY)
  })

  it('covers the anchor week itself', () => {
    const range = buildCalendarRange(asDate(MONDAY))

    expect(range.from < MONDAY).toBe(true)
    expect(range.to > MONDAY).toBe(true)
  })

  it('crosses a year boundary without erroring', () => {
    const range = buildCalendarRange(asDate('2026-12-28'))

    expect(range.from).toBe('2026-11-30')
    expect(range.to).toBe('2027-01-30')
  })

  it('stays consistent with the CALENDAR_WEEKS_BUFFER constant', () => {
    const DAYS_PER_WEEK = 7
    const MONDAY_TO_SATURDAY = 5
    const range = buildCalendarRange(asDate(MONDAY))
    const spanDays =
      (parseISO(range.to).getTime() - parseISO(range.from).getTime()) / (1000 * 60 * 60 * 24)

    expect(spanDays).toBe(CALENDAR_WEEKS_BUFFER * 2 * DAYS_PER_WEEK + MONDAY_TO_SATURDAY)
  })
})

describe('parseCalendarFind', () => {
  it('returns the PO number a search jump asked to reveal', () => {
    expect(parseCalendarFind('PO-2026-0412')).toBe('PO-2026-0412')
  })

  it('trims surrounding whitespace', () => {
    expect(parseCalendarFind('  PO-1000  ')).toBe('PO-1000')
  })

  it('ignores a missing param', () => {
    expect(parseCalendarFind(undefined)).toBeNull()
  })

  it('ignores an empty or whitespace-only param', () => {
    expect(parseCalendarFind('')).toBeNull()
    expect(parseCalendarFind('   ')).toBeNull()
  })

  it('ignores a repeated param, which arrives as an array', () => {
    // The same shape trap `parseCalendarWeek` documents: a string method on an
    // array would throw at request time rather than falling back (SEC-02).
    expect(parseCalendarFind(['PO-1000', 'PO-2000'])).toBeNull()
  })

  it('ignores a value longer than a PO number can be', () => {
    expect(parseCalendarFind('x'.repeat(PO_NUMBER_MAX + 1))).toBeNull()
    expect(parseCalendarFind('x'.repeat(PO_NUMBER_MAX))).toBe('x'.repeat(PO_NUMBER_MAX))
  })
})
