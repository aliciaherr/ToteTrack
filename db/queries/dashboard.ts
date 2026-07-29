import {
  startOfMonth,
  startOfYear,
  endOfMonth,
  endOfYear,
  subMonths,
  subYears,
  format,
} from 'date-fns'
import { db } from '@/db'
import { DatabaseError } from '@/lib/errors'
import { DB_DATE_FORMAT } from '@/lib/dates'
import {
  REVENUE_TREND_QUERY,
  buildLeadsFollowUpQuery,
  buildNeedToContactQuery,
  buildOpenOrdersQuery,
  buildPoHeroCountsQuery,
  revenueSumQuery,
} from './dashboard.sql'

export type DashboardPeriod = 'monthly' | 'yearly'

export interface DashboardStats {
  period: DashboardPeriod
  totalRevenue: number
  priorPeriodRevenue: number
  deltaPercent: number | null
  // Live count of `status='scheduled'` orders. All-time, never period-filtered
  // — reflects the current pipeline regardless of the Monthly/Yearly toggle.
  openCount: number
  // Count of orders that landed (status IN ('completed', 'invoiced')) within
  // the selected period (matched on `requested_delivery_date`).
  completedInPeriodCount: number
}

export interface NeedToContactRow {
  id: string
  company_name: string
  overdue_days: number
}

export interface OpenOrderRow {
  id: string
  po_number: string
  customer_name: string | null
  qty_275_recon: number
  qty_275_rebot: number
  qty_275_new: number
  qty_330_recon: number
  qty_330_rebot: number
  qty_330_new: number
  requested_delivery_date: string | null
  backhaul: boolean
}

export interface LeadFollowUpRow {
  id: string
  name: string
  company: string | null
  next_follow_up_date: string
  overdue_days: number
}

// Field names are the chart-row contract shared with
// `lib/invoice-chart-transforms.ts`: `billing_month` is the first day of the
// revenue month bucket, `total_amount` the summed order prices for it.
export interface RevenueTrendRow {
  billing_month: string
  total_amount: string
}

const DEFAULT_DASHBOARD_WIDGET_LIMIT = 5

interface PeriodWindow {
  currentStart: string
  currentEnd: string
  priorStart: string
  priorEnd: string
}

function computePeriodWindow(period: DashboardPeriod, today: Date): PeriodWindow {
  if (period === 'yearly') {
    return {
      currentStart: format(startOfYear(today), DB_DATE_FORMAT),
      currentEnd: format(endOfYear(today), DB_DATE_FORMAT),
      priorStart: format(startOfYear(subYears(today, 1)), DB_DATE_FORMAT),
      priorEnd: format(endOfYear(subYears(today, 1)), DB_DATE_FORMAT),
    }
  }
  return {
    currentStart: format(startOfMonth(today), DB_DATE_FORMAT),
    currentEnd: format(endOfMonth(today), DB_DATE_FORMAT),
    priorStart: format(startOfMonth(subMonths(today, 1)), DB_DATE_FORMAT),
    priorEnd: format(endOfMonth(subMonths(today, 1)), DB_DATE_FORMAT),
  }
}

/**
 * Safe delta calculator. Returns `null` when `prior` is 0 so the UI can
 * render an em-dash instead of dividing by zero (EH-01 defensive guard).
 */
export function computeDeltaPercent(current: number, prior: number): number | null {
  if (prior === 0) return null
  return ((current - prior) / prior) * 100
}

interface RevenueSumRow {
  total: string | null
}

interface PoHeroCountsRow {
  open_count: number
  completed_in_period_count: number
}

/**
 * Loads the dashboard hero-card stats for a given period. The revenue total
 * and its prior-period counterpart are summed from `orders.price` across all
 * non-cancelled orders (bookings view — scheduled orders count), bucketed by
 * the month of `COALESCE(production_date, requested_delivery_date,
 * created_at)` within the current/prior calendar window. NULL prices
 * contribute 0. `deltaPercent` is derived server-side and is `null` when the
 * prior period had zero revenue.
 *
 * The PO hero card returns two counts:
 *  - `openCount`: live count of scheduled (in-flight) orders. Period-agnostic.
 *  - `completedInPeriodCount`: completed-or-invoiced orders whose
 *    `requested_delivery_date` falls in the selected period.
 *
 * @param period - `'monthly'` (current calendar month) or `'yearly'` (current
 * calendar year). No other values are accepted.
 * @returns Stats object with totals, delta, and pipeline counts.
 * @throws {DatabaseError} when any underlying SQL query fails.
 */
export async function getDashboardStats(period: DashboardPeriod): Promise<DashboardStats> {
  const windows = computePeriodWindow(period, new Date())
  try {
    const [currentSumResult, priorSumResult, poCountsResult] = await Promise.all([
      db.execute(revenueSumQuery(windows.currentStart, windows.currentEnd)),
      db.execute(revenueSumQuery(windows.priorStart, windows.priorEnd)),
      db.execute(buildPoHeroCountsQuery(windows.currentStart, windows.currentEnd)),
    ])
    const totalRevenue = Number((currentSumResult as unknown as RevenueSumRow[])[0]?.total ?? 0)
    const priorPeriodRevenue = Number((priorSumResult as unknown as RevenueSumRow[])[0]?.total ?? 0)
    const counts = (poCountsResult as unknown as PoHeroCountsRow[])[0] ?? {
      open_count: 0,
      completed_in_period_count: 0,
    }
    return {
      period,
      totalRevenue,
      priorPeriodRevenue,
      deltaPercent: computeDeltaPercent(totalRevenue, priorPeriodRevenue),
      openCount: counts.open_count,
      completedInPeriodCount: counts.completed_in_period_count,
    }
  } catch (cause) {
    console.error('getDashboardStats: query failed', {
      operation: 'getDashboardStats',
      period,
      windows,
      cause,
    })
    throw new DatabaseError('getDashboardStats', 'Failed to load dashboard stats', { cause })
  }
}

/**
 * Loads the top-N customers who are overdue for contact. Returns `[]` (not
 * an error) when no customers qualify — the widget renders the "No customers
 * need contact right now." empty state on an empty array. Customers with
 * fewer than 2 completed orders and no manual frequency override are
 * excluded (auto-frequency requires ≥ 2 orders, and without a manual
 * override there is no effective frequency to be overdue against).
 * Inactive customers are excluded regardless of order history.
 *
 * @param limit - Maximum rows to return. Defaults to 5.
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getNeedToContactList(
  limit: number = DEFAULT_DASHBOARD_WIDGET_LIMIT,
): Promise<NeedToContactRow[]> {
  try {
    const result = await db.execute(buildNeedToContactQuery(limit))
    return result as unknown as NeedToContactRow[]
  } catch (cause) {
    console.error('getNeedToContactList: query failed', {
      operation: 'getNeedToContactList',
      limit,
      cause,
    })
    throw new DatabaseError(
      'getNeedToContactList',
      'Failed to load need-to-contact list',
      { cause },
    )
  }
}

/**
 * Loads the top-N open (`status='scheduled'`) orders for the dashboard
 * widget. Backhaul orders are pinned first; ties break by
 * `requested_delivery_date ASC`. Returns `[]` (not an error) when the
 * salesperson has no open orders.
 *
 * @param limit - Maximum rows to return. Defaults to 5.
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getOpenOrdersForDashboard(
  limit: number = DEFAULT_DASHBOARD_WIDGET_LIMIT,
): Promise<OpenOrderRow[]> {
  try {
    const result = await db.execute(buildOpenOrdersQuery(limit))
    return result as unknown as OpenOrderRow[]
  } catch (cause) {
    console.error('getOpenOrdersForDashboard: query failed', {
      operation: 'getOpenOrdersForDashboard',
      limit,
      cause,
    })
    throw new DatabaseError(
      'getOpenOrdersForDashboard',
      'Failed to load open orders',
      { cause },
    )
  }
}

/**
 * Loads the top-N leads whose next-follow-up date has arrived or passed.
 * Sorted ASC so the most-overdue lead is at the top. Returns `[]` when no
 * leads qualify — widget renders the "No leads to follow up on." empty
 * state on an empty array.
 *
 * @param limit - Maximum rows to return. Defaults to 5.
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getLeadsFollowUp(
  limit: number = DEFAULT_DASHBOARD_WIDGET_LIMIT,
): Promise<LeadFollowUpRow[]> {
  try {
    const result = await db.execute(buildLeadsFollowUpQuery(limit))
    return result as unknown as LeadFollowUpRow[]
  } catch (cause) {
    console.error('getLeadsFollowUp: query failed', {
      operation: 'getLeadsFollowUp',
      limit,
      cause,
    })
    throw new DatabaseError('getLeadsFollowUp', 'Failed to load leads follow-up', { cause })
  }
}

/**
 * Loads the revenue trend data for the dashboard chart. Returns one row per
 * month with `total_amount` = sum of `orders.price` across the non-cancelled
 * orders whose `COALESCE(production_date, requested_delivery_date,
 * created_at)` falls in that month (NULL prices contribute 0). Sorted by
 * month ASC so the client-side 4-mode transforms (per-period / cumulative ×
 * monthly / annual) can stream in order. Returns `[]` when no orders exist —
 * the chart renders its empty state.
 *
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getRevenueTrendData(): Promise<RevenueTrendRow[]> {
  try {
    const result = await db.execute(REVENUE_TREND_QUERY)
    return result as unknown as RevenueTrendRow[]
  } catch (cause) {
    console.error('getRevenueTrendData: query failed', {
      operation: 'getRevenueTrendData',
      cause,
    })
    throw new DatabaseError('getRevenueTrendData', 'Failed to load revenue trend data', {
      cause,
    })
  }
}
