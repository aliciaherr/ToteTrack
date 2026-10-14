import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makePo, toteLine } from '@/lib/checks/__tests__/fixtures'
import type { ExtractedPo } from '@/lib/extraction/types'
import { reviewFieldsOf } from '../review-fields'
import { isWholeCents } from '../review-fields.values'
import { REVIEW_FLAG_WORDING } from '../review-fields.wording'

// Quantity and unit-price pre-fill: one rule with the checks, no rounding,
// and a computed total that matches what the form shows.

const PO_ID = '22222222-2222-2222-2222-222222222222'

function fieldsFor(extracted: ExtractedPo) {
  return reviewFieldsOf({ id: PO_ID, extracted, check_results: null, duplicate_of_id: null }, [])
}

function flagsOf(extracted: ExtractedPo) {
  return fieldsFor(extracted).flags.map((flag) => [flag.field, flag.kind])
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('isWholeCents', () => {
  it.each([100, 19.99, 0.07, 25.05, 10.1, 999.99])('accepts %s', (price) => {
    expect(isWholeCents(price)).toBe(true)
  })

  it.each([12.345, 1.005, 0.001, 19.999])('rejects %s', (price) => {
    expect(isWholeCents(price)).toBe(false)
  })
})

describe('reviewFieldsOf: unit prices', () => {
  it('fills a 2-decimal price as cents', () => {
    const fields = fieldsFor(makePo({ lines: [toteLine({ unitPrice: 19.99, lineTotal: 199.9 })] }))
    expect(fields.values.unit_price_275_recon).toBe('19.99')
    expect(fields.flags).toEqual([])
  })

  it.each([12.345, 1.005])('leaves %s blank and flags it, never rounded', (unitPrice) => {
    const fields = fieldsFor(makePo({ lines: [toteLine({ unitPrice })] }))
    expect(fields.values.unit_price_275_recon).toBeNull()
    expect(fields.values.qty_275_recon).toBe(10)
    expect(fields.flags).toEqual([
      {
        field: 'unit_price_275_recon',
        kind: 'unit_price_too_precise',
        message: REVIEW_FLAG_WORDING.unit_price_too_precise,
        detail: 'a 275_recon line has a unit price with more than 2 decimals',
      },
    ])
  })

  it('leaves a $0 price blank and flags it out of bounds (one rule with the checks)', () => {
    const fields = fieldsFor(makePo({ lines: [toteLine({ unitPrice: 0, lineTotal: 0 })] }))
    expect(fields.values.unit_price_275_recon).toBeNull()
    expect(flagsOf(makePo({ lines: [toteLine({ unitPrice: 0, lineTotal: 0 })] }))).toEqual([
      ['unit_price_275_recon', 'unit_price_out_of_bounds'],
    ])
  })

  it('leaves a missing price blank with no flag', () => {
    const fields = fieldsFor(makePo({ lines: [toteLine({ unitPrice: null, lineTotal: null })] }))
    expect(fields.values.unit_price_275_recon).toBeNull()
    expect(fields.flags).toEqual([])
  })
})

describe('reviewFieldsOf: quantities', () => {
  it('blanks a type when one of its lines states no quantity, and flags it', () => {
    const po = makePo({ lines: [toteLine({ quantity: 10 }), toteLine({ quantity: null, lineTotal: null })] })
    expect(fieldsFor(po).values.qty_275_recon).toBe(0)
    expect(flagsOf(po)).toEqual([['qty_275_recon', 'quantity_missing']])
    expect(fieldsFor(po).flags[0].message).toBe('No quantity found: enter it')
  })

  it('flags a missing and a bad quantity of one type separately', () => {
    const po = makePo({ lines: [toteLine({ quantity: 0, lineTotal: null }), toteLine({ quantity: null, lineTotal: null })] })
    expect(fieldsFor(po).values.qty_275_recon).toBe(0)
    expect(flagsOf(po)).toEqual([['qty_275_recon', 'quantity_missing'], ['qty_275_recon', 'quantity_out_of_bounds']])
  })

  it('blanks a fractional quantity', () => {
    const po = makePo({ lines: [toteLine({ quantity: 2.5, lineTotal: 250 })] })
    expect(fieldsFor(po).values.qty_275_recon).toBe(0)
    expect(flagsOf(po)).toEqual([['qty_275_recon', 'quantity_out_of_bounds']])
  })
})

describe('reviewFieldsOf: computed total', () => {
  it('counts only what the form shows: blanked types are left out', () => {
    const po = makePo({
      lines: [
        toteLine({ toteType: '275_recon', quantity: 10, unitPrice: 100, lineTotal: 1000 }),
        toteLine({ toteType: '330_new', quantity: 10_000, unitPrice: 5, lineTotal: 50_000 }),
        toteLine({ toteType: '275_new', quantity: 2, unitPrice: 50, lineTotal: 100 }),
        toteLine({ toteType: '275_new', quantity: 3, unitPrice: 60, lineTotal: 180 }),
        toteLine({ toteType: '330_recon', quantity: 4, unitPrice: 12.345, lineTotal: 49.38 }),
      ],
    })
    expect(fieldsFor(po).totals.computed).toBe(1000)
  })

  it('sums every filled type to the cent', () => {
    const po = makePo({
      lines: [
        toteLine({ toteType: '275_rebot', quantity: 3, unitPrice: 25.05, lineTotal: 75.15 }),
        toteLine({ toteType: '330_new', quantity: 7, unitPrice: 10.1, lineTotal: 70.7 }),
      ],
    })
    expect(fieldsFor(po).totals.computed).toBe(145.85)
  })
})
