import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import RevenueChart from '../RevenueChart'
import type { RevenueTrendRow } from '@/db/queries/dashboard'

const reducedMotionRef = vi.hoisted(() => ({ value: false }))

vi.mock('framer-motion', () => ({
  useReducedMotion: () => reducedMotionRef.value,
  AnimatePresence: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...rest
    }: { children?: React.ReactNode; [k: string]: unknown }) => (
      <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>
    ),
    span: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      ...rest
    }: { children?: React.ReactNode; [k: string]: unknown }) => (
      <span {...(rest as React.HTMLAttributes<HTMLSpanElement>)}>{children}</span>
    ),
  },
}))

// Minimal Recharts mock: renders the bar-series data points as simple spans
// plus a data attribute for animation duration. Keeps the test focused on
// the chart's behavior (mode routing, empty state, reduced-motion handling)
// without booting a full chart renderer in jsdom.
vi.mock('recharts', () => {
  const pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  return {
    ResponsiveContainer: pass,
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    BarChart: ({ data, children }: { data: Array<{ label: string; value: number }>; children: React.ReactNode }) => (
      <div data-testid="bar-chart" data-point-count={data.length}>
        {data.map((point) => (
          <span key={point.label} data-testid="bar-point" data-label={point.label}>
            {point.value}
          </span>
        ))}
        {children}
      </div>
    ),
    Bar: ({ animationDuration }: { animationDuration: number }) => (
      <span data-testid="bar-series" data-animation-duration={animationDuration} />
    ),
  }
})

const emptyData: RevenueTrendRow[] = []

const multiYearData: RevenueTrendRow[] = [
  { billing_month: '2024-06-01', total_amount: '1000.00' },
  { billing_month: '2025-03-01', total_amount: '3000.00' },
  { billing_month: '2026-02-01', total_amount: '5500.00' },
  { billing_month: '2026-04-01', total_amount: '7000.00' },
]

function expandChart() {
  fireEvent.click(screen.getByRole('button', { name: /revenue trend/i }))
}

beforeEach(() => {
  reducedMotionRef.value = false
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('RevenueChart', () => {
  it('is collapsed by default — chart body and pill toggles hidden', () => {
    render(<RevenueChart data={multiYearData} />)
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /annual/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /revenue trend/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('expands when the header button is clicked and collapses on second click', () => {
    render(<RevenueChart data={multiYearData} />)
    const toggle = screen.getByRole('button', { name: /revenue trend/i })
    fireEvent.click(toggle)
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders the empty state when data is empty', () => {
    render(<RevenueChart data={emptyData} />)
    expandChart()
    expect(screen.getByText(/no revenue data yet/i)).toBeInTheDocument()
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument()
  })

  it('renders exactly 12 bars in Per-Period Monthly mode', () => {
    render(<RevenueChart data={multiYearData} />)
    expandChart()
    expect(screen.getByTestId('bar-chart').dataset.pointCount).toBe('12')
  })

  it('switches to Annual mode and renders one bar per year with data', () => {
    render(<RevenueChart data={multiYearData} />)
    expandChart()
    fireEvent.click(screen.getByRole('tab', { name: /annual/i }))
    expect(screen.getByTestId('bar-chart').dataset.pointCount).toBe('3')
  })

  it('cumulative monthly: each bar value is greater than or equal to the previous', () => {
    render(<RevenueChart data={multiYearData} />)
    expandChart()
    fireEvent.click(screen.getByRole('tab', { name: /cumulative/i }))
    const bars = screen.getAllByTestId('bar-point')
    const values = bars.map((el) => Number(el.textContent))
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!)
    }
  })

  it('passes animationDuration=300 to the bar series when motion is enabled', () => {
    render(<RevenueChart data={multiYearData} />)
    expandChart()
    expect(screen.getByTestId('bar-series').dataset.animationDuration).toBe('300')
  })

  it('passes animationDuration=0 to the bar series when useReducedMotion is true', () => {
    reducedMotionRef.value = true
    render(<RevenueChart data={multiYearData} />)
    expandChart()
    expect(screen.getByTestId('bar-series').dataset.animationDuration).toBe('0')
  })
})
