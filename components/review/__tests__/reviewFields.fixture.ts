import { EMPTY_FORM_VALUES } from '@/components/orders/orderFormSchema'
import type { ReviewCustomer, ReviewFields } from '@/lib/review/review-fields.types'

/** Shared test data for the review pane's tests (Task 118). */

export const ACME = '11111111-aaaa-4aaa-8aaa-111111111111'
export const BETA = '22222222-bbbb-4bbb-8bbb-222222222222'
export const GAMMA = '33333333-cccc-4ccc-8ccc-333333333333'

export const CUSTOMERS: ReviewCustomer[] = [
  { id: ACME, company_name: 'Acme Chemicals', status: 'active', addresses: [{ id: 'a1a1a1a1-0000-4000-8000-000000000001', address: '1 Acme Way' }] },
  { id: BETA, company_name: 'Beta Labs', status: 'inactive', addresses: [{ id: 'b1b1b1b1-0000-4000-8000-000000000001', address: '9 Beta Road' }] },
  { id: GAMMA, company_name: 'Gamma Inc', status: 'active', addresses: [] },
]

/** A PO with a certain PO number, two candidate customers, no ship-to and a total mismatch. */
export function reviewFields(overrides: Partial<ReviewFields> = {}): ReviewFields {
  return {
    values: {
      ...EMPTY_FORM_VALUES,
      po_number: 'PO-4471',
      requested_delivery_date: '',
      qty_275_recon: 10,
      unit_price_275_recon: '100.00',
    },
    flags: [
      { field: 'customer_id', kind: 'ambiguous_customer', message: 'Customer not certain: choose one', detail: '' },
      { field: 'delivery_address', kind: 'missing_ship_to', message: 'No delivery address on the PO', detail: '' },
      { field: 'totals', kind: 'total_mismatch', message: "The document's total doesn't match qty × price", detail: 'stated 1100.00, lines 1000.00' },
    ],
    quotes: [
      { field: 'po_number', path: 'poNumberCandidates[0]', quote: 'PO# PO-4471', status: 'verified' },
      { field: 'qty_275_recon', path: 'lines[0]', quote: '<b>10</b> x 275 recon', status: 'not_found' },
    ],
    poNumberOptions: [],
    deliveryDateOptions: [
      { value: '2026-11-02', label: 'Ship by', path: 'dates[0]' },
      { value: '2026-11-09', label: 'Deliver by', path: 'dates[1]' },
    ],
    customerChoices: [
      { customerId: ACME, companyName: 'Acme Chemicals', status: 'active', addressMatched: false },
      { customerId: BETA, companyName: 'Beta Labs', status: 'inactive', addressMatched: true },
    ],
    totals: { stated: 1100, computed: 1000, otherLines: [{ quote: 'Freight', amount: 100 }] },
    ...overrides,
  }
}
