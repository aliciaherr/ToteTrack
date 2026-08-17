import { describe, it, expect } from 'vitest'
import { format } from 'date-fns'
import {
  DB_DATE_FORMAT,
  businessWeekDays,
  isBusinessDay,
  nextBusinessDay,
  parseDbDate,
  prevBusinessDay,
  startOfBusinessWeek,
} from '../dates'
import { InvalidDateError } from '../errors'

/** Local-midnight Date, so no test depends on the machine's timezone offset. */
const localDate = (year: number, month: number, day: number) => new Date(year, month - 1, day)
const iso = (date: Date) => format(date, DB_DATE_FORMAT)

// Reference week — verified days, used across the suite:
// Sat 2026-05-30 | Sun 2026-05-31 | Mon 2026-06-01 | Tue 2026-06-02
// Wed 2026-06-03 | Thu 2026-06-04 | Fri 2026-06-05 | Sat 2026-06-06
// Sun 2026-06-07 | Mon 2026-06-08
const SAT_MAY_30 = localDate(2026, 5, 30)
const MON_JUN_1 = localDate(2026, 6, 1)
const TUE_JUN_2 = localDate(2026, 6, 2)
const WED_JUN_3 = localDate(2026, 6, 3)
const FRI_JUN_5 = localDate(2026, 6, 5)
const SAT_JUN_6 = localDate(2026, 6, 6)
const SUN_JUN_7 = localDate(2026, 6, 7)
const MON_JUN_8 = localDate(2026, 6, 8)

describe('parseDbDate', () => {
  it('parses a DB_DATE_FORMAT string to local midnight, not UTC midnight', () => {
    const parsed = parseDbDate('test', '2026-06-01')
    // Local getters, so a UTC-midnight parse would fail this in any western timezone.
    expect(parsed.getFullYear()).toBe(2026)
    expect(parsed.getMonth()).toBe(5)
    expect(parsed.getDate()).toBe(1)
    expect(parsed.getHours()).toBe(0)
  })

  it('throws InvalidDateError naming the calling helper', () => {
    expect(() => parseDbDate('getCalendarOrders', 'nope')).toThrow(InvalidDateError)
    expect(() => parseDbDate('getCalendarOrders', 'nope')).toThrow(/getCalendarOrders/)
  })
})

describe('isBusinessDay', () => {
  it('is true Monday through Friday', () => {
    for (const day of [MON_JUN_1, TUE_JUN_2, WED_JUN_3, FRI_JUN_5]) {
      expect(isBusinessDay(day), iso(day)).toBe(true)
    }
  })

  it('is true on Saturday — a full production day since Task 88', () => {
    expect(isBusinessDay(SAT_JUN_6)).toBe(true)
  })

  it('is false on Sunday, the only non-production day', () => {
    expect(isBusinessDay(SUN_JUN_7)).toBe(false)
  })
})

describe('prevBusinessDay', () => {
  it('maps Mon and Sun back to the prior Saturday', () => {
    // The Monday case is what seeds a new PO's build day from a Monday
    // delivery promise — it must land on Saturday, not skip back to Friday.
    expect(iso(prevBusinessDay(MON_JUN_1))).toBe('2026-05-30')
    expect(iso(prevBusinessDay(SUN_JUN_7))).toBe('2026-06-06')
  })

  it('maps Tue–Sat to the previous calendar day', () => {
    expect(iso(prevBusinessDay(TUE_JUN_2))).toBe('2026-06-01')
    expect(iso(prevBusinessDay(FRI_JUN_5))).toBe('2026-06-04')
    expect(iso(prevBusinessDay(SAT_JUN_6))).toBe('2026-06-05')
  })

  it('crosses a month boundary', () => {
    expect(iso(prevBusinessDay(MON_JUN_1))).toBe('2026-05-30')
  })

  it('crosses a year boundary', () => {
    // Mon 2027-01-04 → Sat 2027-01-02
    expect(iso(prevBusinessDay(localDate(2027, 1, 4)))).toBe('2027-01-02')
  })

  it('never returns a Sunday, for any day of the reference week', () => {
    for (const day of [MON_JUN_1, TUE_JUN_2, WED_JUN_3, FRI_JUN_5, SAT_JUN_6, SUN_JUN_7]) {
      expect(isBusinessDay(prevBusinessDay(day)), iso(day)).toBe(true)
    }
  })
})

describe('nextBusinessDay', () => {
  it('maps Sat and Sun to the following Monday', () => {
    expect(iso(nextBusinessDay(SAT_JUN_6))).toBe('2026-06-08')
    expect(iso(nextBusinessDay(SUN_JUN_7))).toBe('2026-06-08')
  })

  it('maps Mon–Fri to the next calendar day, Friday included', () => {
    expect(iso(nextBusinessDay(MON_JUN_1))).toBe('2026-06-02')
    expect(iso(nextBusinessDay(FRI_JUN_5))).toBe('2026-06-06')
  })

  it('never returns a Sunday, for any day of the reference week', () => {
    for (const day of [MON_JUN_1, TUE_JUN_2, WED_JUN_3, FRI_JUN_5, SAT_JUN_6, SUN_JUN_7]) {
      expect(isBusinessDay(nextBusinessDay(day)), iso(day)).toBe(true)
    }
  })
})

describe('startOfBusinessWeek', () => {
  it('returns the Monday of the current week on a weekday', () => {
    expect(iso(startOfBusinessWeek(WED_JUN_3))).toBe('2026-06-01')
    expect(iso(startOfBusinessWeek(MON_JUN_1))).toBe('2026-06-01')
    expect(iso(startOfBusinessWeek(FRI_JUN_5))).toBe('2026-06-01')
  })

  it('maps a Saturday BACK to its own week Monday, not forward', () => {
    // Saturday is a production day, so it belongs to the week it falls in —
    // `Current week` pressed on a Saturday must show that Saturday's column.
    expect(iso(startOfBusinessWeek(SAT_JUN_6))).toBe('2026-06-01')
    expect(iso(startOfBusinessWeek(SAT_MAY_30))).toBe('2026-05-25')
  })

  it('still maps a Sunday FORWARD to the following Monday', () => {
    expect(iso(startOfBusinessWeek(SUN_JUN_7))).toBe('2026-06-08')
  })
})

describe('businessWeekDays', () => {
  it('returns the 6 production days from a Monday, ending Saturday', () => {
    expect(businessWeekDays(MON_JUN_1).map(iso)).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
      '2026-06-06',
    ])
  })

  it('never includes a Sunday', () => {
    for (const day of businessWeekDays(MON_JUN_8)) {
      expect(isBusinessDay(day), iso(day)).toBe(true)
    }
  })

  it('throws InvalidDateError when given a day that is not a Monday', () => {
    expect(() => businessWeekDays(WED_JUN_3)).toThrow(InvalidDateError)
  })

  it('still throws on a Saturday, even though Saturday is now a business day', () => {
    // `isBusinessDay(sat)` is true since Task 88; the Monday-only precondition
    // is separate and must not have loosened with it, or every week group
    // would slide off its boundary.
    expect(() => businessWeekDays(SAT_JUN_6)).toThrow(InvalidDateError)
    expect(() => businessWeekDays(SAT_JUN_6)).toThrow(/expected a Monday/)
  })

  it('throws InvalidDateError when given an invalid Date', () => {
    expect(() => businessWeekDays(new Date(NaN))).toThrow(InvalidDateError)
  })
})
