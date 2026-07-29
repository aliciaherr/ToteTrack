import { describe, it, expect } from 'vitest'
import {
  transformCumulativeAnnual,
  transformCumulativeMonthly,
  transformForMode,
  transformPerPeriodAnnual,
  transformPerPeriodMonthly,
} from '../invoice-chart-transforms'
import type { RevenueTrendRow } from '@/db/queries/dashboard'

// Anchor date for monthly-window tests: 2026-04-15. Rolling 12-month window
// runs from 2025-05-01 through 2026-04-01 inclusive.
const TODAY = new Date('2026-04-15T12:00:00.000Z')

const multiYearData: RevenueTrendRow[] = [
  { billing_month: '2024-06-01', total_amount: '1000.00' },
  { billing_month: '2025-02-01', total_amount: '2500.00' },
  { billing_month: '2025-03-01', total_amount: '3000.00' },
  { billing_month: '2025-12-01', total_amount: '4000.00' },
  { billing_month: '2026-02-01', total_amount: '5500.00' },
  { billing_month: '2026-04-01', total_amount: '7000.00' },
]

describe('transformPerPeriodMonthly', () => {
  it('returns exactly 12 data points for the rolling 12-month window', () => {
    const points = transformPerPeriodMonthly(multiYearData, TODAY)
    expect(points).toHaveLength(12)
  })

  it('anchors to the current month (latest bar is this month)', () => {
    const points = transformPerPeriodMonthly(multiYearData, TODAY)
    expect(points[points.length - 1]!.label).toBe('Apr 26')
    expect(points[points.length - 1]!.value).toBe(7000)
  })

  it('fills months with no invoices as zero so the x-axis stays continuous', () => {
    const points = transformPerPeriodMonthly(multiYearData, TODAY)
    // January 2026 has no invoices in the fixture data → $0.
    const jan26 = points.find((p) => p.label === 'Jan 26')
    expect(jan26?.value).toBe(0)
  })

  it('ignores invoices from months that fall outside the rolling window', () => {
    const points = transformPerPeriodMonthly(multiYearData, TODAY)
    // 2024-06-01 is ~22 months old — outside the 12-month window → excluded.
    const june24 = points.find((p) => p.label === 'Jun 24')
    expect(june24).toBeUndefined()
  })
})

describe('transformCumulativeMonthly', () => {
  it('produces 12 points where each bar is greater than or equal to the previous', () => {
    const points = transformCumulativeMonthly(multiYearData, TODAY)
    expect(points).toHaveLength(12)
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i]!.value).toBeGreaterThanOrEqual(points[i - 1]!.value)
    }
  })

  it('the final cumulative bar equals the sum of per-period monthly values', () => {
    const perPeriod = transformPerPeriodMonthly(multiYearData, TODAY)
    const expectedTotal = perPeriod.reduce((sum, p) => sum + p.value, 0)
    const cumulative = transformCumulativeMonthly(multiYearData, TODAY)
    expect(cumulative[cumulative.length - 1]!.value).toBe(expectedTotal)
  })
})

describe('transformPerPeriodAnnual', () => {
  it('returns one point per year with data, sorted ascending', () => {
    const points = transformPerPeriodAnnual(multiYearData)
    expect(points.map((p) => p.label)).toEqual(['2024', '2025', '2026'])
  })

  it('sums all invoices within each year', () => {
    const points = transformPerPeriodAnnual(multiYearData)
    expect(points.find((p) => p.label === '2024')?.value).toBe(1000)
    expect(points.find((p) => p.label === '2025')?.value).toBe(2500 + 3000 + 4000)
    expect(points.find((p) => p.label === '2026')?.value).toBe(5500 + 7000)
  })

  it('returns an empty array when given no data', () => {
    expect(transformPerPeriodAnnual([])).toEqual([])
  })
})

describe('transformCumulativeAnnual', () => {
  it('each annual cumulative value is greater than or equal to the previous', () => {
    const points = transformCumulativeAnnual(multiYearData)
    for (let i = 1; i < points.length; i += 1) {
      expect(points[i]!.value).toBeGreaterThanOrEqual(points[i - 1]!.value)
    }
  })

  it('final cumulative equals the sum of all invoiced totals', () => {
    const points = transformCumulativeAnnual(multiYearData)
    const total = multiYearData.reduce((sum, row) => sum + Number(row.total_amount), 0)
    expect(points[points.length - 1]!.value).toBe(total)
  })
})

describe('transformForMode', () => {
  it('routes to the correct transform for each ChartMode', () => {
    expect(transformForMode('per_period_monthly', multiYearData, TODAY)).toHaveLength(12)
    expect(transformForMode('cumulative_monthly', multiYearData, TODAY)).toHaveLength(12)
    expect(transformForMode('per_period_annual', multiYearData, TODAY)).toHaveLength(3)
    expect(transformForMode('cumulative_annual', multiYearData, TODAY)).toHaveLength(3)
  })
})
