import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import { lockReviewRow, markApproved, markDiscarded, markSkipped, reactivateCustomer } from '../review-decisions'
import { DatabaseError } from '@/lib/errors'
import type { CreateOrderInput } from '@/lib/actions/orders.validation'

const dialect = new PgDialect()
const PO_ID = '22222222-2222-2222-2222-222222222222'
const ORDER_ID = '44444444-4444-4444-4444-444444444444'
const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333'
// The form is customer data; only its shape matters here, never its logging.
const CONFIRMED = { po_number: 'PO-9001', notes: 'leave at dock 4' } as unknown as CreateOrderInput

/** A transaction stand-in: raw SQL via `execute`, and drizzle's update chain. */
function fakeTx() {
  const returning = vi.fn()
  const where = vi.fn(() => ({ returning }))
  const set = vi.fn(() => ({ where }))
  const tx = { execute: vi.fn(), update: vi.fn(() => ({ set })) }
  return { tx, returning, set }
}

type Tx = Parameters<typeof lockReviewRow>[0]

function compiled(execute: ReturnType<typeof vi.fn>): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(execute.mock.calls[0]?.[0] as SQL)
}

/** The first `console.error` context: it must hold only ids (SEC-05). */
function loggedContext(): Record<string, unknown> {
  return vi.mocked(console.error).mock.calls[0]?.[1] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('lockReviewRow', () => {
  it('locks a queued row and returns its document path', async () => {
    const { tx } = fakeTx()
    tx.execute.mockResolvedValueOnce([{ document_path: 'inbound/abc.pdf' }])

    expect(await lockReviewRow(tx as unknown as Tx, PO_ID)).toEqual({ documentPath: 'inbound/abc.pdf' })
    const query = compiled(tx.execute)
    expect(query.sql).toMatch(/WHERE p\.id = \$1 AND p\.status IN \(\$2, \$3\)\s+FOR UPDATE/i)
    expect(query.params).toEqual([PO_ID, 'pending_review', 'extraction_failed'])
  })

  it('returns null when the PO has left the queue', async () => {
    const { tx } = fakeTx()
    tx.execute.mockResolvedValueOnce([])
    expect(await lockReviewRow(tx as unknown as Tx, PO_ID)).toBeNull()
  })

  it('wraps a query failure in DatabaseError and logs only the id', async () => {
    const { tx } = fakeTx()
    tx.execute.mockRejectedValueOnce(new Error('lock timeout'))

    await expect(lockReviewRow(tx as unknown as Tx, PO_ID)).rejects.toThrow(DatabaseError)
    expect(loggedContext()).toEqual({ operation: 'lockReviewRow', poId: PO_ID })
  })
})

describe('markApproved', () => {
  it('marks the row approved, linked to its order, with the form stored verbatim', async () => {
    const { tx } = fakeTx()
    tx.execute.mockResolvedValueOnce([{ id: PO_ID }])

    await expect(markApproved(tx as unknown as Tx, PO_ID, ORDER_ID, CONFIRMED)).resolves.toBeUndefined()
    const query = compiled(tx.execute)
    expect(query.sql).toMatch(/SET status = 'approved', order_id = \$1, confirmed = \$2::jsonb/i)
    expect(query.params.slice(0, 3)).toEqual([ORDER_ID, JSON.stringify(CONFIRMED), PO_ID])
  })

  it('wraps a query failure in DatabaseError and logs only the id', async () => {
    const { tx } = fakeTx()
    tx.execute.mockRejectedValueOnce(new Error('connection reset'))

    await expect(markApproved(tx as unknown as Tx, PO_ID, ORDER_ID, CONFIRMED)).rejects.toThrow(DatabaseError)
    expect(loggedContext()).toEqual({ operation: 'markApproved', poId: PO_ID })
  })

  it('throws when no queued row matched, so the transaction rolls back', async () => {
    const { tx } = fakeTx()
    tx.execute.mockResolvedValueOnce([])

    await expect(markApproved(tx as unknown as Tx, PO_ID, ORDER_ID, CONFIRMED)).rejects.toThrow(
      /was not in the review queue/,
    )
    expect(vi.mocked(console.error).mock.calls[0]?.[0]).toBe('markApproved: no queued row matched')
    expect(loggedContext()).toEqual({ operation: 'markApproved', poId: PO_ID })
  })
})

describe('reactivateCustomer', () => {
  it('returns true when an inactive customer was reactivated', async () => {
    const { tx, returning, set } = fakeTx()
    returning.mockResolvedValueOnce([{ id: CUSTOMER_ID }])

    expect(await reactivateCustomer(tx as unknown as Tx, CUSTOMER_ID)).toBe(true)
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }))
  })

  it('returns false when the customer was already active', async () => {
    const { tx, returning } = fakeTx()
    returning.mockResolvedValueOnce([])
    expect(await reactivateCustomer(tx as unknown as Tx, CUSTOMER_ID)).toBe(false)
  })

  it('wraps a query failure in DatabaseError and logs only the customer id', async () => {
    const { tx, returning } = fakeTx()
    returning.mockRejectedValueOnce(new Error('connection reset'))

    await expect(reactivateCustomer(tx as unknown as Tx, CUSTOMER_ID)).rejects.toThrow(DatabaseError)
    expect(loggedContext()).toEqual({ operation: 'reactivateCustomer', customerId: CUSTOMER_ID })
  })
})

describe.each([
  { name: 'markSkipped', write: markSkipped, set: /SET skipped_at = now\(\), updated_at = now\(\)/i },
  { name: 'markDiscarded', write: markDiscarded, set: /SET status = 'discarded', updated_at = now\(\)/i },
])('$name', ({ name, write, set }) => {
  it('writes the queued row and returns true', async () => {
    mockExecute.mockResolvedValueOnce([{ id: PO_ID }])

    expect(await write(PO_ID)).toBe(true)
    const query = compiled(mockExecute)
    expect(query.sql).toMatch(set)
    expect(query.sql).toMatch(/WHERE p\.id = \$1 AND p\.status IN \(\$2, \$3\)/i)
    expect(query.params).toEqual([PO_ID, 'pending_review', 'extraction_failed'])
  })

  it('returns false when the PO was already decided', async () => {
    mockExecute.mockResolvedValueOnce([])
    expect(await write(PO_ID)).toBe(false)
  })

  it('wraps a query failure in DatabaseError and logs only the id', async () => {
    mockExecute.mockRejectedValueOnce(new Error('connection reset'))

    await expect(write(PO_ID)).rejects.toThrow(DatabaseError)
    expect(loggedContext()).toEqual({ operation: name, poId: PO_ID })
  })
})
