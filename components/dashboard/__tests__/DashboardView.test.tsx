import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DashboardView from '../DashboardView'
import type { DashboardStats } from '@/db/queries/dashboard'

const mockPush = vi.hoisted(() => vi.fn())
const mockSearchParams = vi.hoisted(() => ({ value: new URLSearchParams() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => mockSearchParams.value,
}))

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, layoutId, transition, ...rest }: any) => (
          <span data-layout-id={layoutId} {...rest}>
            {children}
          </span>
        ),
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}))

function baseStats(overrides: Partial<DashboardStats> = {}): DashboardStats {
  return {
    period: 'monthly',
    totalRevenue: 12500,
    priorPeriodRevenue: 10000,
    deltaPercent: 25,
    openCount: 4,
    completedInPeriodCount: 9,
    ...overrides,
  }
}

// Feature 11 widget — every existing case renders it empty; its own behaviour
// is covered in ProductionWidget.test.tsx.
const emptyProduction = { groups: [], unscheduledCount: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  mockSearchParams.value = new URLSearchParams()
})

describe('DashboardView', () => {
  it('renders the Command Overview title and the real-time subtitle', () => {
    render(<DashboardView stats={baseStats()} needToContact={[]} openOrders={[]} leadsFollowUp={[]} revenueTrend={[]} production={emptyProduction} />)
    expect(screen.getByRole('heading', { name: /command overview/i })).toBeInTheDocument()
    expect(screen.getByText(/real-time logistics matrix/i)).toBeInTheDocument()
  })

  it('marks Monthly as the selected tab when the period is monthly', () => {
    render(<DashboardView stats={baseStats({ period: 'monthly' })} needToContact={[]} openOrders={[]} leadsFollowUp={[]} revenueTrend={[]} production={emptyProduction} />)
    expect(screen.getByRole('tab', { name: /monthly/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /yearly/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('navigates to ?period=yearly when the Yearly tab is clicked from monthly', () => {
    render(<DashboardView stats={baseStats({ period: 'monthly' })} needToContact={[]} openOrders={[]} leadsFollowUp={[]} revenueTrend={[]} production={emptyProduction} />)
    fireEvent.click(screen.getByRole('tab', { name: /yearly/i }))
    expect(mockPush).toHaveBeenCalledWith('/dashboard?period=yearly')
  })

  it('navigates back to / (no period param) when clicking Monthly from the yearly view', () => {
    mockSearchParams.value = new URLSearchParams('period=yearly')
    render(<DashboardView stats={baseStats({ period: 'yearly' })} needToContact={[]} openOrders={[]} leadsFollowUp={[]} revenueTrend={[]} production={emptyProduction} />)
    fireEvent.click(screen.getByRole('tab', { name: /monthly/i }))
    expect(mockPush).toHaveBeenCalledWith('/dashboard')
  })

  it('does not navigate when the already-active tab is clicked', () => {
    render(<DashboardView stats={baseStats({ period: 'monthly' })} needToContact={[]} openOrders={[]} leadsFollowUp={[]} revenueTrend={[]} production={emptyProduction} />)
    fireEvent.click(screen.getByRole('tab', { name: /monthly/i }))
    expect(mockPush).not.toHaveBeenCalled()
  })
})
