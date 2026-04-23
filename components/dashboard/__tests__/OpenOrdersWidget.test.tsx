import { render, screen } from '@testing-library/react'
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

const sampleRows: OpenOrderRow[] = [
  {
    id: 'o-1',
    po_number: 'PO-0001',
    customer_name: 'Acme Industrial',
    requested_delivery_date: '2026-04-30',
    backhaul: true,
  },
  {
    id: 'o-2',
    po_number: 'PO-0002',
    customer_name: 'Beta Logistics',
    requested_delivery_date: '2026-05-04',
    backhaul: false,
  },
]

describe('OpenOrdersWidget', () => {
  it('renders each row with PO number, customer, and delivery date', () => {
    render(<OpenOrdersWidget rows={sampleRows} />)
    expect(screen.getByText('PO-0001')).toBeInTheDocument()
    expect(screen.getByText('Acme Industrial')).toBeInTheDocument()
    expect(screen.getByText('PO-0002')).toBeInTheDocument()
    expect(screen.getByText('Beta Logistics')).toBeInTheDocument()
  })

  it('renders a BACKHAUL badge only on rows flagged backhaul=true', () => {
    render(<OpenOrdersWidget rows={sampleRows} />)
    const badges = screen.getAllByText(/backhaul/i)
    expect(badges).toHaveLength(1)
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
