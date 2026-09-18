import { describe, it, expect } from 'vitest'
import { formatShortDate } from '../format-date'

describe('formatShortDate', () => {
  it('renders a date as month and day', () => {
    expect(formatShortDate('2026-07-27')).toBe('Jul 27')
  })

  it('drops the leading zero on single-digit days', () => {
    expect(formatShortDate('2026-05-01')).toBe('May 1')
  })

  it('renders the em dash for a missing date', () => {
    expect(formatShortDate(null)).toBe('—')
    expect(formatShortDate(undefined)).toBe('—')
    expect(formatShortDate('')).toBe('—')
  })

  it('takes a caller-supplied fallback', () => {
    expect(formatShortDate(null, 'Unscheduled')).toBe('Unscheduled')
  })

  it('reads the date in local time, not UTC', () => {
    // `new Date('2026-07-27')` is UTC midnight, which is 2026-07-26 anywhere
    // west of Greenwich — every date would render one day early for a US
    // viewer. `parseISO` reads a date-only string as local.
    expect(formatShortDate('2026-01-01')).toBe('Jan 1')
    expect(formatShortDate('2026-12-31')).toBe('Dec 31')
  })

  it('shows an unparseable value as itself rather than hiding it', () => {
    // Bad data should be visible, not disguised as an empty cell.
    expect(formatShortDate('not-a-date')).toBe('not-a-date')
  })
})
