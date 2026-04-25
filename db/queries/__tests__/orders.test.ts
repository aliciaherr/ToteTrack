import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import { getOrders, getOrderDetail, ORDERS_PAGE_SIZE } from '../orders'
import { DatabaseError, OrderNotFoundError } from '@/lib/errors'

const dialect = new PgDialect()

function compileCall(callIndex: number): { sql: string; params: unknown[] } {
  const sqlArg = mockExecute.mock.calls[callIndex]?.[0] as SQL | undefined
  if (!sqlArg) throw new Error(`db.execute was not called ${callIndex + 1} time(s)`)
  return dialect.sqlToQuery(sqlArg)
}

// Two queries fire in Promise.all: one list query (contains LIMIT) and one
// count query (contains COUNT). These helpers find each by SQL shape so the
// tests don't depend on scheduler-specific call order. Matching is
// case-insensitive because Drizzle's sql template preserves keyword case.
function findListCall(): { sql: string; params: unknown[] } {
  for (let i = 0; i < mockExecute.mock.calls.length; i++) {
    const compiled = compileCall(i)
    if (/limit/i.test(compiled.sql)) return compiled
  }
  throw new Error('List query call not found')
}

function findCountCall(): { sql: string; params: unknown[] } {
  for (let i = 0; i < mockExecute.mock.calls.length; i++) {
    const compiled = compileCall(i)
    if (/count\(\*\)/i.test(compiled.sql)) return compiled
  }
  throw new Error('Count query call not found')
}

const sampleOrder = {
  id: '11111111-1111-1111-1111-111111111111',
  po_number: 'PO-1001',
  customer_id: '22222222-2222-2222-2222-222222222222',
  customer_name: 'Acme Industrial',
  status: 'scheduled' as const,
  qty_275_recon: 0,
  qty_275_rebot: 10,
  qty_275_new: 0,
  qty_330_recon: 0,
  qty_330_rebot: 0,
  qty_330_new: 0,
  price: '250.00',
  requested_delivery_date: '2026-05-01',
  backhaul: false,
}

function mockListAndCount(rows: unknown[], totalCount: number): void {
  mockExecute.mockImplementation(async (sqlArg: SQL) => {
    const { sql: compiled } = dialect.sqlToQuery(sqlArg)
    if (/count\(\*\)/i.test(compiled)) return [{ total_count: totalCount }]
    return rows
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getOrders', () => {
  it('returns rows, totalCount, totalPages, and currentPage for the first page', async () => {
    mockListAndCount([sampleOrder], 25)
    const result = await getOrders({ status: 'scheduled' })
    expect(result.rows).toEqual([sampleOrder])
    expect(result.total_count).toBe(25)
    expect(result.total_pages).toBe(Math.ceil(25 / ORDERS_PAGE_SIZE))
    expect(result.current_page).toBe(1)
  })

  it('status=scheduled: emits WHERE o.status = "scheduled" in both queries', async () => {
    mockListAndCount([], 0)
    await getOrders({ status: 'scheduled' })
    const listCall = findListCall()
    const countCall = findCountCall()
    expect(listCall.params).toContain('scheduled')
    expect(countCall.params).toContain('scheduled')
  })

  it('status=completed: matches both completed and invoiced rows', async () => {
    mockListAndCount([], 0)
    await getOrders({ status: 'completed' })
    const listCall = findListCall()
    expect(listCall.sql).toMatch(/o\.status\s+IN\s*\(\s*'completed'\s*,\s*'invoiced'\s*\)/i)
  })

  it('status=all: omits the status filter from the WHERE clause', async () => {
    mockListAndCount([], 0)
    await getOrders({ status: 'all' })
    const listCall = findListCall()
    // Match WHERE-clause-style filter only — the ORDER BY contains its own
    // `o.status = 'scheduled'` in a CASE expression for sort bucketing.
    expect(listCall.sql).not.toMatch(/WHERE\s+o\.status/i)
    expect(listCall.params).not.toContain('all')
  })

  it('page=2: shifts the OFFSET by one page so page 1 rows are skipped', async () => {
    mockListAndCount([], 0)
    await getOrders({ status: 'all', page: 2 })
    const listCall = findListCall()
    expect(listCall.params).toContain(ORDERS_PAGE_SIZE)
    expect(listCall.params).toContain(ORDERS_PAGE_SIZE)
    expect(listCall.params).toContain((2 - 1) * ORDERS_PAGE_SIZE)
  })

  it('clamps page < 1 to page 1 instead of producing a negative offset', async () => {
    mockListAndCount([], 0)
    const result = await getOrders({ page: 0 })
    expect(result.current_page).toBe(1)
    const listCall = findListCall()
    expect(listCall.params).toContain(0)
  })

  it('throws DatabaseError with cause when the underlying query fails', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValue(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let caught: unknown
    try {
      await getOrders()
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()

    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({
      operation: 'getOrders',
      cause: driverError,
    })
  })

  it('selects all 6 qty columns from the wide-row schema (Feature 9)', async () => {
    mockListAndCount([], 0)
    await getOrders({ status: 'all' })
    const listCall = findListCall()
    for (const col of [
      'qty_275_recon', 'qty_275_rebot', 'qty_275_new',
      'qty_330_recon', 'qty_330_rebot', 'qty_330_new',
    ]) {
      expect(listCall.sql, `expected SELECT to include ${col}`).toMatch(new RegExp(`\\b${col}\\b`))
    }
  })

  it('does NOT select the dropped legacy columns', async () => {
    mockListAndCount([], 0)
    await getOrders({ status: 'all' })
    const listCall = findListCall()
    expect(listCall.sql).not.toMatch(/\bcontainer_size\b/)
    expect(listCall.sql).not.toMatch(/\bcontainer_type\b/)
    // `quantity` would also fail — but the regex is loose enough that future
    // unrelated `quantity` aliases would trip; tightened to the column read.
    expect(listCall.sql).not.toMatch(/o\.quantity/)
  })
})

const sampleOrderDetail = {
  id: '33333333-3333-3333-3333-333333333333',
  po_number: 'PO-2001',
  customer_id: '44444444-4444-4444-4444-444444444444',
  customer_name: 'Acme Industrial',
  status: 'scheduled' as const,
  qty_275_recon: 0,
  qty_275_rebot: 12,
  qty_275_new: 0,
  qty_330_recon: 0,
  qty_330_rebot: 0,
  qty_330_new: 0,
  price: '300.00',
  pickup_only: false,
  delivery_address: '123 Main Street',
  requested_delivery_date: '2026-05-10',
  backhaul: true,
  document_url: null,
  notes: 'Deliver before noon.',
}

describe('getOrderDetail', () => {
  it('returns all fields including the joined customer name', async () => {
    mockExecute.mockResolvedValueOnce([sampleOrderDetail])
    const detail = await getOrderDetail(sampleOrderDetail.id)
    expect(detail).toEqual(sampleOrderDetail)
    const call = compileCall(0)
    expect(call.params).toContain(sampleOrderDetail.id)
    expect(call.sql).toMatch(/company_name/i)
  })

  it('throws OrderNotFoundError when no row matches the id', async () => {
    mockExecute.mockResolvedValueOnce([])
    let caught: unknown
    try {
      await getOrderDetail(sampleOrderDetail.id)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(OrderNotFoundError)
    expect((caught as OrderNotFoundError).orderId).toBe(sampleOrderDetail.id)
  })

  it('throws DatabaseError with cause when the underlying query fails', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValueOnce(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let caught: unknown
    try {
      await getOrderDetail(sampleOrderDetail.id)
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()

    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({
      operation: 'getOrderDetail',
      cause: driverError,
    })
  })
})
