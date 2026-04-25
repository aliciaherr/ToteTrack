import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import { getInvoiceableOrders, getInvoices, getInvoiceDetail } from '../invoices'
import { DatabaseError, InvoiceNotFoundError } from '@/lib/errors'

const dialect = new PgDialect()

function compileLastCall(): { sql: string; params: unknown[] } {
  const lastIndex = mockExecute.mock.calls.length - 1
  const sqlArg = mockExecute.mock.calls[lastIndex]?.[0] as SQL | undefined
  if (!sqlArg) throw new Error('db.execute was not called')
  return dialect.sqlToQuery(sqlArg)
}

const sampleRow = {
  id: '11111111-1111-1111-1111-111111111111',
  po_number: 'PO-3001',
  customer_id: '22222222-2222-2222-2222-222222222222',
  customer_name: 'Acme Industrial',
  qty_275_recon: 0,
  qty_275_rebot: 10,
  qty_275_new: 0,
  qty_330_recon: 0,
  qty_330_rebot: 0,
  qty_330_new: 0,
  price: '250.00',
  requested_delivery_date: '2026-04-10',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getInvoiceableOrders', () => {
  it('filters to completed, uninvoiced orders in the billing month and returns the joined rows', async () => {
    mockExecute.mockResolvedValueOnce([sampleRow])
    const billingMonth = new Date(2026, 3, 15) // 2026-04-15 local
    const result = await getInvoiceableOrders(billingMonth)

    expect(result).toEqual([sampleRow])

    const compiled = compileLastCall()
    // Status + invoice filter literals live in the SQL string, not params.
    expect(compiled.sql).toMatch(/o\.status\s*=\s*'completed'/i)
    expect(compiled.sql).toMatch(/o\.invoice_id\s+is\s+null/i)
    // Month boundaries flow through as params in ISO yyyy-MM-dd shape.
    expect(compiled.params).toContain('2026-04-01')
    expect(compiled.params).toContain('2026-04-30')
  })

  it('returns an empty array (not an error) when no orders match', async () => {
    mockExecute.mockResolvedValueOnce([])
    const result = await getInvoiceableOrders(new Date(2026, 3, 1))
    expect(result).toEqual([])
  })

  it('throws DatabaseError with operation context when the underlying query fails', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValueOnce(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    let caught: unknown
    try {
      await getInvoiceableOrders(new Date(2026, 3, 1))
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()

    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({
      operation: 'getInvoiceableOrders',
      cause: driverError,
    })
  })
})

const sampleLedgerRow = {
  id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  invoice_number: 'INV-0001',
  billing_month: '2026-04-01',
  total_amount: '375.50',
}

describe('getInvoices', () => {
  it('returns the joined ledger rows with no status/customer filter (v3: flat list)', async () => {
    mockExecute.mockResolvedValueOnce([sampleLedgerRow])
    const rows = await getInvoices()
    expect(rows).toEqual([sampleLedgerRow])
  })

  it('always sorts by billing_month DESC so the newest invoice appears first', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getInvoices()
    const compiled = compileLastCall()
    expect(compiled.sql).toMatch(/order\s+by[^;]*billing_month\s+desc/i)
  })

  it('throws DatabaseError with operation context when the underlying query fails', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValueOnce(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let caught: unknown
    try {
      await getInvoices()
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()
    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({ operation: 'getInvoices', cause: driverError })
  })
})

const sampleInvoiceDetail = {
  id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  invoice_number: 'INV-0001',
  billing_month: '2026-04-01',
  total_amount: '375.50',
  created_at: '2026-04-21T12:00:00Z',
}

const samplePoRow = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  po_number: 'PO-3001',
  qty_275_recon: 0,
  qty_275_rebot: 10,
  qty_275_new: 0,
  qty_330_recon: 0,
  qty_330_rebot: 0,
  qty_330_new: 0,
  price: '250.00',
  customer_name: 'Acme Industrial',
  backhaul: false,
}

describe('getInvoiceDetail', () => {
  it('returns the invoice + every PO row attached via orders.invoice_id', async () => {
    // Two parallel executes: detail row + po rows.
    mockExecute
      .mockResolvedValueOnce([sampleInvoiceDetail])
      .mockResolvedValueOnce([samplePoRow])

    const detail = await getInvoiceDetail(sampleInvoiceDetail.id)

    expect(detail).toEqual({ ...sampleInvoiceDetail, po_rows: [samplePoRow] })
  })

  it('throws InvoiceNotFoundError when the detail query returns zero rows', async () => {
    mockExecute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    let caught: unknown
    try {
      await getInvoiceDetail(sampleInvoiceDetail.id)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(InvoiceNotFoundError)
    expect((caught as InvoiceNotFoundError).invoiceId).toBe(sampleInvoiceDetail.id)
  })

  it('wraps driver errors as DatabaseError without swallowing the cause', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValue(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let caught: unknown
    try {
      await getInvoiceDetail(sampleInvoiceDetail.id)
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()
    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({ operation: 'getInvoiceDetail', cause: driverError })
  })
})
