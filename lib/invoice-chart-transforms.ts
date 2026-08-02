/**
 * Pure transforms that reshape the raw revenue-trend data (one row per
 * `billing_month` revenue bucket) into the 4 shapes the dashboard chart
 * renders. Separated
 * from the chart component so each transform has a dedicated unit test and
 * the component file stays well under the CQ-02 200-line component cap.
 */
import { addMonths, format, parseISO, startOfMonth, subMonths } from 'date-fns'
import { DB_DATE_FORMAT } from './dates'
import type { RevenueTrendRow } from '@/db/queries/dashboard'

export type ChartMode =
  | 'per_period_monthly'
  | 'cumulative_monthly'
  | 'per_period_annual'
  | 'cumulative_annual'

export interface ChartPoint {
  label: string
  value: number
}

const ROLLING_MONTH_COUNT = 12

function totalsByBillingMonth(data: RevenueTrendRow[]): Map<string, number> {
  const map = new Map<string, number>()
  data.forEach((row) => {
    map.set(row.billing_month, Number(row.total_amount))
  })
  return map
}

function totalsByYear(data: RevenueTrendRow[]): Map<string, number> {
  const map = new Map<string, number>()
  data.forEach((row) => {
    const year = row.billing_month.slice(0, 4)
    map.set(year, (map.get(year) ?? 0) + Number(row.total_amount))
  })
  return map
}

function rollingMonthKeys(today: Date): string[] {
  const anchor = startOfMonth(today)
  const oldest = subMonths(anchor, ROLLING_MONTH_COUNT - 1)
  const keys: string[] = []
  for (let i = 0; i < ROLLING_MONTH_COUNT; i += 1) {
    keys.push(format(addMonths(oldest, i), DB_DATE_FORMAT))
  }
  return keys
}

/**
 * Per-period monthly: rolling last 12 calendar months. Months with no
 * revenue-dated orders render as $0 bars (present in the series with a zero
 * value so the x-axis timeline stays continuous). Exposed for testing —
 * accepts an explicit `today` to keep the transform pure.
 */
export function transformPerPeriodMonthly(
  data: RevenueTrendRow[],
  today: Date,
): ChartPoint[] {
  const totals = totalsByBillingMonth(data)
  return rollingMonthKeys(today).map((key) => ({
    label: format(parseISO(key), 'MMM yy'),
    value: totals.get(key) ?? 0,
  }))
}

/**
 * Cumulative monthly: same 12-month window as per-period monthly, but each
 * bar is the running total across the window. Each bar is guaranteed to be
 * ≥ the previous (monthly values are non-negative). Running total starts
 * at $0 at the window's oldest month — prior history is not included so the
 * bar heights stay proportionate to the visible window.
 */
export function transformCumulativeMonthly(
  data: RevenueTrendRow[],
  today: Date,
): ChartPoint[] {
  let running = 0
  return transformPerPeriodMonthly(data, today).map(({ label, value }) => {
    running += value
    return { label, value: running }
  })
}

/**
 * Per-period annual: one bar per calendar year that has at least one
 * revenue-dated order. Sorted by year ascending. Years with zero revenue are
 * omitted (unlike the monthly transform, there is no fixed window — the
 * x-axis reflects actual history).
 */
export function transformPerPeriodAnnual(data: RevenueTrendRow[]): ChartPoint[] {
  const totals = totalsByYear(data)
  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([year, value]) => ({ label: year, value }))
}

/**
 * Cumulative annual: running total across years. Each bar is guaranteed to
 * be ≥ the previous. Starts at $0 at the first year with data.
 */
export function transformCumulativeAnnual(data: RevenueTrendRow[]): ChartPoint[] {
  let running = 0
  return transformPerPeriodAnnual(data).map(({ label, value }) => {
    running += value
    return { label, value: running }
  })
}

/**
 * Single entry point — picks the right transform for the given mode.
 * Accepts an explicit `today` so the monthly transforms are deterministic
 * under test.
 */
export function transformForMode(
  mode: ChartMode,
  data: RevenueTrendRow[],
  today: Date,
): ChartPoint[] {
  switch (mode) {
    case 'per_period_monthly':
      return transformPerPeriodMonthly(data, today)
    case 'cumulative_monthly':
      return transformCumulativeMonthly(data, today)
    case 'per_period_annual':
      return transformPerPeriodAnnual(data)
    case 'cumulative_annual':
      return transformCumulativeAnnual(data)
  }
}
