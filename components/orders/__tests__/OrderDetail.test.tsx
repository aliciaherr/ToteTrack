import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

// OrderDetail renders OrderStatusActions, which imports updateOrderStatus from
// `@/lib/actions/orders`; that module imports `@/db` at load time and throws
// without DATABASE_URL. Mocking @/db and the actions module short-circuits
// the chain so this suite stays a pure render test.
vi.mock('@/db', () => ({ db: {} }))
vi.mock('@/lib/actions/orders', () => ({
  updateOrderStatus: vi.fn(),
}))
vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: React.ReactNode }) => (
          <div {...rest}>{children}</div>
        ),
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
}))

import OrderDetail from '../OrderDetail'
import type { OrderDetail as OrderDetailType } from '@/db/queries/orders'

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

const baseDetail: OrderDetailType = {
  id: '33333333-3333-3333-3333-333333333333',
  po_number: 'PO-2001',
  customer_id: '44444444-4444-4444-4444-444444444444',
  customer_name: 'Acme Industrial',
  status: 'scheduled',
  qty_275_recon: 5,
  qty_275_rebot: 0,
  qty_275_new: 0,
  qty_330_recon: 0,
  qty_330_rebot: 7,
  qty_330_new: 0,
  price: '300.00',
  unit_price_275_recon: '20.00',
  unit_price_275_rebot: null,
  unit_price_275_new: null,
  unit_price_330_recon: null,
  unit_price_330_rebot: '28.57',
  unit_price_330_new: null,
  pickup_only: false,
  delivery_address: '123 Main Street',
  requested_delivery_date: '2026-05-10',
  backhaul: true,
  document_url: null,
  notes: 'Deliver before noon.',
}

describe('OrderDetail', () => {
  it('renders the empty state when detail is null', () => {
    render(<OrderDetail detail={null} />)
    expect(screen.getByText(/select an order/i)).toBeInTheDocument()
  })

  it('renders PO number, customer link, and key fields when detail is present', () => {
    render(<OrderDetail detail={baseDetail} />)
    expect(
      screen.getByRole('heading', { name: /PO-2001/i }),
    ).toBeInTheDocument()
    const customerLink = screen.getByRole('link', { name: /acme industrial/i })
    expect(customerLink).toHaveAttribute(
      'href',
      `/customers?id=${baseDetail.customer_id}`,
    )
    expect(screen.getByText(/deliver before noon/i)).toBeInTheDocument()
  })

  it('hides the delivery address section when pickup_only is true', () => {
    const pickupDetail: OrderDetailType = {
      ...baseDetail,
      pickup_only: true,
      delivery_address: null,
    }
    render(<OrderDetail detail={pickupDetail} />)
    expect(screen.queryByRole('region', { name: /delivery address/i })).toBeNull()
  })

  it('renders the delivery address section when pickup_only is false', () => {
    render(<OrderDetail detail={baseDetail} />)
    const addressSection = screen.getByRole('region', { name: /delivery address/i })
    expect(addressSection).toBeInTheDocument()
    expect(addressSection).toHaveTextContent('123 Main Street')
  })

  it('renders the 2×3 quantity grid with the actual qty values for a mixed-combo PO', () => {
    render(<OrderDetail detail={baseDetail} />)
    const qtySection = screen.getByRole('region', { name: /quantities/i })
    // Cells now render `qty / $unit` (Task 48), so match against that form.
    expect(within(qtySection).getByText('5 / $20')).toBeInTheDocument()
    expect(within(qtySection).getByText('7 / $28.57')).toBeInTheDocument()
  })

  it('renders a filled qty cell as `qty / $unit` when a unit price is present', () => {
    render(<OrderDetail detail={baseDetail} />)
    const qtySection = screen.getByRole('region', { name: /quantities/i })
    // qty_275_recon = 5 @ unit_price_275_recon = '20.00' -> "5 / $20"
    expect(within(qtySection).getByText('5 / $20')).toBeInTheDocument()
  })

  it('renders an em dash for an empty qty cell regardless of unit prices', () => {
    render(<OrderDetail detail={baseDetail} />)
    const qtySection = screen.getByRole('region', { name: /quantities/i })
    // 4 of 6 combos have qty 0 -> em dash, not `qty / $unit`
    expect(within(qtySection).getAllByText('—').length).toBe(4)
  })

  it('renders an em dash for each empty qty cell in the grid (default showEmptyAsDash)', () => {
    render(<OrderDetail detail={baseDetail} />)
    const qtySection = screen.getByRole('region', { name: /quantities/i })
    // baseDetail has 4 zero cells out of 6
    const dashes = within(qtySection).getAllByText('—')
    expect(dashes.length).toBe(4)
  })

  it('renders the total price prominently inside its own section', () => {
    render(<OrderDetail detail={baseDetail} />)
    const totalSection = screen.getByRole('region', { name: /total price/i })
    expect(within(totalSection).getByText('$300')).toBeInTheDocument()
  })

  it('renders a BackhaulTag in the meta grid when backhaul is true', () => {
    render(<OrderDetail detail={baseDetail} />)
    const metaSection = screen.getByRole('region', { name: /order details/i })
    expect(within(metaSection).getByLabelText(/backhaul/i)).toBeInTheDocument()
  })

  it('renders "No" in place of the BackhaulTag when backhaul is false', () => {
    const noBackhaul: OrderDetailType = { ...baseDetail, backhaul: false }
    render(<OrderDetail detail={noBackhaul} />)
    const metaSection = screen.getByRole('region', { name: /order details/i })
    expect(within(metaSection).queryByLabelText(/backhaul/i)).not.toBeInTheDocument()
    // Backhaul row + Pickup Only row both render "No" when both flags are false
    expect(within(metaSection).getAllByText('No').length).toBe(2)
  })

  it('disables the Edit button when status is invoiced', () => {
    const invoicedDetail: OrderDetailType = { ...baseDetail, status: 'invoiced' }
    render(<OrderDetail detail={invoicedDetail} onEdit={vi.fn()} />)
    const editButton = screen.getByRole('button', { name: /edit order PO-2001/i })
    expect(editButton).toBeDisabled()
    expect(editButton).toHaveAttribute(
      'title',
      expect.stringMatching(/revert.*scheduled/i),
    )
  })

  it('disables the Edit button when status is cancelled', () => {
    const cancelledDetail: OrderDetailType = { ...baseDetail, status: 'cancelled' }
    render(<OrderDetail detail={cancelledDetail} onEdit={vi.fn()} />)
    const editButton = screen.getByRole('button', { name: /edit order PO-2001/i })
    expect(editButton).toBeDisabled()
  })

  it('enables the Edit button when status is scheduled', () => {
    render(<OrderDetail detail={baseDetail} onEdit={vi.fn()} />)
    const editButton = screen.getByRole('button', { name: /edit order PO-2001/i })
    expect(editButton).not.toBeDisabled()
  })

  it('enables the Edit button when status is completed (server still validates)', () => {
    const completedDetail: OrderDetailType = { ...baseDetail, status: 'completed' }
    render(<OrderDetail detail={completedDetail} onEdit={vi.fn()} />)
    const editButton = screen.getByRole('button', { name: /edit order PO-2001/i })
    expect(editButton).not.toBeDisabled()
  })
})
