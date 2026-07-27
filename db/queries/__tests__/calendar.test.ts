import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import {
  getCalendarOrders,
  getUnscheduledOrders,
  CALENDAR_WEEKS_BUFFER,
  UNSCHEDULED_DROPDOWN_VISIBLE,
  type CalendarOrderRow,
} from '../calendar'
import { DatabaseError, InvalidDateError } from '@/lib/errors'

const dialect = new PgDialect()

function compileLastCall(): { sql: string; params: unknown[] } {
  const calls = mockExecute.mock.calls
  const sqlArg = calls[calls.length - 1]?.[0] as SQL | undefined
  if (!sqlArg) throw new Error('db.execute was not called')
  return dialect.sqlToQuery(sqlArg)
}

const sampleRow: CalendarOrderRow = {
  id: '11111111-1111-1111-1111-111111111111',
  po_number: 'PO-0030',
  customer_id: '22222222-2222-2222-2222-222222222222',
  customer_name: 'Acme Rebottling',
  status: 'scheduled' as const,
  qty_275_recon: 30,
  qty_275_rebot: 0,
  qty_275_new: 0,
  qty_330_recon: 0,
  qty_330_rebot: 0,
  qty_330_new: 0,
  price: '1650.00',
  unit_price_275_recon: '55.00',
  unit_price_275_rebot: null,
  unit_price_275_new: null,
  unit_price_330_recon: null,
  unit_price_330_rebot: null,
  unit_price_330_new: null,
  backhaul: true,
  notes: null,
  same_day_delivery: false,
  production_date: null,
  requested_delivery_date: '2026-06-01',
  production_sort_index: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getCalendarOrders', () => {
  it('filters on production_date directly, with no derivation', async () => {
    mockExecute.mockResolvedValueOnce([sampleRow])
    await getCalendarOrders({ from: '2026-06-01', to: '2026-06-05' })
    const compiled = compileLastCall()

    expect(compiled.sql).toMatch(/o\.production_date\s*>=/i)
    expect(compiled.sql).toMatch(/o\.production_date\s*<=/i)
  })

  it('contains no placement rule at all — the day IS production_date', async () => {
    mockExecute.mockResolvedValueOnce([sampleRow])
    await getCalendarOrders({ from: '2026-06-01', to: '2026-06-05' })
    const { sql: text } = compileLastCall()

    // The COALESCE + ISO-day-of-week fallback was removed in the CONSTRAINT-19
    // revision. Reintroducing it here would resurrect the two-implementations
    // divergence risk the change exists to delete.
    expect(text, 'no COALESCE fallback').not.toMatch(/coalesce/i)
    expect(text, 'no day-of-week arithmetic').not.toMatch(/isodow/i)
    expect(text).not.toMatch(/requested_delivery_date\s*-\s*\d/i)
  })

  it('keeps the range filter sargable so the index can serve it', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCalendarOrders({ from: '2026-06-01', to: '2026-06-05' })
    const { sql: text } = compileLastCall()

    // FI-02: wrapping the column in an expression made orders_production_date_idx
    // unusable and forced a sequential scan. A bare column comparison restores it.
    const whereClause = text.slice(text.toLowerCase().indexOf('where'))
    expect(whereClause).not.toMatch(/\w+\s*\(\s*o\.production_date/i)
  })

  it('binds the date range as parameters rather than interpolating it', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCalendarOrders({ from: '2026-06-01', to: '2026-06-05' })
    const compiled = compileLastCall()

    expect(compiled.params).toContain('2026-06-01')
    expect(compiled.params).toContain('2026-06-05')
    expect(compiled.sql, 'range values must never appear inline in the SQL text')
      .not.toMatch(/'2026-06-0[15]'/)
  })

  it('excludes cancelled orders', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCalendarOrders({ from: '2026-06-01', to: '2026-06-05' })
    expect(compileLastCall().sql).toMatch(/o\.status\s*<>\s*'cancelled'/i)
  })

  it('does not filter out completed or invoiced orders', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCalendarOrders({ from: '2026-06-01', to: '2026-06-05' })
    const compiled = compileLastCall()
    expect(compiled.sql).not.toMatch(/status\s*=\s*'scheduled'/i)
    expect(compiled.sql).not.toMatch(/status\s+IN\s*\(/i)
  })

  it('selects every field the calendar card and popup render', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCalendarOrders({ from: '2026-06-01', to: '2026-06-05' })
    const { sql: text } = compileLastCall()

    const expectedColumns = [
      'qty_275_recon', 'qty_275_rebot', 'qty_275_new',
      'qty_330_recon', 'qty_330_rebot', 'qty_330_new',
      'unit_price_275_recon', 'unit_price_275_rebot', 'unit_price_275_new',
      'unit_price_330_recon', 'unit_price_330_rebot', 'unit_price_330_new',
      'price', 'backhaul', 'notes', 'same_day_delivery', 'status',
      'production_date', 'requested_delivery_date', 'production_sort_index',
    ]
    for (const column of expectedColumns) {
      expect(text, `expected SELECT to include ${column}`).toMatch(new RegExp(`\\b${column}\\b`))
    }
    expect(text).toMatch(/left\s+join\s+customers\s+c\s+on\s+c\.id\s*=\s*o\.customer_id/i)
    expect(text).toMatch(/c\.company_name\s+AS\s+customer_name/i)
  })

  it('orders by production_date, then sort index NULLS LAST, then po_number', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCalendarOrders({ from: '2026-06-01', to: '2026-06-05' })
    const { sql: text } = compileLastCall()

    expect(text).toMatch(/order\s+by/i)
    expect(text).toMatch(/o\.production_sort_index\s+ASC\s+NULLS\s+LAST/i)
    const orderBy = text.slice(text.toLowerCase().lastIndexOf('order by'))
    expect(orderBy.indexOf('production_sort_index')).toBeLessThan(orderBy.indexOf('po_number'))
  })

  it('returns the driver rows unchanged', async () => {
    mockExecute.mockResolvedValueOnce([sampleRow])
    const rows = await getCalendarOrders({ from: '2026-06-01', to: '2026-06-05' })
    expect(rows).toEqual([sampleRow])
  })

  it('throws InvalidDateError on an unparseable range bound, before querying', async () => {
    let caught: unknown
    try {
      await getCalendarOrders({ from: 'not-a-date', to: '2026-06-05' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(InvalidDateError)
    expect(mockExecute, 'must not reach the database with a bad range').not.toHaveBeenCalled()
  })

  it('throws InvalidDateError on an inverted range rather than returning empty', async () => {
    let caught: unknown
    try {
      await getCalendarOrders({ from: '2026-06-05', to: '2026-06-01' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(InvalidDateError)
    expect(caught).toMatchObject({ helper: 'getCalendarOrders' })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('throws DatabaseError with cause when the underlying query fails', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValueOnce(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let caught: unknown
    try {
      await getCalendarOrders({ from: '2026-06-01', to: '2026-06-05' })
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()

    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({ operation: 'getCalendarOrders', cause: driverError })
  })
})

describe('getUnscheduledOrders', () => {
  it('requires only production_date to be null, whatever the delivery date says', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getUnscheduledOrders()
    const { sql: text } = compileLastCall()

    expect(text).toMatch(/o\.production_date\s+IS\s+NULL/i)
    // The delivery-date clause was removed in the CONSTRAINT-19 revision: an
    // order with a delivery date but no production date is unscheduled, which is
    // what makes `clearProductionPlacement` genuinely unschedule a card instead
    // of bouncing it to a derived day.
    expect(text, 'delivery date must not gate the unscheduled set')
      .not.toMatch(/requested_delivery_date\s+IS\s+NULL/i)
  })

  it('excludes cancelled orders', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getUnscheduledOrders()
    expect(compileLastCall().sql).toMatch(/o\.status\s*<>\s*'cancelled'/i)
  })

  it('orders by po_number', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getUnscheduledOrders()
    expect(compileLastCall().sql).toMatch(/order\s+by\s+o\.po_number\s+ASC/i)
  })

  it('returns the driver rows unchanged', async () => {
    mockExecute.mockResolvedValueOnce([sampleRow])
    expect(await getUnscheduledOrders()).toEqual([sampleRow])
  })

  it('throws DatabaseError with cause when the underlying query fails', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValueOnce(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let caught: unknown
    try {
      await getUnscheduledOrders()
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()

    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({ operation: 'getUnscheduledOrders', cause: driverError })
  })
})

describe('calendar constants', () => {
  it('are re-exported from the query module for server-side consumers', () => {
    expect(UNSCHEDULED_DROPDOWN_VISIBLE).toBe(4)
    expect(CALENDAR_WEEKS_BUFFER).toBe(4)
  })

  it('is client-safe — calendar.constants.ts imports nothing', () => {
    // Platform-Native Rule: a client component that value-imports from a module
    // reaching `@/db` drags the postgres driver into the browser bundle and
    // breaks the production build with `Module not found: 'fs'`.
    const source = readFileSync(path.resolve(__dirname, '../calendar.constants.ts'), 'utf-8')
    expect(source).not.toMatch(/^\s*import\s/m)
    expect(source).not.toMatch(/require\(/)
  })
})
