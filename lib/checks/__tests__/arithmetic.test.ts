import { describe, expect, it } from 'vitest'
import { checkArithmetic } from '../arithmetic'
import { makePo, otherLine, toteLine } from './fixtures'

describe('checkArithmetic — stated total', () => {
  it('passes when the total equals the tote lines to the cent', () => {
    const po = makePo({
      statedTotal: { value: 2600, quote: '$2,600.00' },
      lines: [toteLine(), toteLine({ toteType: '330_recon', quantity: 10, unitPrice: 160, lineTotal: 1600 })],
    })
    expect(checkArithmetic(po)).toEqual([])
  })

  it('skips the total check when no total is printed', () => {
    expect(checkArithmetic(makePo({ statedTotal: { value: null, quote: '' } }))).toEqual([])
  })

  it('fails a one-cent gap', () => {
    const failures = checkArithmetic(makePo({ statedTotal: { value: 1000.01, quote: '$1,000.01' } }))
    expect(failures).toEqual([
      { check: 'total_mismatch', field: 'statedTotal', detail: expect.stringContaining('gap $0.01') },
    ])
  })

  it('still fails a gap that other lines cover exactly, naming those lines', () => {
    const po = makePo({
      statedTotal: { value: 7800.18, quote: '$7,800.18' },
      lines: [
        toteLine({ toteType: '330_recon', quantity: 60, unitPrice: 130, lineTotal: 7800 }),
        otherLine({ unitPrice: 0.003, lineTotal: 0.18, quote: 'Inv Accrual $0.0030 $0.18' }),
      ],
    })
    const [failure] = checkArithmetic(po)
    expect(failure.check).toBe('total_mismatch')
    expect(failure.detail).toContain('gap $0.18')
    expect(failure.detail).toContain('covered exactly by other lines: lines[1] $0.18')
  })

  it('does not claim coverage when other lines do not add up to the gap', () => {
    const po = makePo({
      statedTotal: { value: 1050, quote: '$1,050.00' },
      lines: [toteLine(), otherLine({ lineTotal: 25 })],
    })
    expect(checkArithmetic(po)[0].detail).not.toContain('covered')
  })

  it('uses the printed line total for a tote line with no unit price', () => {
    const po = makePo({ lines: [toteLine({ unitPrice: null, lineTotal: 1000 })] })
    expect(checkArithmetic(po)).toEqual([])
  })
})

describe('checkArithmetic — line totals', () => {
  it('fails qty × unit ≠ line total', () => {
    const po = makePo({ statedTotal: { value: null, quote: '' }, lines: [toteLine({ lineTotal: 1100 })] })
    expect(checkArithmetic(po)).toEqual([
      { check: 'line_total_mismatch', field: 'lines[0]', detail: '10 × $100 = $1,000, but the line total is $1,100' },
    ])
  })

  it('passes a line total that divides evenly when no unit price is stated', () => {
    const po = makePo({ statedTotal: { value: null, quote: '' }, lines: [toteLine({ unitPrice: null, quantity: 3, lineTotal: 450.03 })] })
    expect(checkArithmetic(po)).toEqual([])
  })

  it('fails a line total that does not divide evenly to the cent', () => {
    const po = makePo({ statedTotal: { value: null, quote: '' }, lines: [toteLine({ unitPrice: null, quantity: 3, lineTotal: 100 })] })
    expect(checkArithmetic(po)).toEqual([
      { check: 'line_total_indivisible', field: 'lines[0]', detail: expect.stringContaining('quantity 3') },
    ])
  })

  it('compares in cents, so float noise (0.003 × 60) is not a failure', () => {
    const po = makePo({
      statedTotal: { value: null, quote: '' },
      lines: [otherLine({ quantity: 60, unitPrice: 0.003, lineTotal: 0.18 })],
    })
    expect(checkArithmetic(po)).toEqual([])
  })
})
