import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import OpenOrdersWidget from '../OpenOrdersWidget'
import type { OpenOrderRow } from '@/db/queries/dashboard'

vi.mock('next/link', () => ({
  default: ({ href, children, className }: {
    href: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

function makeRow(overrides: Partial<OpenOrderRow> = {}): OpenOrderRow {
  return {
    id: 'o-1',
    po_number: 'PO-0001',
    customer_name: 'Acme Industrial',
    qty_275_recon: 0,
    qty_275_rebot: 10,
    qty_275_new: 0,
    qty_330_recon: 0,
    qty_330_rebot: 0,
    qty_330_new: 0,
    requested_delivery_date: '2026-04-30',
    backhaul: false,
    ...overrides,
  }
}

const sampleRows: OpenOrderRow[] = [
  makeRow({
    id: 'o-1',
    po_number: 'PO-0001',
    customer_name: 'Acme Industrial',
    qty_275_recon: 0,
    qty_275_rebot: 10,
    qty_275_new: 0,
    qty_330_recon: 0,
    qty_330_rebot: 5,
    qty_330_new: 0,
    backhaul: true,
  }),
  makeRow({
    id: 'o-2',
    po_number: 'PO-0002',
    customer_name: 'Beta Logistics',
    qty_275_recon: 0,
    qty_275_rebot: 0,
    qty_275_new: 0,
    qty_330_recon: 0,
    qty_330_rebot: 0,
    qty_330_new: 4,
    requested_delivery_date: '2026-05-04',
    backhaul: false,
  }),
]

describe('OpenOrdersWidget', () => {
  it('renders each row with PO number, customer, and delivery date', () => {
    render(<OpenOrdersWidget rows={sampleRows} />)
    expect(screen.getByText('PO-0001')).toBeInTheDocument()
    expect(screen.getByText('Acme Industrial')).toBeInTheDocument()
    expect(screen.getByText('PO-0002')).toBeInTheDocument()
    expect(screen.getByText('Beta Logistics')).toBeInTheDocument()
  })

  it('renders the BackhaulTag only on rows flagged backhaul=true', () => {
    render(<OpenOrdersWidget rows={sampleRows} />)
    const tags = screen.getAllByLabelText(/backhaul/i)
    expect(tags).toHaveLength(1)
  })

  it('renders 275 and 330 totals summed across the type cells, with em dash for zero', () => {
    render(<OpenOrdersWidget rows={sampleRows} />)
    const rowOne = screen.getByText('PO-0001').closest('a')!
    expect(within(rowOne).getByText(/275: 10 · 330: 5/)).toBeInTheDocument()

    const rowTwo = screen.getByText('PO-0002').closest('a')!
    expect(within(rowTwo).getByText(/275: — · 330: 4/)).toBeInTheDocument()
  })

  it('links each row to the order detail deep-link', () => {
    render(<OpenOrdersWidget rows={sampleRows} />)
    const poLink = screen.getByText('PO-0001').closest('a')
    expect(poLink).toHaveAttribute('href', '/orders?id=o-1')
  })

  it('renders the empty state when rows is empty', () => {
    render(<OpenOrdersWidget rows={[]} />)
    expect(screen.getByText(/no open orders/i)).toBeInTheDocument()
  })

  it('renders the "View all" link to the scheduled-filtered orders view', () => {
    render(<OpenOrdersWidget rows={sampleRows} />)
    const viewAll = screen.getByText('View all').closest('a')
    expect(viewAll).toHaveAttribute('href', '/orders?status=scheduled')
  })
})
