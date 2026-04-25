import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// OrderPagination imports ORDERS_PAGE_SIZE (a runtime value) from
// @/db/queries/orders, which transitively pulls in @/db — and @/db throws at
// module load when DATABASE_URL is unset. Mocking @/db short-circuits that
// chain the same way the query tests do, so the component tree can render
// without a real database.
vi.mock('@/db', () => ({ db: { execute: vi.fn() } }))

import OrderTable from '../OrderTable'
import type { OrderTableRow } from '@/db/queries/orders'

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
  useRouter: () => ({ push: vi.fn() }),
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
    backhaul: false,
    ...overrides,
  }
}

describe('OrderTable', () => {
  it('renders the empty state when no orders exist and no filter is active', () => {
    render(
      <OrderTable
        orders={[]}
        totalCount={0}
        totalPages={1}
        currentPage={1}
        status="all"
        selectedId={null}
        onNewOrder={vi.fn()}
      />,
    )
    expect(screen.getByText(/no orders yet/i)).toBeInTheDocument()
  })

  it('renders a filter-specific empty message when no orders match the active status', () => {
    render(
      <OrderTable
        orders={[]}
        totalCount={0}
        totalPages={1}
        currentPage={1}
        status="scheduled"
        selectedId={null}
        onNewOrder={vi.fn()}
      />,
    )
    expect(screen.getByText(/no orders match this filter/i)).toBeInTheDocument()
  })

  it('renders a Next page link when there is more than one page of results', () => {
    const orders = Array.from({ length: 20 }, (_, index) => makeOrder(index))
    render(
      <OrderTable
        orders={orders}
        totalCount={25}
        totalPages={2}
        currentPage={1}
        status="all"
        selectedId={null}
        onNewOrder={vi.fn()}
      />,
    )
    const nextLink = screen.getByRole('link', { name: /next page/i })
    expect(nextLink).toHaveAttribute('href', '/orders?page=2')
  })

  it('does not render a Next page link when there is only one page of results', () => {
    const orders = Array.from({ length: 5 }, (_, index) => makeOrder(index))
    render(
      <OrderTable
        orders={orders}
        totalCount={5}
        totalPages={1}
        currentPage={1}
        status="all"
        selectedId={null}
        onNewOrder={vi.fn()}
      />,
    )
    expect(screen.queryByRole('link', { name: /next page/i })).not.toBeInTheDocument()
  })

  it('renders a row for each order with the PO number visible', () => {
    const orders = [
      makeOrder(0, { po_number: 'PO-1000' }),
      makeOrder(1, { po_number: 'PO-1001' }),
    ]
    render(
      <OrderTable
        orders={orders}
        totalCount={2}
        totalPages={1}
        currentPage={1}
        status="all"
        selectedId={null}
        onNewOrder={vi.fn()}
      />,
    )
    expect(screen.getByText('PO-1000')).toBeInTheDocument()
    expect(screen.getByText('PO-1001')).toBeInTheDocument()
  })

  it('renders the new column headers in order: PO, Customer, 275, 330, Status, Req Date, Price', () => {
    const orders = [makeOrder(0)]
    render(
      <OrderTable
        orders={orders}
        totalCount={1}
        totalPages={1}
        currentPage={1}
        status="all"
        selectedId={null}
        onNewOrder={vi.fn()}
      />,
    )
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent?.trim())
    expect(headers).toEqual([
      'PO #',
      'Customer',
      '275',
      '330',
      'Status',
      'Req. Date',
      'Price',
      'Backhaul',
    ])
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
    render(
      <OrderTable
        orders={orders}
        totalCount={1}
        totalPages={1}
        currentPage={1}
        status="all"
        selectedId={null}
        onNewOrder={vi.fn()}
      />,
    )
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
    render(
      <OrderTable
        orders={orders}
        totalCount={1}
        totalPages={1}
        currentPage={1}
        status="all"
        selectedId={null}
        onNewOrder={vi.fn()}
      />,
    )
    const row = screen.getByRole('row', { name: /PO-275-ONLY/i })
    expect(within(row).getByText('10')).toBeInTheDocument()
    expect(within(row).getByText('—')).toBeInTheDocument()
  })

  it('renders the BackhaulTag only on rows flagged backhaul=true', () => {
    const orders = [
      makeOrder(0, { po_number: 'PO-BACK', backhaul: true }),
      makeOrder(1, { po_number: 'PO-NORM', backhaul: false }),
    ]
    render(
      <OrderTable
        orders={orders}
        totalCount={2}
        totalPages={1}
        currentPage={1}
        status="all"
        selectedId={null}
        onNewOrder={vi.fn()}
      />,
    )
    const rowBack = screen.getByRole('row', { name: /PO-BACK/i })
    const rowNorm = screen.getByRole('row', { name: /PO-NORM/i })
    expect(within(rowBack).getByLabelText(/backhaul/i)).toBeInTheDocument()
    expect(within(rowNorm).queryByLabelText(/backhaul/i)).not.toBeInTheDocument()
  })
})
