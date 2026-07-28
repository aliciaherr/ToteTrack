import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import { getProductionWidgetData } from '../production-widget'
import { PRODUCTION_WIDGET_ROWS_PER_DAY } from '../production-widget.constants'
import { DatabaseError } from '@/lib/errors'

const dialect = new PgDialect()

function compiledCall(index: number): { sql: string; params: unknown[] } {
  const sqlArg = mockExecute.mock.calls[index]?.[0] as SQL | undefined
  if (!sqlArg) throw new Error(`db.execute call #${index} not found`)
  return dialect.sqlToQuery(sqlArg)
}

// 2026-07-27 is a Monday; 2026-07-31 the Friday of that week.
const MONDAY = new Date(2026, 6, 27, 12)
const FRIDAY = new Date(2026, 6, 31, 12)

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    po_number: 'PO-1000',
    customer_name: 'Acme Industrial',
    status: 'scheduled',
    backhaul: false,
    same_day_delivery: false,
    production_day: '2026-07-27',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockExecute.mockResolvedValue([])
})

describe('getProductionWidgetData', () => {
  it('queries exactly the two business days as bound parameters', async () => {
    await getProductionWidgetData(MONDAY)

    const { params } = compiledCall(0)
    expect(params).toEqual(['2026-07-27', '2026-07-28'])
  })

  it('on Friday the second parameter is the following Monday', async () => {
    await getProductionWidgetData(FRIDAY)

    expect(compiledCall(0).params).toEqual(['2026-07-31', '2026-08-03'])
  })

  it('reads production_date directly, exactly as the calendar does', async () => {
    await getProductionWidgetData(MONDAY)

    const { sql } = compiledCall(0)
    expect(sql).toContain('o.production_date')
    // No placement rule anywhere — a card's day IS the column (CONSTRAINT-19).
    // A local copy here is precisely how the widget and the calendar would come
    // to disagree about which day an order falls on.
    expect(sql).not.toContain('COALESCE')
    expect(sql).not.toContain('ISODOW')
  })

  it('selects o.status so the widget can dim built rows', async () => {
    await getProductionWidgetData(MONDAY)

    // Anchored to the select list — the `WHERE o.status <> 'cancelled'` filter
    // mentions the column too and would satisfy a bare `toContain`.
    expect(compiledCall(0).sql).toMatch(/select[\s\S]*\bo\.status\b[\s\S]*from\s+orders\s+o/i)
  })

  it('passes each row status through to the grouped rows', async () => {
    mockExecute
      .mockResolvedValueOnce([row({ id: 'built', status: 'invoiced' }), row({ id: 'live' })])
      .mockResolvedValueOnce([{ count: 0 }])

    const data = await getProductionWidgetData(MONDAY)

    expect(data.groups[0].rows.map((r) => r.status)).toEqual(['invoiced', 'scheduled'])
  })

  it('excludes cancelled orders', async () => {
    await getProductionWidgetData(MONDAY)

    expect(compiledCall(0).sql).toContain("o.status <> 'cancelled'")
  })

  it('orders by day, then explicit sequence, then PO number', async () => {
    await getProductionWidgetData(MONDAY)

    const { sql } = compiledCall(0)
    expect(sql).toContain('o.production_sort_index ASC NULLS LAST')
    expect(sql).toContain('o.po_number ASC')
  })

  it('counts an order as unscheduled on production_date alone', async () => {
    await getProductionWidgetData(MONDAY)

    const { sql } = compiledCall(1)
    expect(sql).toContain('o.production_date IS NULL')
    expect(sql).not.toContain('o.requested_delivery_date IS NULL')
  })

  it(`groups rows under their day and caps each group at ${PRODUCTION_WIDGET_ROWS_PER_DAY}`, async () => {
    mockExecute
      .mockResolvedValueOnce([
        row({ id: 'a' }),
        row({ id: 'b' }),
        row({ id: 'c' }),
        row({ id: 'd' }),
        row({ id: 'e' }),
        row({ id: 'f', production_day: '2026-07-28' }),
      ])
      .mockResolvedValueOnce([{ count: 2 }])

    const data = await getProductionWidgetData(MONDAY)

    expect(data.groups).toHaveLength(2)
    expect(data.groups[0]).toMatchObject({ date: '2026-07-27', total: 5 })
    expect(data.groups[0].rows).toHaveLength(PRODUCTION_WIDGET_ROWS_PER_DAY)
    expect(data.groups[0].rows.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(data.groups[1]).toMatchObject({ date: '2026-07-28', total: 1 })
    expect(data.unscheduledCount).toBe(2)
  })

  it('still emits a group for a day with no rows', async () => {
    mockExecute
      .mockResolvedValueOnce([row({ production_day: '2026-07-28' })])
      .mockResolvedValueOnce([{ count: 0 }])

    const data = await getProductionWidgetData(MONDAY)

    expect(data.groups).toHaveLength(2)
    expect(data.groups[0]).toMatchObject({ date: '2026-07-27', rows: [], total: 0 })
  })

  it('defaults the unscheduled count to 0 when the count query returns nothing', async () => {
    mockExecute.mockResolvedValueOnce([]).mockResolvedValueOnce([])

    expect((await getProductionWidgetData(MONDAY)).unscheduledCount).toBe(0)
  })

  it('wraps a query failure in DatabaseError with context', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExecute.mockRejectedValue(new Error('connection reset'))

    await expect(getProductionWidgetData(MONDAY)).rejects.toThrow(DatabaseError)
    expect(consoleError).toHaveBeenCalledWith(
      'getProductionWidgetData: query failed',
      expect.objectContaining({ days: ['2026-07-27', '2026-07-28'] }),
    )
    consoleError.mockRestore()
  })
})
