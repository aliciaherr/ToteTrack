import { describe, expect, it } from 'vitest'
import { checkValuesInQuotes, dateInQuote, poNumberInQuote, totalInQuote } from '../value-in-quote'
import { makePo } from './fixtures'

describe('poNumberInQuote', () => {
  it('finds the value in its quote, ignoring case and punctuation', () => {
    expect(poNumberInQuote('PO-0001', 'Purchase Order No.: PO-0001')).toBe(true)
    expect(poNumberInQuote('PO-0001', 'po 0001')).toBe(true)
    expect(poNumberInQuote('10672', 'PO# 10672')).toBe(true)
  })

  it('rejects transposed digits and a number cut short', () => {
    expect(poNumberInQuote('10627', 'PO 10672')).toBe(false)
    expect(poNumberInQuote('1067', 'PO# 10672')).toBe(false)
  })
})

describe('totalInQuote', () => {
  it('matches the value to the cent against an amount in the quote', () => {
    expect(totalInQuote(1000, '$1,000.00')).toBe(true)
    expect(totalInQuote(7800.18, 'TOTAL 7,800.18 USD')).toBe(true)
    expect(totalInQuote(7800, 'Total: $7800')).toBe(true)
  })

  it('rejects a total that differs from every printed amount', () => {
    expect(totalInQuote(7800, '$7,800.18')).toBe(false)
    expect(totalInQuote(7800.18, '$7,800')).toBe(false)
    expect(totalInQuote(1000, 'Total due')).toBe(false)
  })
})

describe('dateInQuote', () => {
  it('reads numeric dates in either order, year-first and written-out dates', () => {
    expect(dateInQuote('2026-01-20', '01/20/26')).toBe(true)
    expect(dateInQuote('2026-01-20', '20.01.2026')).toBe(true)
    expect(dateInQuote('2026-03-05', 'Date: 2026-03-05')).toBe(true)
    expect(dateInQuote('2026-03-05', 'March 5, 2026')).toBe(true)
    expect(dateInQuote('2026-03-05', '5 Mar 2026')).toBe(true)
  })

  it('flags a different day, month or year, or a value not in YYYY-MM-DD', () => {
    expect(dateInQuote('2026-01-21', '01/20/26')).toBe(false)
    expect(dateInQuote('2025-01-20', '01/20/26')).toBe(false)
    expect(dateInQuote('2026-04-05', 'March 5, 2026')).toBe(false)
    expect(dateInQuote('01/20/26', '01/20/26')).toBe(false)
  })

  it('is conservative: flags a written date with no year, or two month names', () => {
    expect(dateInQuote('2026-03-05', 'March 5')).toBe(false)
    expect(dateInQuote('2026-03-05', 'March 5 - April 5, 2026')).toBe(false)
  })

  it('reads a written date with a 2-digit year (Task 123)', () => {
    expect(dateInQuote('2026-03-05', '05-MAR-26')).toBe(true)
    expect(dateInQuote('2026-03-05', "Mar 5, '26")).toBe(true)
    expect(dateInQuote('2026-03-26', 'Mar 26, 26')).toBe(true)
  })

  it('does not read the day as the year, or accept a wrong 2-digit year', () => {
    expect(dateInQuote('2026-03-26', 'Mar 26')).toBe(false)
    expect(dateInQuote('2026-03-05', '05-MAR-25')).toBe(false)
    expect(dateInQuote('2026-03-05', 'Mar 5, 126')).toBe(false)
  })
})

describe('checkValuesInQuotes', () => {
  it('passes a PO whose values all sit in their own quotes', () => {
    expect(checkValuesInQuotes(makePo())).toEqual([])
  })

  it('flags a PO number, total and date that are not in their own quotes', () => {
    const po = makePo({
      poNumberCandidates: [{ value: '10627', label: 'PO', quote: 'PO 10672' }],
      statedTotal: { value: 7800, quote: '$7,800.18' },
      dates: [{ value: '2026-01-21', label: 'Need Date', role: 'delivery', quote: '01/20/26' }],
    })
    expect(checkValuesInQuotes(po)).toEqual([
      { check: 'value_not_in_quote', field: 'poNumberCandidates[0]', detail: 'the PO number value is not in its own quote' },
      { check: 'value_not_in_quote', field: 'statedTotal', detail: 'the stated total value is not in its own quote' },
      { check: 'value_not_in_quote', field: 'dates[0]', detail: 'the date value is not in its own quote' },
    ])
  })

  it('skips blank quotes and blank PO numbers, which other checks flag', () => {
    const po = makePo({
      poNumberCandidates: [{ value: '', label: 'PO', quote: '' }, { value: '123', label: 'PO', quote: ' ' }],
      statedTotal: { value: 5, quote: '' },
      dates: [{ value: '2026-01-20', label: 'Date', role: 'order', quote: '' }],
    })
    expect(checkValuesInQuotes(po)).toEqual([])
  })

  it('never puts document text in the detail', () => {
    const po = makePo({ poNumberCandidates: [{ value: 'SECRET-9', label: 'PO', quote: 'SECRET-8' }] })
    expect(JSON.stringify(checkValuesInQuotes(po))).not.toContain('SECRET')
  })
})
