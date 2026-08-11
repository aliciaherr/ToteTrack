import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import {
  getPickups,
  getPickupDetail,
  getCustomerPickups,
  getCustomerUnscheduledPickupCount,
} from '../pickups'
import { DatabaseError, PickupNotFoundError } from '@/lib/errors'

const dialect = new PgDialect()

function compileCall(callIndex: number): { sql: string; params: unknown[] } {
  const sqlArg = mockExecute.mock.calls[callIndex]?.[0] as SQL | undefined
  if (!sqlArg) throw new Error(`db.execute was not called ${callIndex + 1} time(s)`)
  return dialect.sqlToQuery(sqlArg)
}

const samplePickup = {
  id: '11111111-1111-1111-1111-111111111111',
  customer_id: '22222222-2222-2222-2222-222222222222',
  customer_name: 'Acme Industrial',
  status: 'scheduled' as const,
  qty_275: 12,
  qty_330: 4,
  pickup_date: '2026-05-01',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getPickups', () => {
  it('returns every matching row in a single un-paginated query', async () => {
    mockExecute.mockResolvedValueOnce([samplePickup])
    const result = await getPickups({ status: 'scheduled' })
    expect(result.rows).toEqual([samplePickup])
    expect(mockExecute).toHaveBeenCalledOnce()
    expect(compileCall(0).sql).not.toMatch(/\bLIMIT\b|\bOFFSET\b/i)
  })

  it('status and search clauses compile into the expected SQL', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getPickups({ status: 'completed', search: 'acme' })
    const { sql: compiled, params } = compileCall(0)
    // Both filters land on the always-true base WHERE as independent ANDs.
    expect(compiled).toMatch(/WHERE TRUE/i)
    expect(compiled).toMatch(/AND p\.status = /i)
    expect(compiled).toMatch(/AND c\.company_name ILIKE /i)
    expect(params).toContain('completed')
    expect(params).toContain('%acme%')
    // Scheduled-first, then everything else — the two-stage ORDER BY.
    expect(compiled).toMatch(/ORDER BY[\s\S]*p\.status = \$?\d*'?scheduled'?/i)
    expect(compiled).toMatch(/ASC NULLS LAST/i)
    expect(compiled).toMatch(/DESC NULLS LAST/i)
  })

  it('status=all: omits the status filter from the WHERE clause', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getPickups({ status: 'all' })
    const listCall = compileCall(0)
    // Match WHERE-clause-style filter only — the ORDER BY contains its own
    // `p.status = 'scheduled'` in a CASE expression for sort bucketing.
    expect(listCall.sql).not.toMatch(/AND\s+p\.status/i)
    expect(listCall.params).not.toContain('all')
  })

  it('defaults to status=all when no filters are given', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getPickups()
    expect(compileCall(0).sql).not.toMatch(/AND\s+p\.status/i)
  })

  it('never folds an invoiced sub-state into completed (pickups are never billed)', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getPickups({ status: 'completed' })
    expect(compileCall(0).sql).not.toMatch(/invoiced/i)
  })

  it('searches the customer name only — a pickup has no reference of its own', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getPickups({ search: 'acme' })
    const { sql: compiled } = compileCall(0)
    expect(compiled).toMatch(/c\.company_name ILIKE/i)
    expect(compiled).not.toMatch(/po_number/i)
  })

  it('omits the ILIKE clause when the search term is whitespace-only', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getPickups({ search: '   ' })
    expect(compileCall(0).sql).not.toMatch(/ILIKE/)
  })

  it('a driver rejection throws DatabaseError', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValue(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let caught: unknown
    try {
      await getPickups()
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()

    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({ operation: 'getPickups', cause: driverError })
  })
})

const samplePickupDetail = {
  ...samplePickup,
  id: '33333333-3333-3333-3333-333333333333',
  address: '123 Main Street',
  notes: 'Collect from the loading bay.',
}

describe('getPickupDetail', () => {
  it('returns all fields including the joined customer name', async () => {
    mockExecute.mockResolvedValueOnce([samplePickupDetail])
    const detail = await getPickupDetail(samplePickupDetail.id)
    expect(detail).toEqual(samplePickupDetail)
    const call = compileCall(0)
    expect(call.params).toContain(samplePickupDetail.id)
    expect(call.sql).toMatch(/company_name/i)
    expect(call.sql).toMatch(/p\.address/)
    expect(call.sql).toMatch(/p\.notes/)
  })

  it('throws PickupNotFoundError when no row matches the id', async () => {
    mockExecute.mockResolvedValueOnce([])
    let caught: unknown
    try {
      await getPickupDetail(samplePickupDetail.id)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(PickupNotFoundError)
    expect((caught as PickupNotFoundError).pickupId).toBe(samplePickupDetail.id)
  })

  it('throws DatabaseError with cause when the underlying query fails', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValueOnce(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let caught: unknown
    try {
      await getPickupDetail(samplePickupDetail.id)
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()

    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({ operation: 'getPickupDetail', cause: driverError })
  })
})

const CUSTOMER_ID = '44444444-4444-4444-4444-444444444444'

const sampleCustomerPickup = {
  id: '55555555-5555-5555-5555-555555555555',
  status: 'completed' as const,
  qty_275: 12,
  qty_330: 0,
  pickup_date: '2026-05-01',
}

describe('getCustomerPickups', () => {
  it('renders rows for the selected window, scoped to one customer, newest first', async () => {
    mockExecute.mockResolvedValueOnce([sampleCustomerPickup])
    const rows = await getCustomerPickups(CUSTOMER_ID, '3M')

    expect(rows).toEqual([sampleCustomerPickup])
    const { sql: compiled, params } = compileCall(0)
    expect(compiled).toMatch(/p\.customer_id = /i)
    expect(compiled).toMatch(/p\.pickup_date >= /i)
    expect(compiled).toMatch(/ORDER BY p\.pickup_date DESC NULLS LAST/i)
    expect(params).toContain(CUSTOMER_ID)
    // The window resolves to a yyyy-MM-dd lower bound, not the raw '3M' label.
    expect(params).not.toContain('3M')
    expect(params.some((param) => /^\d{4}-\d{2}-\d{2}$/.test(String(param)))).toBe(true)
  })

  it('never restricts the status — a cancelled pickup is still history', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCustomerPickups(CUSTOMER_ID, '1M')
    expect(compileCall(0).sql).not.toMatch(/p\.status\s*=/i)
  })

  it('returns an empty list when the customer has no pickups in the window', async () => {
    mockExecute.mockResolvedValueOnce([])
    await expect(getCustomerPickups(CUSTOMER_ID, 'YTD')).resolves.toEqual([])
  })

  it('a driver rejection throws DatabaseError carrying the cause', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValueOnce(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let caught: unknown
    try {
      await getCustomerPickups(CUSTOMER_ID, '1M')
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()

    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({ operation: 'getCustomerPickups', cause: driverError })
  })

  it('still excludes undated pickups from the row list — they are counted, not listed', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getCustomerPickups(CUSTOMER_ID, '1Y')
    const { sql: compiled } = compileCall(0)
    // The window lower bound is the whole row filter; nothing was relaxed to
    // let a NULL date through into the table.
    expect(compiled).toMatch(/p\.pickup_date >= /i)
    expect(compiled).not.toMatch(/pickup_date IS NULL/i)
    expect(compiled).not.toMatch(/\bOR\b/i)
  })
})

describe('getCustomerUnscheduledPickupCount', () => {
  it('counts only open, undated pickups for the one customer', async () => {
    mockExecute.mockResolvedValueOnce([{ count: 3 }])
    const count = await getCustomerUnscheduledPickupCount(CUSTOMER_ID)

    expect(count).toBe(3)
    const { sql: compiled, params } = compileCall(0)
    expect(compiled).toMatch(/COUNT\(\*\)::int/i)
    expect(compiled).toMatch(/p\.customer_id = /i)
    expect(compiled).toMatch(/p\.pickup_date IS NULL/i)
    // A cancelled or completed pickup with no date is closed, not pending.
    expect(compiled).toMatch(/p\.status = /i)
    expect(params).toContain(CUSTOMER_ID)
    expect(params).toContain('scheduled')
  })

  it('is never window-filtered — an undated pickup has no date to compare', async () => {
    mockExecute.mockResolvedValueOnce([{ count: 0 }])
    await getCustomerUnscheduledPickupCount(CUSTOMER_ID)
    const { sql: compiled, params } = compileCall(0)
    expect(compiled).not.toMatch(/pickup_date >=/i)
    expect(params.some((param) => /^\d{4}-\d{2}-\d{2}$/.test(String(param)))).toBe(false)
  })

  it('returns 0 when the driver hands back no row', async () => {
    mockExecute.mockResolvedValueOnce([])
    await expect(getCustomerUnscheduledPickupCount(CUSTOMER_ID)).resolves.toBe(0)
  })

  it('a driver rejection throws DatabaseError carrying the cause', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValueOnce(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let caught: unknown
    try {
      await getCustomerUnscheduledPickupCount(CUSTOMER_ID)
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()

    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({
      operation: 'getCustomerUnscheduledPickupCount',
      cause: driverError,
    })
  })
})
