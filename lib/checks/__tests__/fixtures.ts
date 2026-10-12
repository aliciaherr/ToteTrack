import type { ExtractedLine, ExtractedPo } from '@/lib/extraction/types'

// Every value here is invented: fake company, `.test` addresses. No real PO
// ever enters the test suite.

/** A tote line, valid by default. */
export function toteLine(overrides: Partial<ExtractedLine> = {}): ExtractedLine {
  return {
    kind: 'tote',
    toteType: '275_recon',
    quantity: 10,
    unitPrice: 100,
    lineTotal: 1000,
    quote: '275 RECON TOTE 10 $100.00 $1,000.00',
    ...overrides,
  }
}

/** A non-tote line (fee, accrual, note). */
export function otherLine(overrides: Partial<ExtractedLine> = {}): ExtractedLine {
  return {
    kind: 'other',
    toteType: null,
    quantity: null,
    unitPrice: null,
    lineTotal: null,
    quote: 'DRIVER ASSIST',
    ...overrides,
  }
}

/** A PO that passes every check against `SOURCE_TEXT`. */
export function makePo(overrides: Partial<ExtractedPo> = {}): ExtractedPo {
  return {
    isPurchaseOrder: true,
    poNumberCandidates: [{ value: 'PO-0001', label: 'Purchase Order No.', quote: 'Purchase Order No.: PO-0001' }],
    customerName: { value: 'Example Widgets Co', quote: 'Example Widgets Co' },
    shipToAddress: { value: '1 Test Way, Testville', quote: '1 Test Way, Testville' },
    billToAddress: { value: null, quote: '' },
    dates: [{ value: '2026-01-20', label: 'Need Date', role: 'delivery', quote: '01/20/26' }],
    statedTotal: { value: 1000, quote: '$1,000.00' },
    lines: [toteLine()],
    ...overrides,
  }
}

/** The document text `makePo` was "read" from, as a PDF text layer gives it. */
export const SOURCE_TEXT = [
  [
    'Example Widgets Co',
    'Purchase Order No.: PO-0001',
    'Ship To',
    '1 Test Way, Testville',
    'Need Date 01/20/26',
    '275 RECON TOTE 10 $100.00 $1,000.00',
    'TOTAL $1,000.00',
  ].join('\n'),
]
