import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { InvoiceDetail, InvoiceLedgerRow } from '@/db/queries/invoices'

const mockPush = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
    ...rest
  }: {
    href: string
    children: React.ReactNode
    className?: string
    [key: string]: unknown
  }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}))

import InvoiceLedger from '../InvoiceLedger'

const INVOICE_ID = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
const SECOND_INVOICE_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'

function makeLedgerRow(overrides: Partial<InvoiceLedgerRow> = {}): InvoiceLedgerRow {
  return {
    id: INVOICE_ID,
    invoice_number: 'INV-0001',
    billing_month: '2026-04-01',
    total_amount: '375.50',
    ...overrides,
  }
}

function makeDetail(overrides: Partial<InvoiceDetail> = {}): InvoiceDetail {
  return {
    id: INVOICE_ID,
    invoice_number: 'INV-0001',
    billing_month: '2026-04-01',
    total_amount: '375.50',
    created_at: '2026-04-21T12:00:00Z',
    po_rows: [
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        po_number: 'PO-3001',
        qty_275_recon: 0,
        qty_275_rebot: 10,
        qty_275_new: 0,
        qty_330_recon: 0,
        qty_330_rebot: 0,
        qty_330_new: 0,
        price: '250.00',
        customer_name: 'Acme Industrial',
        backhaul: true,
      },
      {
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        po_number: 'PO-3002',
        qty_275_recon: 0,
        qty_275_rebot: 0,
        qty_275_new: 0,
        qty_330_recon: 5,
        qty_330_rebot: 0,
        qty_330_new: 0,
        price: '125.50',
        customer_name: 'Beta Logistics',
        backhaul: false,
      },
    ],
    ...overrides,
  }
}

const BASE_PROPS = {
  invoices: [] as InvoiceLedgerRow[],
  selectedInvoiceId: null,
  detail: null,
  billingMonth: '2026-04',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('InvoiceLedger — list mode', () => {
  it('renders "No invoices generated yet." when the ledger is empty', () => {
    render(<InvoiceLedger {...BASE_PROPS} />)
    expect(screen.getByText(/no invoices generated yet/i)).toBeInTheDocument()
  })

  it('renders each invoice row with the invoice number, period, and amount (no customer/status columns)', () => {
    const invoices = [
      makeLedgerRow({ id: INVOICE_ID, invoice_number: 'INV-0001' }),
      makeLedgerRow({
        id: SECOND_INVOICE_ID,
        invoice_number: 'INV-0002',
        total_amount: '1000.00',
        billing_month: '2026-03-01',
      }),
    ]
    render(<InvoiceLedger {...BASE_PROPS} invoices={invoices} />)

    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('INV-0001')).toBeInTheDocument()
    expect(within(rows[0]).getByText(/april 2026/i)).toBeInTheDocument()
    expect(within(rows[0]).getByText('$375.5')).toBeInTheDocument()
    expect(within(rows[1]).getByText('INV-0002')).toBeInTheDocument()
    expect(within(rows[1]).getByText(/march 2026/i)).toBeInTheDocument()
  })

  it('builds row hrefs that preserve billingMonth and append ?id=[invoiceId]', () => {
    const invoices = [makeLedgerRow({ id: INVOICE_ID })]
    render(<InvoiceLedger {...BASE_PROPS} invoices={invoices} billingMonth="2026-04" />)
    const link = screen.getByRole('link', { name: /open invoice inv-0001/i })
    expect(link.getAttribute('href')).toBe(`/invoices?billingMonth=2026-04&id=${INVOICE_ID}`)
  })
})

describe('InvoiceLedger — detail mode', () => {
  it('renders the invoice summary + PO rows + total when an invoice is selected', () => {
    const detail = makeDetail()
    render(
      <InvoiceLedger
        {...BASE_PROPS}
        selectedInvoiceId={INVOICE_ID}
        detail={detail}
      />,
    )
    expect(screen.getByRole('heading', { name: /inv-0001/i })).toBeInTheDocument()
    expect(screen.getByText(/april 2026/i)).toBeInTheDocument()
    expect(screen.getByText('PO-3001')).toBeInTheDocument()
    expect(screen.getByText('PO-3002')).toBeInTheDocument()
    expect(screen.getByText('Acme Industrial')).toBeInTheDocument()
    expect(screen.getByText('Beta Logistics')).toBeInTheDocument()
    expect(screen.getByText('$375.5')).toBeInTheDocument()
  })

  it('renders the "Invoice not found" fallback when selectedInvoiceId is set but detail is null', () => {
    render(
      <InvoiceLedger
        {...BASE_PROPS}
        selectedInvoiceId={INVOICE_ID}
        detail={null}
      />,
    )
    expect(screen.getByText(/invoice not found/i)).toBeInTheDocument()
  })

  it('renders a back link that drops ?id= but preserves billingMonth', () => {
    render(
      <InvoiceLedger
        {...BASE_PROPS}
        selectedInvoiceId={INVOICE_ID}
        detail={makeDetail()}
        billingMonth="2026-04"
      />,
    )
    const back = screen.getByRole('link', { name: /back to ledger/i })
    expect(back.getAttribute('href')).toBe('/invoices?billingMonth=2026-04')
  })
})
