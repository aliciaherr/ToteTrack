import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makePo, otherLine, toteLine } from '@/lib/checks/__tests__/fixtures'
import { MAX_QUOTE_CHARS } from '@/lib/checks/checks.constants'
import type { CheckName } from '@/lib/checks/types'
import type { ExtractedPo } from '@/lib/extraction/types'
import { reviewFieldsOf } from '../review-fields'
import type { ReviewCustomer } from '../review-fields.types'
import { REVIEW_FLAG_WORDING } from '../review-fields.wording'

const PO_ID = '22222222-2222-2222-2222-222222222222'
const CUSTOMER_A = '11111111-1111-1111-1111-111111111111'
const CUSTOMER_B = '33333333-3333-3333-3333-333333333333'

function customer(id: string, overrides: Partial<ReviewCustomer> = {}): ReviewCustomer {
  return { id, company_name: `Customer ${id.slice(0, 4)}`, status: 'active', addresses: [], ...overrides }
}

function candidate(customerId: string, addressMatched = false) {
  return { customerId, score: 1, nameScore: 1, nameInAddress: false, addressMatched, status: 'active' }
}

function fieldsFor(extracted: ExtractedPo | null | unknown, checkResults: unknown = null, customers: ReviewCustomer[] = []) {
  return reviewFieldsOf({ id: PO_ID, extracted, check_results: checkResults }, customers)
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('reviewFieldsOf: values', () => {
  it('pre-fills a clean PO: number, date, quantities, unit price, address, customer', () => {
    const match = { prefillCustomerId: CUSTOMER_A, candidates: [candidate(CUSTOMER_A)] }
    const fields = fieldsFor(makePo(), { failures: [], quotes: [], customerMatch: match }, [customer(CUSTOMER_A)])
    expect(fields.values).toMatchObject({
      po_number: 'PO-0001',
      customer_id: CUSTOMER_A,
      requested_delivery_date: '2026-01-20',
      qty_275_recon: 10,
      unit_price_275_recon: '100.00',
      qty_330_new: 0,
      unit_price_330_new: null,
      delivery_address: '1 Test Way, Testville',
      delivery_address_id: null,
      customer_collects: false,
      backhaul: false,
      notes: '',
    })
    expect(fields.flags).toEqual([])
    expect(fields.poNumberOptions).toEqual([])
    expect(fields.customerChoices).toEqual([
      { customerId: CUSTOMER_A, companyName: 'Customer 1111', status: 'active', addressMatched: false },
    ])
    expect(fields.totals).toEqual({ stated: 1000, computed: 1000, otherLines: [] })
  })

  it('offers several PO numbers as labelled options, none pre-filled', () => {
    const po = makePo({
      poNumberCandidates: [
        { value: 'PO-1', label: 'Purchase Order No.', quote: 'PO-1' },
        { value: ' ', label: 'Blank', quote: '' },
        { value: 'END-9', label: 'CUST PO', quote: 'END-9' },
      ],
    })
    const fields = fieldsFor(po)
    expect(fields.values.po_number).toBe('')
    expect(fields.poNumberOptions).toEqual([
      { value: 'PO-1', label: 'Purchase Order No.', path: 'poNumberCandidates[0]' },
      { value: 'END-9', label: 'CUST PO', path: 'poNumberCandidates[2]' },
    ])
  })

  it('pre-fills a PO number printed twice, and drops one too long to save', () => {
    const po = makePo({
      poNumberCandidates: [
        { value: 'PO-1', label: 'PO', quote: 'PO-1' },
        { value: 'PO-1', label: 'Ref', quote: 'PO-1' },
        { value: 'X'.repeat(41), label: 'Ref', quote: '' },
      ],
    })
    const fields = fieldsFor(po)
    expect(fields.values.po_number).toBe('PO-1')
    expect(fields.flags).toEqual([expect.objectContaining({ field: 'po_number', kind: 'value_too_long' })])
  })

  it('offers several delivery dates, then other dates, never order dates', () => {
    const po = makePo({
      dates: [
        { value: '2026-01-01', label: 'Order Date', role: 'order', quote: '01/01/26' },
        { value: '2026-01-20', label: 'Need Date', role: 'delivery', quote: '01/20/26' },
        { value: '2026-01-22', label: 'Ship Date', role: 'delivery', quote: '01/22/26' },
        { value: '2026-01-25', label: 'Expires', role: 'other', quote: '01/25/26' },
        { value: 'soon', label: 'Bad', role: 'delivery', quote: 'soon' },
      ],
    })
    const fields = fieldsFor(po)
    expect(fields.values.requested_delivery_date).toBe('')
    expect(fields.deliveryDateOptions.map((option) => option.label)).toEqual(['Need Date', 'Ship Date', 'Expires'])
  })

  it('does not pre-fill a single delivery date flagged ambiguous', () => {
    const failures = [{ check: 'ambiguous_date', field: 'dates[0]', detail: '3/5 could be either' }]
    const fields = fieldsFor(makePo(), { failures })
    expect(fields.values.requested_delivery_date).toBe('')
    expect(fields.deliveryDateOptions).toHaveLength(1)
    expect(fields.flags).toEqual([expect.objectContaining({ field: 'requested_delivery_date', kind: 'ambiguous_date' })])
  })

  it('leaves a delivery date blank, not today, when the PO has none', () => {
    expect(fieldsFor(makePo({ dates: [] })).values.requested_delivery_date).toBe('')
  })

  it('blanks a type with an out-of-bounds quantity or price, and a type at two prices', () => {
    const po = makePo({
      lines: [
        toteLine({ toteType: '275_recon', quantity: 10_000 }),
        toteLine({ toteType: '330_new', quantity: 5, unitPrice: -1 }),
        toteLine({ toteType: '275_new', quantity: 2, unitPrice: 50 }),
        toteLine({ toteType: '275_new', quantity: 3, unitPrice: 60 }),
      ],
    })
    const fields = fieldsFor(po)
    expect(fields.values).toMatchObject({ qty_275_recon: 0, qty_330_new: 5, unit_price_330_new: null, qty_275_new: 5, unit_price_275_new: null })
    expect(fields.flags.map((flag) => [flag.field, flag.kind])).toEqual([
      ['qty_275_recon', 'quantity_out_of_bounds'],
      ['unit_price_275_new', 'conflicting_unit_price'],
      ['unit_price_330_new', 'unit_price_out_of_bounds'],
    ])
  })

  it('leaves the address blank and flagged when the PO has none, or one too long to save', () => {
    const failures = [{ check: 'missing_ship_to', field: 'shipToAddress', detail: 'no ship-to address found' }]
    const none = fieldsFor(makePo({ shipToAddress: { value: null, quote: '' } }), { failures })
    expect(none.values.delivery_address).toBe('')
    expect(none.flags).toEqual([expect.objectContaining({ field: 'delivery_address', kind: 'missing_ship_to' })])

    const huge = fieldsFor(makePo({ shipToAddress: { value: 'A'.repeat(501), quote: '' } }))
    expect(huge.values.delivery_address).toBe('')
    expect(huge.flags).toEqual([expect.objectContaining({ field: 'delivery_address', kind: 'value_too_long' })])
  })
})

describe('reviewFieldsOf: no usable extraction', () => {
  it('returns empty values for a failed extraction, usable as a manual-entry screen', () => {
    const failures = [{ check: 'extraction_failed', field: 'document', detail: 'model unavailable' }]
    const fields = fieldsFor(null, { failures })
    expect(fields.values.po_number).toBe('')
    expect(fields.values.requested_delivery_date).toBe('')
    expect(fields.flags).toEqual([
      { field: 'general', kind: 'extraction_failed', message: REVIEW_FLAG_WORDING.extraction_failed, detail: 'model unavailable' },
    ])
    expect(fields.totals).toEqual({ stated: null, computed: 0, otherLines: [] })
  })

  it('treats an extraction that no longer fits the schema as none, flags it and logs only the id', () => {
    const fields = fieldsFor({ isPurchaseOrder: 'yes' })
    expect(fields.values.po_number).toBe('')
    expect(fields.flags).toEqual([expect.objectContaining({ field: 'general', kind: 'extraction_unreadable' })])
    expect(console.error).toHaveBeenCalledWith('reviewFieldsOf: stored extraction fails the schema', {
      poId: PO_ID,
      issueCount: expect.any(Number),
    })
  })

  it('ignores malformed check_results parts and ingest_limit entries', () => {
    const results = { failures: [{ check: 'ingest_limit', reason: 'unparseable' }, 'junk'], quotes: 'x', customerMatch: 7 }
    const fields = fieldsFor(makePo(), results)
    expect(fields.flags).toEqual([])
    expect(fields.quotes).toEqual([])
  })
})

describe('reviewFieldsOf: customers', () => {
  it('drops a matched customer that no longer exists and never pre-fills it', () => {
    const match = { prefillCustomerId: CUSTOMER_A, candidates: [candidate(CUSTOMER_A), candidate(CUSTOMER_B, true)] }
    const fields = fieldsFor(makePo(), { customerMatch: match }, [customer(CUSTOMER_B, { status: 'inactive' })])
    expect(fields.values.customer_id).toBe('')
    expect(fields.customerChoices).toEqual([
      { customerId: CUSTOMER_B, companyName: 'Customer 3333', status: 'inactive', addressMatched: true },
    ])
    expect(fields.flags).toEqual([
      expect.objectContaining({ field: 'customer_id', kind: 'customer_no_longer_exists', detail: '1 matched customer(s) no longer exist' }),
    ])
  })
})

describe('reviewFieldsOf: flags and quotes', () => {
  it('puts each stored failure on its field, unknown checks in general', () => {
    const failures = [
      { check: 'quote_not_found', field: 'lines[0]', detail: 'quoted text is not in the document' },
      { check: 'total_mismatch', field: 'statedTotal', detail: 'gap $5.00' },
      { check: 'ambiguous_customer', field: 'customerName', detail: '2 possible' },
      { check: 'brand_new_check', field: 'x', detail: 'y' },
    ]
    const fields = fieldsFor(makePo(), { failures })
    expect(fields.flags.map((flag) => [flag.field, flag.kind])).toEqual([
      ['qty_275_recon', 'quote_not_found'],
      ['totals', 'total_mismatch'],
      ['customer_id', 'ambiguous_customer'],
      ['general', 'unknown_check'],
    ])
    expect(fields.flags[3].detail).toBe('brand_new_check: y')
  })

  it('returns each quote with its field and status, capped, as plain text', () => {
    const long = 'Q'.repeat(MAX_QUOTE_CHARS + 10)
    const po = makePo({ lines: [toteLine({ quote: long })], customerName: { value: 'X', quote: '<b>X</b>' } })
    const quotes = [
      { field: 'lines[0]', status: 'verified' },
      { field: 'customerName', status: 'not_found' },
      { field: 'dates[9]', status: 'verified' },
    ]
    const fields = fieldsFor(po, { quotes })
    expect(fields.quotes).toEqual([
      { field: 'qty_275_recon', path: 'lines[0]', quote: `${'Q'.repeat(MAX_QUOTE_CHARS)}…`, status: 'verified' },
      { field: 'customer_id', path: 'customerName', quote: '<b>X</b>', status: 'not_found' },
    ])
  })

  it('lists other money lines for the arithmetic', () => {
    const fields = fieldsFor(makePo({ lines: [toteLine(), otherLine({ quote: 'FREIGHT', lineTotal: 75 })] }))
    expect(fields.totals.otherLines).toEqual([{ quote: 'FREIGHT', amount: 75 }])
  })

  it('has wording for every check name', () => {
    const names: CheckName[] = ['quote_not_found', 'extraction_failed', 'ambiguous_customer']
    for (const name of names) expect(REVIEW_FLAG_WORDING[name]).toMatch(/\w/)
    expect(Object.values(REVIEW_FLAG_WORDING).every((text) => text.trim().length > 0)).toBe(true)
  })
})
