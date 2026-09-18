import { render, screen, within, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import OrderTable from '../OrderTable'
import type { OrderTableRow } from '@/db/queries/orders'

const mockPush = vi.hoisted(() => vi.fn())

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

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

function makeOrder(index: number, overrides: Partial<OrderTableRow> = {}): OrderTableRow {
  const pad = String(index).padStart(12, '0')
  return {
    id: `00000000-0000-0000-0000-${pad}`,
    po_number: `PO-${1000 + index}`,
    customer_id: '11111111-1111-1111-1111-111111111111',
    customer_name: 'Acme Industrial',
    status: 'scheduled',
    qty_275_recon: 0,
    qty_275_rebot: 10,
    qty_275_new: 0,
    qty_330_recon: 0,
    qty_330_rebot: 0,
    qty_330_new: 0,
    price: '250.00',
    requested_delivery_date: '2026-05-01',
    production_date: '2026-04-28',
    backhaul: false,
    ...overrides,
  }
}

function renderTable(props: Partial<React.ComponentProps<typeof OrderTable>> = {}) {
  return render(
    <OrderTable
      orders={[]}
      status="all"
      search=""
      selectedId={null}
      onNewOrder={vi.fn()}
      {...props}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OrderTable', () => {
  it('renders the empty state when no orders exist and no filter is active', () => {
    renderTable()
    expect(screen.getByText(/no orders yet/i)).toBeInTheDocument()
  })

  it('renders a filter-specific empty message when no orders match the active status', () => {
    renderTable({ status: 'scheduled' })
    expect(screen.getByText(/no orders match this filter/i)).toBeInTheDocument()
  })

  it('renders a search-specific empty message when no orders match the search term', () => {
    renderTable({ status: 'scheduled', search: 'acme' })
    expect(screen.getByText(/no orders match that search/i)).toBeInTheDocument()
  })

  it('renders the search input seeded with the active search term', () => {
    renderTable({ search: 'PO-10' })
    const input = screen.getByLabelText(/search orders/i)
    expect(input).toBeInTheDocument()
    expect(input).toHaveValue('PO-10')
  })

  it('preserves the search term when the status tab is switched', () => {
    renderTable({ search: 'acme' })
    fireEvent.click(screen.getByRole('tab', { name: /completed/i }))
    expect(mockPush).toHaveBeenCalledWith('/orders?status=completed&search=acme')
  })

  it('preserves the search term when a row is selected', () => {
    const order = makeOrder(0, { po_number: 'PO-1000' })
    renderTable({ orders: [order], status: 'scheduled', search: 'acme' })
    fireEvent.click(screen.getByRole('row', { name: /PO-1000/i }))
    expect(mockPush).toHaveBeenCalledWith(
      `/orders?status=scheduled&search=acme&id=${order.id}`,
    )
  })

  it('does not render pagination controls', () => {
    const orders = Array.from({ length: 20 }, (_, index) => makeOrder(index))
    renderTable({ orders })
    expect(screen.queryByRole('link', { name: /next page/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /previous page/i })).not.toBeInTheDocument()
  })

  it('renders a row for each order with the PO number visible', () => {
    const orders = [
      makeOrder(0, { po_number: 'PO-1000' }),
      makeOrder(1, { po_number: 'PO-1001' }),
    ]
    renderTable({ orders })
    expect(screen.getByText('PO-1000')).toBeInTheDocument()
    expect(screen.getByText('PO-1001')).toBeInTheDocument()
  })

  it('renders the column headers in order, delivery promise then build day', () => {
    renderTable({ orders: [makeOrder(0)] })
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent?.trim())
    expect(headers).toEqual([
      'PO #',
      'Customer',
      '275',
      '330',
      'Status',
      'Req. Date',
      'Prod. Date',
      'Price',
      'Backhaul',
    ])
  })

  it('shows the build day, and an em dash when the order has none', () => {
    // The two dates are separate decisions (CONSTRAINT-19) — an order can be
    // promised for a day it has not been scheduled to build on, and the list is
    // where that gap is visible.
    renderTable({
      orders: [
        makeOrder(0, { production_date: '2026-04-28' }),
        makeOrder(1, { production_date: null }),
      ],
    })

    const cells = screen.getAllByTestId('order-row-production-date')
    expect(cells[0]).toHaveTextContent('Apr 28')
    expect(cells[1]).toHaveTextContent('—')
  })

  it('shortens both dates so two date columns fit without widening the table', () => {
    renderTable({
      orders: [makeOrder(0, { requested_delivery_date: '2026-05-01' })],
    })

    expect(screen.getByText('May 1')).toBeInTheDocument()
    expect(screen.queryByText('2026-05-01')).not.toBeInTheDocument()
  })

  it('truncates a long PO number instead of widening the column for every row', () => {
    // One unusually long PO number used to push Customer right on every row —
    // that dead space is what paid for the new column.
    renderTable({ orders: [makeOrder(0, { po_number: 'PO-2026-0412-REVISION-B' })] })

    const cell = screen.getByTitle('PO-2026-0412-REVISION-B')
    expect(cell).toHaveClass('truncate')
    // Clipped visually, never in the accessible name — the row still announces
    // the order in full.
    expect(cell).toHaveTextContent('PO-2026-0412-REVISION-B')
  })

  it('sums 275 and 330 per row across the three type columns', () => {
    const orders = [
      makeOrder(0, {
        po_number: 'PO-MIX',
        qty_275_recon: 5,
        qty_275_rebot: 20,
        qty_275_new: 0,
        qty_330_recon: 0,
        qty_330_rebot: 8,
        qty_330_new: 4,
      }),
    ]
    renderTable({ orders })
    const row = screen.getByRole('row', { name: /PO-MIX/i })
    expect(within(row).getByText('25')).toBeInTheDocument()
    expect(within(row).getByText('12')).toBeInTheDocument()
  })

  it('renders an em dash for a size whose three columns are all zero', () => {
    const orders = [
      makeOrder(0, {
        po_number: 'PO-275-ONLY',
        qty_275_rebot: 10,
        qty_330_recon: 0,
        qty_330_rebot: 0,
        qty_330_new: 0,
      }),
    ]
    renderTable({ orders })
    const row = screen.getByRole('row', { name: /PO-275-ONLY/i })
    expect(within(row).getByText('10')).toBeInTheDocument()
    expect(within(row).getByText('—')).toBeInTheDocument()
  })

  it('renders the BackhaulTag only on rows flagged backhaul=true', () => {
    const orders = [
      makeOrder(0, { po_number: 'PO-BACK', backhaul: true }),
      makeOrder(1, { po_number: 'PO-NORM', backhaul: false }),
    ]
    renderTable({ orders })
    const rowBack = screen.getByRole('row', { name: /PO-BACK/i })
    const rowNorm = screen.getByRole('row', { name: /PO-NORM/i })
    expect(within(rowBack).getByLabelText(/backhaul/i)).toBeInTheDocument()
    expect(within(rowNorm).queryByLabelText(/backhaul/i)).not.toBeInTheDocument()
  })
})
