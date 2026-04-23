import { render, screen } from '@testing-library/react'
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
  container_size: '275',
  container_type: 'rebottled',
  quantity: 12,
  price: '300.00',
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
})
