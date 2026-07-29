import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import CustomerDetail from '../CustomerDetail'
import type {
  CustomerDetail as CustomerDetailType,
  CustomerOrderRow,
  VolumeOverview,
} from '@/db/queries/customers'

const emptyVolume: VolumeOverview = {
  gal275: { rebottled: 0, reconditioned: 0, brandNew: 0, totalAvg: 0 },
  gal330: { rebottled: 0, reconditioned: 0, brandNew: 0, totalAvg: 0 },
}

vi.mock('next/link', () => ({
  default: ({ href, children, className, ...rest }: {
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
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/customers',
  useSearchParams: () => new URLSearchParams(),
}))

// CustomerAddresses (rendered inside CustomerDetail) toasts on successful
// address mutations; the real hook throws without a <ToastProvider>.
vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

// The address actions module value-imports `@/db` (postgres driver), which
// throws on missing DATABASE_URL in jsdom — mock it out (Platform-Native Rule).
vi.mock('@/lib/actions/customer-addresses', () => ({
  addCustomerAddress: vi.fn(),
  updateCustomerAddress: vi.fn(),
  deleteCustomerAddress: vi.fn(),
}))

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => ({ children, ...rest }: { children?: React.ReactNode }) => (
        <div {...rest}>{children}</div>
      ),
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}))

const baseDetail: CustomerDetailType = {
  id: '11111111-1111-1111-1111-111111111111',
  company_name: 'Acme Industrial',
  status: 'active',
  contact_frequency_days: null,
  auto_calculated_frequency_days: 14,
  effective_frequency_days: 14,
  notes: null,
  addresses: [],
  contacts: [
    {
      id: 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      name: 'Jane Doe',
      role: 'Operations Manager',
      email: 'jane@acme.example',
      phone: '555-0100',
      is_primary: true,
    },
  ],
  last_completed_date: '2026-04-01',
  completed_order_count: 4,
  overdue_days: -2,
}

const sampleOrders: CustomerOrderRow[] = [
  {
    id: 'bbbb1111-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    po_number: 'PO-1001',
    status: 'completed',
    qty_275_recon: 0,
    qty_275_rebot: 10,
    qty_275_new: 0,
    qty_330_recon: 0,
    qty_330_rebot: 0,
    qty_330_new: 0,
    price: '250.00',
    requested_delivery_date: '2026-04-01',
    backhaul: false,
  },
]

describe('CustomerDetail', () => {
  it('renders the empty state when detail is null', () => {
    render(
      <CustomerDetail
        detail={null}
        orders={[]}
        window="1M"
        volumeOverview={emptyVolume}
        onEdit={vi.fn()}
      />,
    )
    expect(screen.getByText(/select a customer/i)).toBeInTheDocument()
  })

  it('renders the company name, primary contact, and a "+ New Order" link', () => {
    render(
      <CustomerDetail
        detail={baseDetail}
        orders={sampleOrders}
        window="1M"
        volumeOverview={emptyVolume}
        onEdit={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { name: /acme industrial/i })).toBeInTheDocument()
    expect(screen.getByText(/jane doe/i)).toBeInTheDocument()
    const newOrderLink = screen.getByRole('link', { name: /create new order/i })
    expect(newOrderLink).toHaveAttribute(
      'href',
      '/orders?new=1&customerId=11111111-1111-1111-1111-111111111111',
    )
  })

  it('shows the auto-calculated frequency label when no manual override is set', () => {
    render(
      <CustomerDetail
        detail={baseDetail}
        orders={[]}
        window="1M"
        volumeOverview={emptyVolume}
        onEdit={vi.fn()}
      />,
    )
    expect(screen.getByText(/auto \(14 days avg\)/i)).toBeInTheDocument()
  })

  it('renders the Delivery Addresses section with its empty state', () => {
    render(
      <CustomerDetail
        detail={baseDetail}
        orders={[]}
        window="1M"
        volumeOverview={emptyVolume}
        onEdit={vi.fn()}
      />,
    )
    expect(screen.getByText(/delivery addresses/i)).toBeInTheDocument()
    expect(screen.getByText(/no saved addresses yet/i)).toBeInTheDocument()
  })

  it('shows the "Contact Recommended" overdue banner when overdue_days > 0', () => {
    const overdueDetail = { ...baseDetail, overdue_days: 3 }
    render(
      <CustomerDetail
        detail={overdueDetail}
        orders={[]}
        window="1M"
        volumeOverview={emptyVolume}
        onEdit={vi.fn()}
      />,
    )
    expect(screen.getByText(/contact recommended/i)).toBeInTheDocument()
  })
})
