import { describe, expect, it } from 'vitest'
import { MAX_LINE_QUANTITY, MAX_UNIT_PRICE } from '../checks.constants'
import { checkFields, quantityProblem, unitPriceProblem } from '../fields'
import type { CheckName } from '../types'
import { makePo, otherLine, toteLine } from './fixtures'

function checksOf(po: ReturnType<typeof makePo>): CheckName[] {
  return checkFields(po).map((failure) => failure.check)
}

describe('checkFields — document gates', () => {
  it('passes a complete PO', () => {
    expect(checkFields(makePo())).toEqual([])
  })

  it('fails a document that is not a purchase order', () => {
    expect(checksOf(makePo({ isPurchaseOrder: false }))).toEqual(['not_purchase_order'])
  })

  it('fails when no PO number was found', () => {
    expect(checksOf(makePo({ poNumberCandidates: [] }))).toEqual(['missing_po_number'])
  })

  it('fails when no ship-to address was found, including a blank one', () => {
    expect(checksOf(makePo({ shipToAddress: { value: null, quote: '' } }))).toEqual(['missing_ship_to'])
    expect(checksOf(makePo({ shipToAddress: { value: '  ', quote: '' } }))).toEqual(['missing_ship_to'])
  })
})

describe('checkFields — tote lines', () => {
  it('fails an unknown tote line', () => {
    expect(checkFields(makePo({ lines: [toteLine({ toteType: 'unknown' })] }))).toEqual([
      { check: 'unknown_tote_type', field: 'lines[0]', detail: expect.any(String) },
    ])
  })

  it('fails one tote type at two prices', () => {
    const lines = [toteLine(), toteLine({ unitPrice: 110, lineTotal: 1100 })]
    expect(checkFields(makePo({ lines }))).toEqual([
      { check: 'conflicting_unit_price', field: 'lines', detail: '275_recon appears at more than one unit price' },
    ])
  })

  it('accepts quantity and unit price exactly at their limits', () => {
    const line = toteLine({ quantity: MAX_LINE_QUANTITY, unitPrice: MAX_UNIT_PRICE, lineTotal: null })
    expect(checkFields(makePo({ lines: [line] }))).toEqual([])
  })

  it('flags a missing quantity with its own check, not as out of bounds (Task 123)', () => {
    const po = makePo({ lines: [toteLine({ quantity: null, lineTotal: null })] })
    expect(checkFields(po)).toEqual([{ check: 'quantity_missing', field: 'lines[0]', detail: 'no quantity stated' }])
  })

  it.each([
    ['zero', 0],
    ['fractional', 2.5],
    ['over the limit', MAX_LINE_QUANTITY + 1],
  ])('flags a %s quantity, never clamps it', (_, quantity) => {
    const po = makePo({ lines: [toteLine({ quantity })] })
    expect(checksOf(po)).toEqual(['quantity_out_of_bounds'])
    expect(po.lines[0].quantity).toBe(quantity)
  })

  it.each([
    ['negative', -1],
    ['zero ($0 is never a real tote price)', 0],
    ['over the limit', MAX_UNIT_PRICE + 1],
  ])('flags a %s unit price', (_, unitPrice) => {
    expect(checksOf(makePo({ lines: [toteLine({ unitPrice })] }))).toEqual(['unit_price_out_of_bounds'])
  })

  it('does not gate other lines', () => {
    expect(checkFields(makePo({ lines: [toteLine(), otherLine({ quantity: 0, unitPrice: -5 })] }))).toEqual([])
  })
})

describe('quantityProblem (shared with the review screen)', () => {
  it('returns null for a whole quantity within bounds', () => {
    expect(quantityProblem(1)).toBeNull()
    expect(quantityProblem(MAX_LINE_QUANTITY)).toBeNull()
  })

  it('names the problem for a missing, zero, fractional or over-limit quantity', () => {
    expect(quantityProblem(null)).toBe('no quantity stated')
    expect(quantityProblem(0)).toMatch(/not a whole number above 0/)
    expect(quantityProblem(2.5)).toMatch(/not a whole number above 0/)
    expect(quantityProblem(MAX_LINE_QUANTITY + 1)).toMatch(/over the/)
  })
})

describe('unitPriceProblem (shared with the review screen)', () => {
  it('returns null for an unstated price, a cent, and the limit', () => {
    expect(unitPriceProblem(null)).toBeNull()
    expect(unitPriceProblem(0.01)).toBeNull()
    expect(unitPriceProblem(MAX_UNIT_PRICE)).toBeNull()
  })

  it('names the problem for $0, a negative or an over-limit price', () => {
    expect(unitPriceProblem(0)).toBe('unit price 0 is not above $0')
    expect(unitPriceProblem(-5)).toMatch(/not above \$0/)
    expect(unitPriceProblem(MAX_UNIT_PRICE + 1)).toMatch(/over the/)
  })
})
