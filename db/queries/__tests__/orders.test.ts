import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import { getOrders, getOrderDetail } from '../orders'
import { DatabaseError, OrderNotFoundError } from '@/lib/errors'

const dialect = new PgDialect()

function compileCall(callIndex: number): { sql: string; params: unknown[] } {
  const sqlArg = mockExecute.mock.calls[callIndex]?.[0] as SQL | undefined
  if (!sqlArg) throw new Error(`db.execute was not called ${callIndex + 1} time(s)`)
  return dialect.sqlToQuery(sqlArg)
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

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getOrders', () => {
  it('returns every matching row in a single un-paginated query', async () => {
    mockExecute.mockResolvedValueOnce([sampleOrder])
    const result = await getOrders({ status: 'scheduled' })
    expect(result.rows).toEqual([sampleOrder])
    expect(mockExecute).toHaveBeenCalledOnce()
    expect(compileCall(0).sql).not.toMatch(/\bLIMIT\b|\bOFFSET\b/i)
  })

  it('status=scheduled: binds the status as a query parameter', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getOrders({ status: 'scheduled' })
    expect(compileCall(0).params).toContain('scheduled')
  })

  it('status=completed: matches both completed and invoiced rows', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getOrders({ status: 'completed' })
    expect(compileCall(0).sql).toMatch(
      /o\.status\s+IN\s*\(\s*'completed'\s*,\s*'invoiced'\s*\)/i,
    )
  })

  it('status=all: omits the status filter from the WHERE clause', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getOrders({ status: 'all' })
    const listCall = compileCall(0)
    // Match WHERE-clause-style filter only — the ORDER BY contains its own
    // `o.status = 'scheduled'` in a CASE expression for sort bucketing.
    expect(listCall.sql).not.toMatch(/AND\s+o\.status/i)
    expect(listCall.params).not.toContain('all')
  })

  it('emits a case-insensitive ILIKE clause on PO number and company name when a search term is provided', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getOrders({ search: 'acme' })
    const { sql: compiled, params } = compileCall(0)
    expect(compiled).toMatch(/o\.po_number ILIKE .+ OR c\.company_name ILIKE /i)
    expect(params).toContain('%acme%')
  })

  it('omits the ILIKE clause when the search term is whitespace-only', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getOrders({ search: '   ' })
    expect(compileCall(0).sql).not.toMatch(/ILIKE/)
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
    mockExecute.mockResolvedValueOnce([])
    await getOrders({ status: 'all' })
    const listCall = compileCall(0)
    for (const col of [
      'qty_275_recon', 'qty_275_rebot', 'qty_275_new',
      'qty_330_recon', 'qty_330_rebot', 'qty_330_new',
    ]) {
      expect(listCall.sql, `expected SELECT to include ${col}`).toMatch(new RegExp(`\\b${col}\\b`))
    }
  })

  it('does NOT select the dropped legacy columns', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getOrders({ status: 'all' })
    const listCall = compileCall(0)
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
