import { describe, expect, it } from 'vitest'
import type { ExtractedDate } from '@/lib/extraction/types'
import { checkDates } from '../dates'
import { makePo } from './fixtures'

function date(quote: string, role: ExtractedDate['role'] = 'order', value = '2026-01-01'): ExtractedDate {
  return { value, label: 'Date', role, quote }
}

describe('checkDates — ambiguity', () => {
  it('passes a date with a component over 12', () => {
    expect(checkDates(makePo({ dates: [date('08-31-2026')] }))).toEqual([])
  })

  it('fails 03/05/26 when nothing on the document settles the order', () => {
    expect(checkDates(makePo({ dates: [date('Order Date: 03/05/26')] }))).toEqual([
      { check: 'ambiguous_date', field: 'dates[0]', detail: expect.stringContaining('3/5') },
    ])
  })

  it('passes 03/05/26 when another date on the document proves the order', () => {
    expect(checkDates(makePo({ dates: [date('03/05/26'), date('03/20/26', 'delivery')] }))).toEqual([])
  })

  it('passes equal components (09/09/2026), which read the same either way', () => {
    expect(checkDates(makePo({ dates: [date('09/09/2026')] }))).toEqual([])
  })

  it('passes year-first and written-out dates', () => {
    expect(checkDates(makePo({ dates: [date('2026-03-05'), date('March 5, 2026')] }))).toEqual([])
  })
})

describe('checkDates — delivery candidates', () => {
  it('passes one delivery date, or the same one printed twice', () => {
    const twice = [date('01/20/26', 'delivery', '2026-01-20'), date('01-20-2026', 'delivery', '2026-01-20')]
    expect(checkDates(makePo({ dates: twice }))).toEqual([])
  })

  it('fails two different delivery dates', () => {
    const dates = [date('01/20/26', 'delivery', '2026-01-20'), date('01/27/26', 'delivery', '2026-01-27')]
    expect(checkDates(makePo({ dates }))).toEqual([
      { check: 'multiple_delivery_dates', field: 'dates', detail: '2 different delivery dates: dates[0], dates[1]' },
    ])
  })
})
