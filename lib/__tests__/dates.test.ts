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

// Reference week — verified weekdays, used across the suite:
// Fri 2026-05-29 | Mon 2026-06-01 | Tue 2026-06-02 | Wed 2026-06-03
// Thu 2026-06-04 | Fri 2026-06-05 | Sat 2026-06-06 | Sun 2026-06-07 | Mon 2026-06-08
const FRI_MAY_29 = localDate(2026, 5, 29)
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

  it('is false on Saturday and Sunday', () => {
    expect(isBusinessDay(SAT_JUN_6)).toBe(false)
    expect(isBusinessDay(SUN_JUN_7)).toBe(false)
  })
})

describe('prevBusinessDay', () => {
  it('maps Mon/Sat/Sun to the prior Friday', () => {
    expect(iso(prevBusinessDay(MON_JUN_1))).toBe('2026-05-29')
    expect(iso(prevBusinessDay(SAT_JUN_6))).toBe('2026-06-05')
    expect(iso(prevBusinessDay(SUN_JUN_7))).toBe('2026-06-05')
  })

  it('maps Tue–Fri to the previous calendar day', () => {
    expect(iso(prevBusinessDay(TUE_JUN_2))).toBe('2026-06-01')
    expect(iso(prevBusinessDay(FRI_JUN_5))).toBe('2026-06-04')
  })

  it('crosses a month boundary', () => {
    expect(iso(prevBusinessDay(MON_JUN_1))).toBe('2026-05-29')
  })

  it('crosses a year boundary', () => {
    // Mon 2027-01-04 → Fri 2027-01-01
    expect(iso(prevBusinessDay(localDate(2027, 1, 4)))).toBe('2027-01-01')
  })

  it('never returns a weekend, for any day of the reference week', () => {
    for (const day of [MON_JUN_1, TUE_JUN_2, WED_JUN_3, FRI_JUN_5, SAT_JUN_6, SUN_JUN_7]) {
      expect(isBusinessDay(prevBusinessDay(day)), iso(day)).toBe(true)
    }
  })
})

describe('nextBusinessDay', () => {
  it('maps Fri/Sat/Sun to the following Monday', () => {
    expect(iso(nextBusinessDay(FRI_JUN_5))).toBe('2026-06-08')
    expect(iso(nextBusinessDay(SAT_JUN_6))).toBe('2026-06-08')
    expect(iso(nextBusinessDay(SUN_JUN_7))).toBe('2026-06-08')
  })

  it('maps Mon–Thu to the next calendar day', () => {
    expect(iso(nextBusinessDay(MON_JUN_1))).toBe('2026-06-02')
  })

  it('never returns a weekend, for any day of the reference week', () => {
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

  it('returns the FOLLOWING Monday on a weekend, not the preceding one', () => {
    expect(iso(startOfBusinessWeek(SAT_JUN_6))).toBe('2026-06-08')
    expect(iso(startOfBusinessWeek(SUN_JUN_7))).toBe('2026-06-08')
  })
})

describe('businessWeekDays', () => {
  it('returns the 5 weekdays from a Monday', () => {
    expect(businessWeekDays(MON_JUN_1).map(iso)).toEqual([
      '2026-06-01',
      '2026-06-02',
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
    ])
  })

  it('never includes a weekend', () => {
    for (const day of businessWeekDays(MON_JUN_8)) {
      expect(isBusinessDay(day), iso(day)).toBe(true)
    }
  })

  it('throws InvalidDateError when given a day that is not a Monday', () => {
    expect(() => businessWeekDays(WED_JUN_3)).toThrow(InvalidDateError)
    expect(() => businessWeekDays(SAT_JUN_6)).toThrow(/expected a Monday/)
  })

  it('throws InvalidDateError when given an invalid Date', () => {
    expect(() => businessWeekDays(new Date(NaN))).toThrow(InvalidDateError)
  })
})
