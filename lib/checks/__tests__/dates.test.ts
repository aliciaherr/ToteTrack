import { describe, expect, it } from 'vitest'
import type { ExtractedDate } from '@/lib/extraction/types'
import { checkDates } from '../dates'
import { makePo } from './fixtures'

function date(quote: string, role: ExtractedDate['role'] = 'order', value = '2026-01-01'): ExtractedDate {
  return { value, label: 'Date', role, quote }
}

describe('checkDates — ambiguity', () => {
  it('passes a date with a component over 12', () => {
    expect(checkDates(makePo({ dates: [date('08-31-2026', 'order', '2026-08-31')] }))).toEqual([])
  })

  it('fails 03/05/26 when nothing on the document settles the order', () => {
    expect(checkDates(makePo({ dates: [date('Order Date: 03/05/26')] }))).toEqual([
      { check: 'ambiguous_date', field: 'dates[0]', detail: expect.stringContaining('3/5') },
    ])
  })

  it('passes 03/05/26 when another date on the document proves the order', () => {
    const dates = [date('03/05/26', 'order', '2026-03-05'), date('03/20/26', 'delivery', '2026-03-20')]
    expect(checkDates(makePo({ dates }))).toEqual([])
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

describe('checkDates — day-first safety net', () => {
  it('leaves a normal US document unchanged', () => {
    const dates = [date('Order Date 03/05/26', 'order', '2026-03-05'), date('Need 03/20/26', 'delivery', '2026-03-20')]
    expect(checkDates(makePo({ dates }))).toEqual([])
  })

  it('flags a document that proves day-first, even when the values follow it', () => {
    const dates = [date('31/08/26', 'order', '2026-08-31'), date('05/09/26', 'delivery', '2026-09-05')]
    expect(checkDates(makePo({ dates }))).toEqual([
      { check: 'date_order_mismatch', field: 'dates', detail: expect.stringContaining('dates[0]') },
    ])
  })

  it('flags conflicting proofs once, naming both dates', () => {
    const dates = [date('03/20/26', 'order', '2026-03-20'), date('20/03/26', 'delivery', '2026-03-20')]
    const failures = checkDates(makePo({ dates }))
    expect(failures).toEqual([{ check: 'date_order_mismatch', field: 'dates', detail: expect.any(String) }])
    expect(failures[0].detail).toContain('dates[0]')
    expect(failures[0].detail).toContain('dates[1]')
  })

  it('flags a value that is its quote read in the other order than the document proves', () => {
    const dates = [date('03/05/26', 'order', '2026-05-03'), date('03/20/26', 'delivery', '2026-03-20')]
    expect(checkDates(makePo({ dates }))).toEqual([
      { check: 'date_order_mismatch', field: 'dates[0]', detail: expect.stringContaining('month-first') },
    ])
  })

  it('on a day-first document, also flags a value read month-first', () => {
    const dates = [date('31/08/26', 'order', '2026-08-31'), date('05/09/26', 'delivery', '2026-05-09')]
    expect(checkDates(makePo({ dates })).map((failure) => failure.field)).toEqual(['dates', 'dates[1]'])
  })

  it('flags a date valid in neither order', () => {
    expect(checkDates(makePo({ dates: [date('13/20/26', 'order', '2026-01-01')] }))).toEqual([
      { check: 'date_order_mismatch', field: 'dates[0]', detail: expect.stringContaining('either order') },
    ])
  })
})
