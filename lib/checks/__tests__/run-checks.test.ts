import { describe, expect, it } from 'vitest'
import { CHECK_RESULTS_VERSION } from '../checks.constants'
import { runChecks } from '../run-checks'
import { makePo, SOURCE_TEXT, toteLine } from './fixtures'

describe('runChecks', () => {
  it('returns a versioned result with an empty failures array for a clean PO', () => {
    const results = runChecks(makePo(), SOURCE_TEXT)
    expect(results.version).toBe(CHECK_RESULTS_VERSION)
    expect(results.failures).toEqual([])
    expect(results.quotes.every((quote) => quote.status === 'verified')).toBe(true)
  })

  it('collects failures from every check family', () => {
    const po = makePo({
      customerName: { value: 'Invented Corp', quote: 'Invented Corp' },
      statedTotal: { value: 999, quote: '$1,000.00' },
      dates: [{ value: '2026-03-05', label: 'Date', role: 'order', quote: '03/05/26' }],
      lines: [toteLine({ toteType: 'unknown' })],
    })
    const checks = runChecks(po, SOURCE_TEXT).failures.map((failure) => failure.check)
    expect(checks).toEqual(
      expect.arrayContaining(['quote_not_found', 'total_mismatch', 'ambiguous_date', 'unknown_tote_type'])
    )
  })

  it('keeps failures an array, and no quote failures, for an image', () => {
    const results = runChecks(makePo(), null)
    expect(Array.isArray(results.failures)).toBe(true)
    expect(results.failures).toEqual([])
    expect(results.quotes.every((quote) => quote.status === 'unverifiable')).toBe(true)
  })

  it('round-trips through JSON as the jsonb column will store it', () => {
    const results = runChecks(makePo({ isPurchaseOrder: false }), SOURCE_TEXT)
    expect(JSON.parse(JSON.stringify(results))).toEqual(results)
  })
})
