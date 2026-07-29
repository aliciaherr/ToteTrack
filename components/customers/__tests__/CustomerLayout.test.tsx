import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('../CustomerList', () => ({
  default: () => <div data-testid="customer-list" />,
}))

vi.mock('../CustomerDetail', () => ({
  default: () => <div data-testid="customer-detail" />,
  CustomerDetailEmptyState: () => <div data-testid="customer-detail-empty" />,
}))

vi.mock('../CustomerForm', () => ({
  default: ({ mode }: { mode: 'create' | 'edit' }) => (
    <div data-testid={`customer-form-${mode}`} />
  ),
}))

vi.mock('@/components/shell/DetailDrawer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import CustomerLayout from '../CustomerLayout'
import type { CustomerDetail } from '@/db/queries/customers'
import type { VolumeOverview } from '@/db/queries/customers.volume'

// Inlined to avoid value-importing from `db/queries/*` in client tests
// (Platform-Native Rule in docs/architecture.md — value imports drag in the
// `postgres` driver, which throws on missing DATABASE_URL in jsdom).
const EMPTY_VOLUME_OVERVIEW: VolumeOverview = {
  gal275: { rebottled: 0, reconditioned: 0, brandNew: 0, totalAvg: 0 },
  gal330: { rebottled: 0, reconditioned: 0, brandNew: 0, totalAvg: 0 },
}

const baseProps = {
  customers: [],
  selectedId: null,
  status: 'active' as const,
  search: '',
  sort: 'alphabetical' as const,
  detail: null,
  orders: [],
  window: '1M' as const,
  volumeOverview: EMPTY_VOLUME_OVERVIEW,
}

const sampleDetail: CustomerDetail = {
  id: '11111111-1111-1111-1111-111111111111',
  company_name: 'Acme',
  status: 'active',
  contact_frequency_days: null,
  auto_calculated_frequency_days: null,
  effective_frequency_days: null,
  notes: null,
  addresses: [],
  contacts: [],
  last_completed_date: null,
  completed_order_count: 0,
  overdue_days: null,
}

describe('CustomerLayout — ?new=1 deep-link', () => {
  it('renders the empty-state detail panel by default (no initialMode)', () => {
    render(<CustomerLayout {...baseProps} />)

    expect(screen.getByTestId('customer-detail-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('customer-form-create')).not.toBeInTheDocument()
  })

  it('opens the New Customer form on mount when initialMode="new-customer"', () => {
    render(<CustomerLayout {...baseProps} initialMode="new-customer" />)

    expect(screen.getByTestId('customer-form-create')).toBeInTheDocument()
    expect(screen.queryByTestId('customer-detail')).not.toBeInTheDocument()
  })

  it('?new=1 takes precedence over ?id (form shown even when detail is populated)', () => {
    render(
      <CustomerLayout
        {...baseProps}
        initialMode="new-customer"
        selectedId={sampleDetail.id}
        detail={sampleDetail}
      />,
    )

    expect(screen.getByTestId('customer-form-create')).toBeInTheDocument()
    expect(screen.queryByTestId('customer-detail')).not.toBeInTheDocument()
  })
})
