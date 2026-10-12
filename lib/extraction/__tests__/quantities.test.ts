// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { TOTE_TYPES } from '../extraction.constants'
import { toOrderQuantities } from '../extract'
import type { ExtractedLine, ExtractedPo } from '../types'

// extract.ts imports these; mocked so the pure function is tested without the
// native renderer or network module loading.
vi.mock('../render-pdf', () => ({ renderPdfPages: vi.fn() }))
vi.mock('../openrouter', () => ({ callOpenRouter: vi.fn() }))

function tote(toteType: ExtractedLine['toteType'], quantity: number | null, unitPrice: number | null): ExtractedLine {
  return { kind: 'tote', toteType, quantity, unitPrice, lineTotal: null, quote: 'synthetic tote line' }
}

function po(lines: ExtractedLine[]): ExtractedPo {
  return {
    isPurchaseOrder: true,
    poNumberCandidates: [],
    customerName: { value: null, quote: '' },
    shipToAddress: { value: null, quote: '' },
    billToAddress: { value: null, quote: '' },
    dates: [],
    statedTotal: { value: null, quote: '' },
    lines,
  }
}

describe('toOrderQuantities', () => {
  it('puts two types in their own slots and derives price', () => {
    const result = toOrderQuantities(po([tote('275_recon', 10, 95.5), tote('330_new', 4, 210)]))

    expect(result.slots['275_recon']).toEqual({ quantity: 10, unitPrice: 95.5 })
    expect(result.slots['330_new']).toEqual({ quantity: 4, unitPrice: 210 })
    expect(result.price).toBe(1795)
    expect(result.conflicts).toEqual([])
    expect(result.unknownLines).toBe(0)
  })

  it('always returns all six slots, empty ones at quantity 0 and null price', () => {
    const result = toOrderQuantities(po([]))

    expect(Object.keys(result.slots).sort()).toEqual([...TOTE_TYPES].sort())
    for (const type of TOTE_TYPES) expect(result.slots[type]).toEqual({ quantity: 0, unitPrice: null })
    expect(result.price).toBe(0)
  })

  it('sums one type across two lines at the same price', () => {
    const result = toOrderQuantities(po([tote('275_rebot', 6, 120), tote('275_rebot', 4, 120)]))

    expect(result.slots['275_rebot']).toEqual({ quantity: 10, unitPrice: 120 })
    expect(result.price).toBe(1200)
    expect(result.conflicts).toEqual([])
  })

  it('reports one type at two prices as a conflict once, keeping the first price', () => {
    const result = toOrderQuantities(
      po([tote('330_recon', 2, 100), tote('330_recon', 3, 110), tote('330_recon', 1, 120)])
    )

    expect(result.conflicts).toEqual(['330_recon'])
    expect(result.slots['330_recon']).toEqual({ quantity: 6, unitPrice: 100 })
    expect(result.price).toBe(650)
  })

  it('counts unknown and null-typed tote lines without filling any slot', () => {
    const result = toOrderQuantities(po([tote('unknown', 5, 80), tote(null, 2, 80)]))

    expect(result.unknownLines).toBe(2)
    for (const type of TOTE_TYPES) expect(result.slots[type].quantity).toBe(0)
    expect(result.price).toBe(0)
  })

  it('excludes other lines from slots and price', () => {
    const freight: ExtractedLine = {
      kind: 'other',
      toteType: null,
      quantity: 1,
      unitPrice: 250,
      lineTotal: 250,
      quote: 'Freight 250.00',
    }
    const result = toOrderQuantities(po([tote('275_new', 2, 300), freight]))

    expect(result.price).toBe(600)
    expect(result.unknownLines).toBe(0)
  })

  it('rounds the derived price to cents', () => {
    const result = toOrderQuantities(po([tote('275_recon', 3, 0.1), tote('330_rebot', 1, 0.2)]))

    expect(result.price).toBe(0.5)
  })
})
