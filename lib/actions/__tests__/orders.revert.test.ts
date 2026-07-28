import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.hoisted(() => vi.fn())
const mockTransaction = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: mockGetUser } }),
}))

vi.mock('@/db', () => ({
  db: { transaction: mockTransaction },
}))

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }))

import { revertOrderToScheduled } from '../orders.revert'
import { orders } from '@/db/schema'

const AUTH_OK = { data: { user: { id: 'user-1' } }, error: null }
const ORDER_ID = '33333333-3333-3333-3333-333333333333'
const INVOICE_ID = '44444444-4444-4444-4444-444444444444'

// Every surface the action revalidates on success — must match
// REVERT_REVALIDATE_PATHS in orders.revert.ts.
const EXPECTED_PATHS = ['/orders', '/invoices', '/customers', '/calendar', '/dashboard']

interface TxLog {
  orderSet: Record<string, unknown> | null
  invoiceSet: Record<string, unknown> | null
  invoiceDeleted: boolean
}

/**
 * Stubs one `db.transaction` run. `row` is what the initial status/invoice_id
 * select returns; `remaining` is the COUNT/SUM the invoice-recompute query
 * returns when the reverted order was attached to an invoice.
 */
function stubTransaction(opts: {
  row: { status: string; invoice_id: string | null } | null
  remaining?: { count: number; total: string }
}): TxLog {
  const log: TxLog = { orderSet: null, invoiceSet: null, invoiceDeleted: false }
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(opts.row ? [opts.row] : []),
        }),
      }),
    }),
    update: (table: unknown) => ({
      set: (payload: Record<string, unknown>) => {
        if (table === orders) log.orderSet = payload
        else log.invoiceSet = payload
        return { where: () => Promise.resolve(undefined) }
      },
    }),
    execute: () => Promise.resolve(opts.remaining ? [opts.remaining] : []),
    delete: () => ({
      where: () => {
        log.invoiceDeleted = true
        return Promise.resolve(undefined)
      },
    }),
  }
  mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn(tx),
  )
  return log
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue(AUTH_OK)
})

describe('revertOrderToScheduled', () => {
  it('reverts a completed order to scheduled and revalidates every affected surface', async () => {
    const log = stubTransaction({ row: { status: 'completed', invoice_id: null } })
    const result = await revertOrderToScheduled(ORDER_ID)
    expect(result).toEqual({ success: true })
    expect(log.orderSet).toMatchObject({ status: 'scheduled', invoice_id: null })
    expect(log.orderSet).toHaveProperty('updated_at')
    for (const path of EXPECTED_PATHS) {
      expect(mockRevalidatePath).toHaveBeenCalledWith(path)
    }
  })

  it('recomputes the invoice total when other orders remain attached to it', async () => {
    const log = stubTransaction({
      row: { status: 'invoiced', invoice_id: INVOICE_ID },
      remaining: { count: 2, total: '450.00' },
    })
    const result = await revertOrderToScheduled(ORDER_ID)
    expect(result).toEqual({ success: true })
    expect(log.invoiceSet).toMatchObject({ total_amount: '450.00' })
    expect(log.invoiceDeleted).toBe(false)
  })

  it('deletes the invoice entirely when the reverted order was its last', async () => {
    const log = stubTransaction({
      row: { status: 'invoiced', invoice_id: INVOICE_ID },
      remaining: { count: 0, total: '0' },
    })
    const result = await revertOrderToScheduled(ORDER_ID)
    expect(result).toEqual({ success: true })
    expect(log.invoiceDeleted).toBe(true)
    expect(log.invoiceSet).toBeNull()
  })

  it('does not touch any invoice when reverting a cancelled order with none attached', async () => {
    const log = stubTransaction({ row: { status: 'cancelled', invoice_id: null } })
    const result = await revertOrderToScheduled(ORDER_ID)
    expect(result).toEqual({ success: true })
    expect(log.invoiceSet).toBeNull()
    expect(log.invoiceDeleted).toBe(false)
  })

  it('rejects an order that is already scheduled without writing anything', async () => {
    const log = stubTransaction({ row: { status: 'scheduled', invoice_id: null } })
    const result = await revertOrderToScheduled(ORDER_ID)
    expect(result).toEqual({ error: 'Order is already scheduled.' })
    expect(log.orderSet).toBeNull()
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('returns not-found when the order does not exist', async () => {
    stubTransaction({ row: null })
    const result = await revertOrderToScheduled(ORDER_ID)
    expect(result).toEqual({ error: 'Order not found.' })
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('rejects a malformed id before touching auth or the database', async () => {
    const result = await revertOrderToScheduled('not-a-uuid')
    expect(result).toEqual({ error: 'Invalid order id.' })
    expect(mockGetUser).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns not-signed-in without opening a transaction', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const result = await revertOrderToScheduled(ORDER_ID)
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns the generic message when the auth service itself fails, not a sign-in prompt', async () => {
    // The service being down is not a missing session — telling the salesperson
    // to sign in would send them to a login screen that cannot help (EH-02/04).
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: { status: 503, name: 'AuthApiError', message: 'service unavailable' },
    })
    const result = await revertOrderToScheduled(ORDER_ID)
    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('returns the generic message and logs context when the transaction throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockTransaction.mockRejectedValueOnce(new Error('deadlock detected'))
    const result = await revertOrderToScheduled(ORDER_ID)
    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(mockRevalidatePath).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      'revertOrderToScheduled: failed',
      expect.objectContaining({ orderId: ORDER_ID }),
    )
    consoleError.mockRestore()
  })
})
