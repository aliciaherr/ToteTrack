import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import {
  getCalendarPickups,
  getUnscheduledPickups,
  type CalendarPickupRow,
} from '../pickups.calendar'
import { DatabaseError, InvalidDateError } from '@/lib/errors'

const dialect = new PgDialect()

function compileLastCall(): { sql: string; params: unknown[] } {
  const calls = mockExecute.mock.calls
  const sqlArg = calls[calls.length - 1]?.[0] as SQL | undefined
  if (!sqlArg) throw new Error('db.execute was not called')
  return dialect.sqlToQuery(sqlArg)
}

const sampleRow: CalendarPickupRow = {
  id: '11111111-1111-1111-1111-111111111111',
  customer_id: '22222222-2222-2222-2222-222222222222',
  customer_name: 'Acme Rebottling',
  status: 'scheduled',
  qty_275: 12,
  qty_330: 4,
  pickup_date: '2026-06-03',
  sort_index: null,
  address: null,
  notes: null,
  contacts: [],
}

const RANGE = { from: '2026-06-01', to: '2026-06-05' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getCalendarPickups', () => {
  it('filters on pickup_date directly, with no derivation', async () => {
    mockExecute.mockResolvedValueOnce([sampleRow])
    await getCalendarPickups(RANGE)
    const { sql: text } = compileLastCall()

    expect(text).toMatch(/p\.pickup_date\s*>=/i)
    expect(text).toMatch(/p\.pickup_date\s*<=/i)
    // `pickup_date` IS the placement (CONSTRAINT-25) — there is no second date
    // to coalesce against, unlike an order's delivery promise.
    expect(text).not.toMatch(/coalesce\s*\(\s*p\.pickup_date/i)
  })

  it('keeps the range filter sargable so the index can serve it', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCalendarPickups(RANGE)
    const { sql: text } = compileLastCall()

    // `lastIndexOf` because the contacts aggregate carries its own correlated
    // WHERE inside the select list, ahead of the real one.
    const whereClause = text.slice(text.toLowerCase().lastIndexOf('where'))
    expect(whereClause).not.toMatch(/\w+\s*\(\s*p\.pickup_date/i)
  })

  it('binds the date range as parameters rather than interpolating it', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCalendarPickups(RANGE)
    const compiled = compileLastCall()

    expect(compiled.params).toContain('2026-06-01')
    expect(compiled.params).toContain('2026-06-05')
    expect(compiled.sql, 'range values must never appear inline in the SQL text')
      .not.toMatch(/'2026-06-0[15]'/)
  })

  it('excludes cancelled pickups but keeps completed ones', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCalendarPickups(RANGE)
    const { sql: text } = compileLastCall()

    expect(text).toMatch(/p\.status\s*<>\s*'cancelled'/i)
    expect(text).not.toMatch(/status\s*=\s*'scheduled'/i)
    expect(text).not.toMatch(/status\s+IN\s*\(/i)
  })

  it('selects every field the pickup card and popup render', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCalendarPickups(RANGE)
    const { sql: text } = compileLastCall()

    for (const column of ['qty_275', 'qty_330', 'pickup_date', 'sort_index', 'address', 'notes']) {
      expect(text, `expected SELECT to include ${column}`).toMatch(new RegExp(`\\b${column}\\b`))
    }
    expect(text).toMatch(/left\s+join\s+customers\s+c\s+on\s+c\.id\s*=\s*p\.customer_id/i)
    expect(text).toMatch(/c\.company_name\s+AS\s+customer_name/i)
  })

  it('embeds the customer contacts as a json aggregate, coalesced to an empty array', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCalendarPickups(RANGE)
    const { sql: text } = compileLastCall()

    // The popup's Contact menu is `ContactMenu` unchanged, so the pickup row has
    // to carry the same `contacts` shape the order row does.
    expect(text).toMatch(/coalesce\s*\(\s*\(\s*select\s+json_agg/i)
    expect(text).toMatch(/cc\.customer_id\s*=\s*p\.customer_id/i)
    expect(text).toMatch(/order\s+by\s+cc\.is_primary\s+DESC\s*,\s*cc\.created_at\s+ASC/i)
    expect(text).toMatch(/'\[\]'::json\s*\)\s+AS\s+contacts/i)
  })

  it('orders by pickup_date, then sort index NULLS LAST, then age', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCalendarPickups(RANGE)
    const { sql: text } = compileLastCall()

    expect(text).toMatch(/p\.sort_index\s+ASC\s+NULLS\s+LAST/i)
    const orderBy = text.slice(text.toLowerCase().lastIndexOf('order by'))
    expect(orderBy.indexOf('pickup_date')).toBeLessThan(orderBy.indexOf('sort_index'))
    expect(orderBy.indexOf('sort_index')).toBeLessThan(orderBy.indexOf('created_at'))
  })

  it('returns the driver rows unchanged', async () => {
    mockExecute.mockResolvedValueOnce([sampleRow])
    expect(await getCalendarPickups(RANGE)).toEqual([sampleRow])
  })

  it('throws InvalidDateError on an unparseable range bound, before querying', async () => {
    let caught: unknown
    try {
      await getCalendarPickups({ from: 'not-a-date', to: '2026-06-05' })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(InvalidDateError)
    expect(mockExecute, 'must not reach the database with a bad range').not.toHaveBeenCalled()
  })

  it('throws InvalidDateError on an inverted range rather than returning empty', async () => {
    let caught: unknown
    try {
      await getCalendarPickups({ from: '2026-06-05', to: '2026-06-01' })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(InvalidDateError)
    expect(caught).toMatchObject({ helper: 'getCalendarPickups' })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('throws DatabaseError with cause when the underlying query fails', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValueOnce(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let caught: unknown
    try {
      await getCalendarPickups(RANGE)
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()

    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({ operation: 'getCalendarPickups', cause: driverError })
  })
})

describe('getUnscheduledPickups', () => {
  it('is the exact complement of the range query — date null, still not cancelled', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getUnscheduledPickups()
    const { sql: text } = compileLastCall()

    expect(text).toMatch(/p\.pickup_date\s+IS\s+NULL/i)
    expect(text).toMatch(/p\.status\s*<>\s*'cancelled'/i)
  })

  it('orders oldest-first — the collection waiting longest is the one to deal with', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getUnscheduledPickups()

    expect(compileLastCall().sql).toMatch(/order\s+by\s+p\.created_at\s+ASC/i)
  })

  it('carries the same contacts projection as the range query', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getUnscheduledPickups()
    const { sql: text } = compileLastCall()

    // Both share PICKUP_CALENDAR_SELECT_LIST, so a card opened from the callout
    // and the same card in a column carry identical fields. If this fails, the
    // projections have drifted.
    expect(text).toMatch(/coalesce\s*\(\s*\(\s*select\s+json_agg/i)
    expect(text).toMatch(/'\[\]'::json\s*\)\s+AS\s+contacts/i)
  })

  it('returns the driver rows unchanged', async () => {
    mockExecute.mockResolvedValueOnce([sampleRow])
    expect(await getUnscheduledPickups()).toEqual([sampleRow])
  })

  it('throws DatabaseError with cause when the underlying query fails', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValueOnce(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let caught: unknown
    try {
      await getUnscheduledPickups()
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()

    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({ operation: 'getUnscheduledPickups', cause: driverError })
  })
})
