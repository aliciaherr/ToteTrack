import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import { getCustomersForReview, getReviewSourceRow, listReviewQueueIds } from '../review-source'
import { DatabaseError } from '@/lib/errors'

const dialect = new PgDialect()
const PO_ID = '22222222-2222-2222-2222-222222222222'

function compileCall(callIndex: number): { sql: string; params: unknown[] } {
  const sqlArg = mockExecute.mock.calls[callIndex]?.[0] as SQL | undefined
  if (!sqlArg) throw new Error(`db.execute was not called ${callIndex + 1} time(s)`)
  return dialect.sqlToQuery(sqlArg)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('listReviewQueueIds', () => {
  // The ORDER BY itself is pinned in inbound-pos.test.ts, where the clause lives.
  it('returns ids from the review-queue filter, in the shared order', async () => {
    mockExecute.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])

    expect(await listReviewQueueIds()).toEqual(['a', 'b'])

    const { sql: compiled, params } = compileCall(0)
    expect(compiled).toMatch(/SELECT\s+p\.id\s+FROM inbound_pos p/i)
    expect(compiled).toMatch(/WHERE\s+p\.status IN \(\$1, \$2\)/i)
    expect(compiled).toMatch(/ORDER BY\s+p\.skipped_at ASC NULLS FIRST/i)
    expect(params).toEqual(['pending_review', 'extraction_failed'])
  })

  it('throws a DatabaseError when the query fails', async () => {
    mockExecute.mockRejectedValueOnce(new Error('connection refused'))

    await expect(listReviewQueueIds()).rejects.toBeInstanceOf(DatabaseError)
  })
})

describe('getReviewSourceRow', () => {
  it('joins the PO to its email by id and maps received_at to ISO', async () => {
    const receivedAt = new Date('2026-10-12T15:04:05Z')
    mockExecute.mockResolvedValueOnce([
      {
        id: PO_ID,
        source_kind: 'image',
        document_path: 'inbound/abc.jpg',
        body_text: null,
        check_results: null,
        duplicate_of_id: null,
        from_address: 'buyer@example.com',
        subject: 'PO 4471',
        received_at: receivedAt,
        message_id: '<m1@example.com>',
      },
    ])

    const row = await getReviewSourceRow(PO_ID)

    const { sql: compiled, params } = compileCall(0)
    expect(compiled).toMatch(/JOIN inbound_emails e ON e\.id = p\.inbound_email_id/i)
    expect(compiled).toMatch(/WHERE p\.id = \$1/i)
    expect(compiled).toMatch(/p\.duplicate_of_id/)
    expect(params).toEqual([PO_ID])
    expect(row).toMatchObject({ id: PO_ID, source_kind: 'image', received_at: '2026-10-12T15:04:05.000Z' })
  })

  it('keeps a NULL received_at as null', async () => {
    mockExecute.mockResolvedValueOnce([{ id: PO_ID, received_at: null }])

    expect((await getReviewSourceRow(PO_ID))?.received_at).toBeNull()
  })

  it('returns null when no PO has the id', async () => {
    mockExecute.mockResolvedValueOnce([])

    expect(await getReviewSourceRow(PO_ID)).toBeNull()
  })

  it('throws a DatabaseError naming the id, and logs only the id', async () => {
    mockExecute.mockRejectedValueOnce(new Error('relation does not exist'))

    await expect(getReviewSourceRow(PO_ID)).rejects.toThrow(new RegExp(PO_ID))
    expect(console.error).toHaveBeenCalledWith('getReviewSourceRow: query failed', {
      operation: 'getReviewSourceRow',
      poId: PO_ID,
    })
  })
})

describe('getCustomersForReview', () => {
  const CUSTOMER_ID = '33333333-3333-3333-3333-333333333333'

  it('returns [] without querying when there are no ids', async () => {
    expect(await getCustomersForReview([])).toEqual([])
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('loads the named customers, inactive included, with parsed addresses', async () => {
    mockExecute.mockResolvedValueOnce([
      { id: CUSTOMER_ID, company_name: 'Acme', status: 'inactive', addresses: [{ id: 'a1', address: '1 Main St' }] },
    ])

    const customers = await getCustomersForReview([CUSTOMER_ID])

    const { sql: compiled, params } = compileCall(0)
    expect(compiled).toMatch(/WHERE c\.id IN \(\$1::uuid\)/i)
    expect(compiled).not.toMatch(/c\.status = /i)
    expect(params).toEqual([CUSTOMER_ID])
    expect(customers).toEqual([
      { id: CUSTOMER_ID, company_name: 'Acme', status: 'inactive', addresses: [{ id: 'a1', address: '1 Main St' }] },
    ])
  })

  it('throws a DatabaseError and logs only the id count', async () => {
    mockExecute.mockRejectedValueOnce(new Error('connection refused'))

    await expect(getCustomersForReview([CUSTOMER_ID, PO_ID])).rejects.toBeInstanceOf(DatabaseError)
    expect(console.error).toHaveBeenCalledWith('getCustomersForReview: query failed', {
      operation: 'getCustomersForReview',
      idCount: 2,
    })
  })
})
