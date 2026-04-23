import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockGetUser = vi.hoisted(() => vi.fn())
const mockTransaction = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())
const dialect = new PgDialect()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: mockGetUser } }),
}))

vi.mock('@/db', () => ({
  db: { transaction: mockTransaction },
}))

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }))

import { createInvoice } from '../invoices'
import { INVOICE_EXISTS_CODE } from '../invoices.constants'

const AUTH_OK = { data: { user: { id: 'user-1' } }, error: null }

const INVOICE_ID = '11111111-1111-1111-1111-111111111111'
const EXISTING_INVOICE_ID = '22222222-2222-2222-2222-222222222222'
const ORDER_ID_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const ORDER_ID_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

type OrderRow = {
  id: string
  po_number: string
  status: string
  invoice_id: string | null
  price: string
}

function makeOrderRow(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: ORDER_ID_A,
    po_number: 'PO-3001',
    status: 'completed',
    invoice_id: null,
    price: '250.00',
    ...overrides,
  }
}

interface TxStubConfig {
  // First execute call returns the existing-invoice-for-month lookup.
  existingMonthInvoice?: { id: string; invoice_number: string } | null
  // Subsequent execute calls return the max_num for nextInvoiceNumber.
  maxNumRow?: { max_num: number | string }
  // SELECT FOR UPDATE rows from the orders lock.
  orderRows: OrderRow[]
  insertedInvoiceId: string
  updateOrdersCollector?: { called: boolean }
  deleteInvoicesCollector?: { calledWith: string[] }
  executeCapture?: { sqls: string[] }
}

function stubTransaction(config: TxStubConfig) {
  mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
    let executeCallIndex = 0
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({ for: () => Promise.resolve(config.orderRows) }),
        }),
      }),
      execute: (sqlArg: SQL) => {
        if (config.executeCapture) {
          config.executeCapture.sqls.push(dialect.sqlToQuery(sqlArg).sql)
        }
        const callIndex = executeCallIndex++
        // Call order in runCreateInvoiceTransaction:
        //   0 — existingInvoiceForMonth
        //   N — nextInvoiceNumber (single MAX query)
        if (callIndex === 0) {
          return Promise.resolve(
            config.existingMonthInvoice ? [config.existingMonthInvoice] : [],
          )
        }
        return Promise.resolve(
          config.maxNumRow === undefined ? [] : [config.maxNumRow],
        )
      },
      insert: () => ({
        values: () => ({
          returning: () => Promise.resolve([{ id: config.insertedInvoiceId }]),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => {
            if (config.updateOrdersCollector) config.updateOrdersCollector.called = true
            return Promise.resolve(undefined)
          },
        }),
      }),
      delete: () => ({
        where: (_clause: unknown) => {
          if (config.deleteInvoicesCollector) {
            config.deleteInvoicesCollector.calledWith.push(EXISTING_INVOICE_ID)
          }
          return Promise.resolve(undefined)
        },
      }),
    }
    return await fn(tx)
  })
}

const VALID_INPUT = {
  billingMonth: new Date(2026, 3, 1),
  orderIds: [ORDER_ID_A, ORDER_ID_B],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createInvoice', () => {
  it('creates the invoice and sets all selected orders to invoiced atomically', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const collector = { called: false }
    stubTransaction({
      orderRows: [
        makeOrderRow({ id: ORDER_ID_A, po_number: 'PO-3001', price: '250.00' }),
        makeOrderRow({ id: ORDER_ID_B, po_number: 'PO-3002', price: '125.50' }),
      ],
      existingMonthInvoice: null,
      maxNumRow: { max_num: 0 },
      insertedInvoiceId: INVOICE_ID,
      updateOrdersCollector: collector,
    })

    const result = await createInvoice(VALID_INPUT)

    expect(result).toEqual({ id: INVOICE_ID, invoiceNumber: 'INV-0001' })
    expect(collector.called).toBe(true)
    expect(mockRevalidatePath).toHaveBeenCalledWith('/invoices')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/orders')
  })

  it('returns INVOICE_EXISTS code when the month already has an invoice and overwrite is false', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubTransaction({
      orderRows: [],
      existingMonthInvoice: { id: EXISTING_INVOICE_ID, invoice_number: 'INV-0042' },
      maxNumRow: { max_num: 42 },
      insertedInvoiceId: INVOICE_ID,
    })

    const result = await createInvoice(VALID_INPUT)

    expect(result).toEqual({ code: INVOICE_EXISTS_CODE, existingInvoiceNumber: 'INV-0042' })
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('overwrites: deletes the existing invoice (orders detach) and creates a fresh INV-#### when overwrite=true', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const updateCollector = { called: false }
    const deleteCollector = { calledWith: [] as string[] }
    stubTransaction({
      orderRows: [makeOrderRow({ id: ORDER_ID_A, po_number: 'PO-3001', price: '500.00' })],
      existingMonthInvoice: { id: EXISTING_INVOICE_ID, invoice_number: 'INV-0042' },
      maxNumRow: { max_num: 100 },
      insertedInvoiceId: INVOICE_ID,
      updateOrdersCollector: updateCollector,
      deleteInvoicesCollector: deleteCollector,
    })

    const result = await createInvoice({
      billingMonth: new Date(2026, 3, 1),
      orderIds: [ORDER_ID_A],
      overwrite: true,
    })

    expect(result).toEqual({ id: INVOICE_ID, invoiceNumber: 'INV-0101' })
    expect(deleteCollector.calledWith).toHaveLength(1)
    expect(updateCollector.called).toBe(true)
  })

  it('rejects with the offending PO number when a selected order is already invoiced', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubTransaction({
      orderRows: [
        makeOrderRow({
          id: ORDER_ID_A,
          po_number: 'PO-3001',
          status: 'invoiced',
          invoice_id: '99999999-9999-9999-9999-999999999999',
        }),
      ],
      existingMonthInvoice: null,
      maxNumRow: { max_num: 0 },
      insertedInvoiceId: INVOICE_ID,
    })

    const result = await createInvoice({
      billingMonth: new Date(2026, 3, 1),
      orderIds: [ORDER_ID_A],
    })

    expect(result).toEqual({ error: 'Order PO-3001 is already invoiced.' })
  })

  it('rejects when fewer rows are returned than orderIds requested (stale id)', async () => {
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    stubTransaction({
      orderRows: [],
      existingMonthInvoice: null,
      maxNumRow: { max_num: 0 },
      insertedInvoiceId: INVOICE_ID,
    })
    const result = await createInvoice(VALID_INPUT)
    expect(result).toEqual({ error: 'One or more orders could not be found.' })
  })

  it('rejects with auth error when not signed in', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const result = await createInvoice(VALID_INPUT)
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('embeds the SUBSTRING position as a SQL literal so Postgres picks the integer overload, not the regex one', async () => {
    // Regression: when the position was a bound parameter, Postgres inferred
    // it as text and treated SUBSTRING as the regex variant. MAX returned the
    // literal char (e.g. '5') across the table, so once any invoice number
    // contained a '5', nextInvoiceNumber permanently returned 6 and INSERT
    // collided on the unique constraint.
    mockGetUser.mockResolvedValueOnce(AUTH_OK)
    const capture = { sqls: [] as string[] }
    stubTransaction({
      orderRows: [makeOrderRow({ id: ORDER_ID_A, po_number: 'PO-3001', price: '100.00' })],
      existingMonthInvoice: null,
      maxNumRow: { max_num: 100 },
      insertedInvoiceId: 'inv-101',
      executeCapture: capture,
    })
    await createInvoice({
      billingMonth: new Date(2026, 3, 1),
      orderIds: [ORDER_ID_A],
    })
    const sub = capture.sqls.find((s) => /SUBSTRING/i.test(s))
    expect(sub).toBeTruthy()
    expect(sub).toMatch(/SUBSTRING\([^)]*FROM\s+5\s*\)/i)
    expect(sub).not.toMatch(/SUBSTRING\([^)]*FROM\s+\$/i)
  })
})
