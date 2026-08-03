import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import {
  computeDeltaPercent,
  getDashboardStats,
  getLeadsFollowUp,
  getNeedToContactList,
  getOpenOrdersForDashboard,
  getRevenueTrendData,
} from '../dashboard'
import { DatabaseError } from '@/lib/errors'

const dialect = new PgDialect()

function compiledCall(index: number): { sql: string; params: unknown[] } {
  const sqlArg = mockExecute.mock.calls[index]?.[0] as SQL | undefined
  if (!sqlArg) throw new Error(`db.execute call #${index} not found`)
  return dialect.sqlToQuery(sqlArg)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  // 2026-04-15T12:00:00Z — mid-April of the fixture year.
  vi.setSystemTime(new Date('2026-04-15T12:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('computeDeltaPercent', () => {
  it('returns the signed percent change when prior is non-zero', () => {
    expect(computeDeltaPercent(150, 100)).toBeCloseTo(50)
    expect(computeDeltaPercent(80, 100)).toBeCloseTo(-20)
  })

  it('returns null when prior is zero so callers can render an em-dash safely', () => {
    expect(computeDeltaPercent(500, 0)).toBeNull()
    expect(computeDeltaPercent(0, 0)).toBeNull()
  })
})

describe('getDashboardStats', () => {
  it('monthly: scopes the revenue sum to the current calendar month and prior to the previous month', async () => {
    mockExecute
      .mockResolvedValueOnce([{ total: '8500.00' }]) // current month sum
      .mockResolvedValueOnce([{ total: '5000.00' }]) // prior month sum
      .mockResolvedValueOnce([{ open_count: 7, completed_in_period_count: 3 }])

    const stats = await getDashboardStats('monthly')

    expect(stats).toMatchObject({
      period: 'monthly',
      totalRevenue: 8500,
      priorPeriodRevenue: 5000,
      openCount: 7,
      completedInPeriodCount: 3,
    })
    expect(stats.deltaPercent).toBeCloseTo(70)

    // Month-window params: April 2026 current, March 2026 prior.
    const currentQuery = compiledCall(0)
    expect(currentQuery.params).toContain('2026-04-01')
    expect(currentQuery.params).toContain('2026-04-30')
    const priorQuery = compiledCall(1)
    expect(priorQuery.params).toContain('2026-03-01')
    expect(priorQuery.params).toContain('2026-03-31')
  })

  it('sums orders.price, excludes cancelled orders, and buckets by COALESCE(production, requested-delivery, created) date', async () => {
    mockExecute
      .mockResolvedValueOnce([{ total: '8500.00' }])
      .mockResolvedValueOnce([{ total: '5000.00' }])
      .mockResolvedValueOnce([])

    await getDashboardStats('monthly')

    const compiled = compiledCall(0)
    expect(compiled.sql).toMatch(/COALESCE\(SUM\(price\),\s*0\)/i)
    expect(compiled.sql).toMatch(/FROM orders/i)
    expect(compiled.sql).toMatch(/status\s*<>\s*'cancelled'/i)
    expect(compiled.sql).toMatch(
      /COALESCE\(production_date,\s*requested_delivery_date,\s*created_at::date\)\s*>=/i,
    )
    expect(compiled.sql).toMatch(
      /COALESCE\(production_date,\s*requested_delivery_date,\s*created_at::date\)\s*<=/i,
    )
  })

  it('yearly: scopes the revenue sum to the current calendar year and prior to the previous year', async () => {
    mockExecute
      .mockResolvedValueOnce([{ total: '120000.00' }])
      .mockResolvedValueOnce([{ total: '100000.00' }])
      .mockResolvedValueOnce([])

    const stats = await getDashboardStats('yearly')

    expect(stats.period).toBe('yearly')
    expect(stats.totalRevenue).toBe(120000)
    expect(stats.priorPeriodRevenue).toBe(100000)
    expect(stats.deltaPercent).toBeCloseTo(20)

    const currentQuery = compiledCall(0)
    expect(currentQuery.params).toContain('2026-01-01')
    expect(currentQuery.params).toContain('2026-12-31')
    const priorQuery = compiledCall(1)
    expect(priorQuery.params).toContain('2025-01-01')
    expect(priorQuery.params).toContain('2025-12-31')
  })

  it('returns deltaPercent = null (not NaN) when the prior period had zero revenue', async () => {
    mockExecute
      .mockResolvedValueOnce([{ total: '4200.00' }])
      .mockResolvedValueOnce([{ total: '0' }])
      .mockResolvedValueOnce([])

    const stats = await getDashboardStats('monthly')

    expect(stats.totalRevenue).toBe(4200)
    expect(stats.priorPeriodRevenue).toBe(0)
    expect(stats.deltaPercent).toBeNull()
    expect(stats.openCount).toBe(0)
    expect(stats.completedInPeriodCount).toBe(0)
  })

  it('throws a DatabaseError when any underlying query fails', async () => {
    mockExecute.mockRejectedValueOnce(new Error('connection lost'))

    await expect(getDashboardStats('monthly')).rejects.toBeInstanceOf(DatabaseError)
  })
})

describe('getNeedToContactList', () => {
  it('passes the default limit of 5 as a parameter and returns the mapped rows', async () => {
    const fixtureRows = [
      { id: '11111111-1111-1111-1111-111111111111', company_name: 'Acme Industrial', overdue_days: 14 },
      { id: '22222222-2222-2222-2222-222222222222', company_name: 'Beta Logistics', overdue_days: 3 },
    ]
    mockExecute.mockResolvedValueOnce(fixtureRows)

    const result = await getNeedToContactList()

    expect(result).toEqual(fixtureRows)
    const compiled = compiledCall(0)
    expect(compiled.params).toContain(5)
  })

  it('applies a caller-supplied limit to the SQL query', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getNeedToContactList(10)
    const compiled = compiledCall(0)
    expect(compiled.params).toContain(10)
  })

  it('filters to active customers only and uses COALESCE(manual_override, auto_freq) for effective frequency', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getNeedToContactList()
    const compiled = compiledCall(0)
    expect(compiled.sql).toMatch(/c\.status\s*=\s*'active'/i)
    expect(compiled.sql).toMatch(/COALESCE\(c\.contact_frequency_days::numeric,\s*af\.avg_freq_days\)/i)
  })

  it('sorts results by overdue_days DESC so the most overdue customer is first', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getNeedToContactList()
    const compiled = compiledCall(0)
    expect(compiled.sql).toMatch(/ORDER BY\s+overdue_days\s+DESC/i)
  })

  it('excludes customers with a scheduled order — a booked order means no contact needed (Task 74)', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getNeedToContactList()
    const compiled = compiledCall(0)
    expect(compiled.sql).toMatch(/bool_or\(o\.status\s*=\s*'scheduled'\)\s+AS\s+has_scheduled_order/i)
    expect(compiled.sql).toMatch(/os\.has_scheduled_order\s+IS NOT TRUE/i)
  })

  it('returns an empty array when no customers qualify (not an error)', async () => {
    mockExecute.mockResolvedValueOnce([])
    const result = await getNeedToContactList()
    expect(result).toEqual([])
  })

  it('throws a DatabaseError when the underlying query fails', async () => {
    mockExecute.mockRejectedValueOnce(new Error('connection lost'))
    await expect(getNeedToContactList()).rejects.toBeInstanceOf(DatabaseError)
  })
})

describe('getOpenOrdersForDashboard', () => {
  it('returns the mapped rows and passes the default limit of 5', async () => {
    const fixtureRows = [
      {
        id: 'o1',
        po_number: 'PO-0001',
        customer_name: 'Acme',
        qty_275_recon: 0,
        qty_275_rebot: 20,
        qty_275_new: 0,
        qty_330_recon: 0,
        qty_330_rebot: 0,
        qty_330_new: 12,
        requested_delivery_date: '2026-04-30',
        backhaul: true,
      },
    ]
    mockExecute.mockResolvedValueOnce(fixtureRows)

    const result = await getOpenOrdersForDashboard()
    expect(result).toEqual(fixtureRows)
    expect(compiledCall(0).params).toContain(5)
  })

  it('filters to status scheduled and sorts backhaul orders first, then by requested delivery ASC', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getOpenOrdersForDashboard()
    const compiled = compiledCall(0)
    expect(compiled.sql).toMatch(/o\.status\s*=\s*'scheduled'/i)
    expect(compiled.sql).toMatch(/ORDER BY\s+o\.backhaul\s+DESC,\s*o\.requested_delivery_date\s+ASC/i)
  })

  it('selects all 6 qty columns from the wide-row schema (Feature 9)', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getOpenOrdersForDashboard()
    const compiled = compiledCall(0)
    for (const col of [
      'qty_275_recon', 'qty_275_rebot', 'qty_275_new',
      'qty_330_recon', 'qty_330_rebot', 'qty_330_new',
    ]) {
      expect(compiled.sql, `expected SELECT to include ${col}`).toMatch(new RegExp(`\\b${col}\\b`))
    }
  })

  it('returns an empty array when no orders are open (not an error)', async () => {
    mockExecute.mockResolvedValueOnce([])
    const result = await getOpenOrdersForDashboard()
    expect(result).toEqual([])
  })

  it('throws a DatabaseError when the underlying query fails', async () => {
    mockExecute.mockRejectedValueOnce(new Error('connection lost'))
    await expect(getOpenOrdersForDashboard()).rejects.toBeInstanceOf(DatabaseError)
  })
})

describe('getLeadsFollowUp', () => {
  it('returns the mapped rows and passes the default limit of 5', async () => {
    const fixtureRows = [
      {
        id: 'l1',
        name: 'Alice Smith',
        company: 'Acme',
        next_follow_up_date: '2026-04-15',
        overdue_days: 7,
      },
    ]
    mockExecute.mockResolvedValueOnce(fixtureRows)

    const result = await getLeadsFollowUp()
    expect(result).toEqual(fixtureRows)
    expect(compiledCall(0).params).toContain(5)
  })

  it('filters to next_follow_up_date ≤ CURRENT_DATE and excludes converted leads', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getLeadsFollowUp()
    const compiled = compiledCall(0)
    expect(compiled.sql).toMatch(/next_follow_up_date\s*<=\s*CURRENT_DATE/i)
    expect(compiled.sql).toMatch(/status\s*<>\s*'converted'/i)
    expect(compiled.sql).toMatch(/next_follow_up_date\s+IS NOT NULL/i)
  })

  it('sorts results by next_follow_up_date ASC so the most-overdue lead is first', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getLeadsFollowUp()
    const compiled = compiledCall(0)
    expect(compiled.sql).toMatch(/ORDER BY\s+next_follow_up_date\s+ASC/i)
  })

  it('returns an empty array when no leads qualify (not an error)', async () => {
    mockExecute.mockResolvedValueOnce([])
    const result = await getLeadsFollowUp()
    expect(result).toEqual([])
  })

  it('throws a DatabaseError when the underlying query fails', async () => {
    mockExecute.mockRejectedValueOnce(new Error('connection lost'))
    await expect(getLeadsFollowUp()).rejects.toBeInstanceOf(DatabaseError)
  })
})

describe('getRevenueTrendData', () => {
  it('returns the mapped rows grouped into one bucket per month sorted ASC', async () => {
    const fixtureRows = [
      { billing_month: '2025-11-01', total_amount: '1500.00' },
      { billing_month: '2025-12-01', total_amount: '2100.00' },
      { billing_month: '2026-01-01', total_amount: '3400.00' },
    ]
    mockExecute.mockResolvedValueOnce(fixtureRows)

    const result = await getRevenueTrendData()
    expect(result).toEqual(fixtureRows)
    const compiled = compiledCall(0)
    expect(compiled.sql).toMatch(/GROUP BY\s+billing_month/i)
    expect(compiled.sql).toMatch(/ORDER BY\s+billing_month\s+ASC/i)
  })

  it('sums orders.price, excludes cancelled orders, and buckets by the month of COALESCE(production, requested-delivery, created) date', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getRevenueTrendData()
    const compiled = compiledCall(0)
    expect(compiled.sql).toMatch(/COALESCE\(SUM\(price\),\s*0\)/i)
    expect(compiled.sql).toMatch(/FROM orders/i)
    expect(compiled.sql).toMatch(/status\s*<>\s*'cancelled'/i)
    expect(compiled.sql).toMatch(
      /date_trunc\('month',\s*COALESCE\(production_date,\s*requested_delivery_date,\s*created_at::date\)\)/i,
    )
  })

  it('returns an empty array when no orders exist (not an error)', async () => {
    mockExecute.mockResolvedValueOnce([])
    const result = await getRevenueTrendData()
    expect(result).toEqual([])
  })

  it('throws a DatabaseError when the underlying query fails', async () => {
    mockExecute.mockRejectedValueOnce(new Error('connection lost'))
    await expect(getRevenueTrendData()).rejects.toBeInstanceOf(DatabaseError)
  })
})
