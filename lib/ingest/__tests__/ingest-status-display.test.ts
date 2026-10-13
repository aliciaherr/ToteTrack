import { describe, it, expect } from 'vitest'
import { badgeLabel, formatLastChecked, isCheckStale } from '../ingest-status-display'
import { INGEST_STALE_AFTER_MS } from '../ingest-status.constants'

// Local-time constructors, so "Today" and "Yesterday" hold in any time zone.
const NOW = new Date(2026, 9, 12, 14, 30)
const iso = (date: Date) => date.toISOString()

describe('isCheckStale', () => {
  it('treats a recent check as fresh', () => {
    expect(isCheckStale(iso(new Date(2026, 9, 12, 6, 12)), NOW)).toBe(false)
  })

  it('flags a check older than the stale window', () => {
    expect(isCheckStale(iso(new Date(NOW.getTime() - INGEST_STALE_AFTER_MS - 1000)), NOW)).toBe(true)
  })

  it('flags a never-run or unreadable timestamp as stale', () => {
    expect(isCheckStale(null, NOW)).toBe(true)
    expect(isCheckStale('not a date', NOW)).toBe(true)
  })
})

describe('formatLastChecked', () => {
  it('labels a check from today and from yesterday', () => {
    expect(formatLastChecked(iso(new Date(2026, 9, 12, 6, 12)), NOW)).toBe('Today 6:12 AM')
    expect(formatLastChecked(iso(new Date(2026, 9, 11, 18, 5)), NOW)).toBe('Yesterday 6:05 PM')
  })

  it('spells out the date for anything older', () => {
    expect(formatLastChecked(iso(new Date(2026, 9, 9, 6, 0)), NOW)).toBe('Oct 9, 6:00 AM')
  })

  it('says "Never checked" for null and shows an unreadable value as itself', () => {
    expect(formatLastChecked(null, NOW)).toBe('Never checked')
    expect(formatLastChecked('not a date', NOW)).toBe('not a date')
  })
})

describe('badgeLabel', () => {
  it('prints the count up to 99', () => {
    expect(badgeLabel(7)).toBe('7')
    expect(badgeLabel(99)).toBe('99')
  })

  it('caps anything above at "99+"', () => {
    expect(badgeLabel(100)).toBe('99+')
  })
})
