import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())
const mockInsert = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute, insert: mockInsert } }))

import {
  insertInboundEmail,
  insertInboundPo,
  findPoByContentHash,
  listPendingReview,
  countPendingReview,
} from '../inbound'
import { DatabaseError } from '@/lib/errors'

const dialect = new PgDialect()

const EMAIL_ID = '11111111-1111-1111-1111-111111111111'
const PO_ID = '22222222-2222-2222-2222-222222222222'
const ORIGINAL_PO_ID = '33333333-3333-3333-3333-333333333333'

// Placeholder sender only — never a real customer or the ADMIN_EMAIL account
// (CONSTRAINT-04). Matches the `user@example.com` convention the auth tests use.
const SAMPLE_EMAIL = {
  message_id: '<abc-123@mail.example.com>',
  classification: 'po_found' as const,
  from_address: 'buyer@example.com',
  subject: 'PO 4471',
  received_at: new Date('2026-10-06T14:05:00.000Z'),
}

const SAMPLE_PO = {
  inbound_email_id: EMAIL_ID,
  source_kind: 'pdf' as const,
  document_path: 'po-documents/2026/10/abc.pdf',
  content_hash: 'a'.repeat(64),
  duplicate_of_id: null,
}

function compileCall(callIndex: number): { sql: string; params: unknown[] } {
  const sqlArg = mockExecute.mock.calls[callIndex]?.[0] as SQL | undefined
  if (!sqlArg) throw new Error(`db.execute was not called ${callIndex + 1} time(s)`)
  return dialect.sqlToQuery(sqlArg)
}

// Captures the last `.values(...)` payload so a test can assert what would be
// written without running a real query — the `lib/actions/pickups.ts` test
// pattern. Reset by each stub so one assertion never reads another's payload.
let lastInsertValues: Record<string, unknown> | null = null

function stubInsertReturning(id: string) {
  lastInsertValues = null
  mockInsert.mockReturnValueOnce({
    values: (payload: Record<string, unknown>) => {
      lastInsertValues = payload
      return { returning: () => Promise.resolve([{ id }]) }
    },
  })
}

function stubInsertRejects(cause: unknown) {
  lastInsertValues = null
  mockInsert.mockReturnValueOnce({
    values: (payload: Record<string, unknown>) => {
      lastInsertValues = payload
      return { returning: () => Promise.reject(cause) }
    },
  })
}

/** Driver-shaped unique violation: SQLSTATE 23505, as postgres-js reports it. */
function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  lastInsertValues = null
})

describe('insertInboundEmail', () => {
  it('creates the row and returns its id', async () => {
    stubInsertReturning(EMAIL_ID)
    const result = await insertInboundEmail(SAMPLE_EMAIL)
    expect(result).toEqual({ id: EMAIL_ID })
    expect(mockInsert).toHaveBeenCalledOnce()
    expect(lastInsertValues).toEqual(SAMPLE_EMAIL)
  })

  it('a repeat message_id returns { duplicate: true } and does not throw', async () => {
    stubInsertRejects(uniqueViolation())
    const result = await insertInboundEmail(SAMPLE_EMAIL)
    // The discriminated return IS the report — the caller has to branch on it,
    // so this is a handled outcome, not a swallowed error.
    expect(result).toEqual({ duplicate: true })
  })

  it('any other insert failure is logged with context and rethrown', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubInsertRejects(new Error('connection terminated'))

    await expect(insertInboundEmail(SAMPLE_EMAIL)).rejects.toThrow(DatabaseError)

    const logged = consoleError.mock.calls[0]?.[1] as Record<string, unknown>
    expect(logged.operation).toBe('insertInboundEmail')
    expect(logged.message_id).toBe(SAMPLE_EMAIL.message_id)
    consoleError.mockRestore()
  })
})

describe('insertInboundPo', () => {
  it('stages the candidate and returns its id', async () => {
    stubInsertReturning(PO_ID)
    const result = await insertInboundPo(SAMPLE_PO)
    expect(result).toEqual({ id: PO_ID })
    expect(lastInsertValues).toEqual(SAMPLE_PO)
  })

  it('a repeat content_hash still inserts — duplicates are queued, not rejected', async () => {
    stubInsertReturning(PO_ID)
    const duplicate = { ...SAMPLE_PO, duplicate_of_id: ORIGINAL_PO_ID }
    await expect(insertInboundPo(duplicate)).resolves.toEqual({ id: PO_ID })
    expect(lastInsertValues).toMatchObject({ duplicate_of_id: ORIGINAL_PO_ID })
  })

  it('status and attempt_count are left to the column defaults', async () => {
    stubInsertReturning(PO_ID)
    await insertInboundPo(SAMPLE_PO)
    expect(lastInsertValues).not.toHaveProperty('status')
    expect(lastInsertValues).not.toHaveProperty('attempt_count')
  })

  it('an insert failure is logged with context and rethrown as DatabaseError', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubInsertRejects(new Error('connection terminated'))

    await expect(insertInboundPo(SAMPLE_PO)).rejects.toThrow(DatabaseError)

    const logged = consoleError.mock.calls[0]?.[1] as Record<string, unknown>
    expect(logged.operation).toBe('insertInboundPo')
    expect(logged.inbound_email_id).toBe(EMAIL_ID)
    consoleError.mockRestore()
  })
})

describe('findPoByContentHash', () => {
  it('returns the earliest matching row so duplicate_of_id names the original', async () => {
    mockExecute.mockResolvedValueOnce([{ id: ORIGINAL_PO_ID }])
    await expect(findPoByContentHash(SAMPLE_PO.content_hash)).resolves.toEqual({
      id: ORIGINAL_PO_ID,
    })

    const { sql: compiled, params } = compileCall(0)
    expect(params).toContain(SAMPLE_PO.content_hash)
    expect(compiled).toMatch(/ORDER BY\s+p\.created_at ASC/i)
    expect(compiled).toMatch(/LIMIT 1/i)
  })

  it('returns null when the hash has never been seen', async () => {
    mockExecute.mockResolvedValueOnce([])
    await expect(findPoByContentHash('b'.repeat(64))).resolves.toBeNull()
  })
})

describe('listPendingReview', () => {
  it('sorts check-failures ahead of clean rows, and skipped rows last', async () => {
    mockExecute.mockResolvedValueOnce([])
    await listPendingReview()
    const { sql: compiled } = compileCall(0)

    const orderBy = compiled.slice(compiled.search(/ORDER BY/i))
    const failureBucket = orderBy.search(/CASE WHEN\s+CASE/i)
    const skippedTerm = orderBy.search(/p\.skipped_at ASC NULLS FIRST/i)
    const createdTerm = orderBy.search(/p\.created_at ASC/i)

    // All three sort terms present...
    expect(failureBucket, 'check-failure bucket missing from ORDER BY').toBeGreaterThan(-1)
    expect(skippedTerm, 'skipped_at NULLS FIRST missing from ORDER BY').toBeGreaterThan(-1)
    expect(createdTerm, 'created_at tiebreak missing from ORDER BY').toBeGreaterThan(-1)
    // ...and in the specified precedence: failures, then skipped, then age.
    expect(failureBucket).toBeLessThan(skippedTerm)
    expect(skippedTerm).toBeLessThan(createdTerm)
  })

  it('treats a failures array as a failure and never raises on another shape', async () => {
    mockExecute.mockResolvedValueOnce([])
    await listPendingReview()
    const { sql: compiled } = compileCall(0)
    // jsonb_array_length raises on a non-array, so the type is tested first:
    // a NULL column, a missing key or an object must sort as "no failures"
    // rather than breaking the whole queue.
    expect(compiled).toMatch(/jsonb_typeof\(p\.check_results -> 'failures'\) = 'array'/i)
    expect(compiled).toMatch(/jsonb_array_length\(p\.check_results -> 'failures'\) > 0/i)
    expect(compiled).toMatch(/ELSE FALSE/i)
  })

  it('filters to pending_review only and never paginates', async () => {
    mockExecute.mockResolvedValueOnce([])
    await listPendingReview()
    const { sql: compiled, params } = compileCall(0)
    expect(compiled).toMatch(/WHERE\s+p\.status = /i)
    expect(params).toContain('pending_review')
    expect(compiled).not.toMatch(/\bLIMIT\b|\bOFFSET\b/i)
  })

  it('returns the rows the driver gives back', async () => {
    const row = { id: PO_ID, status: 'pending_review', skipped_at: null }
    mockExecute.mockResolvedValueOnce([row])
    await expect(listPendingReview()).resolves.toEqual([row])
  })

  it('a query failure is logged with context and rethrown as DatabaseError', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExecute.mockRejectedValueOnce(new Error('connection terminated'))

    await expect(listPendingReview()).rejects.toThrow(DatabaseError)

    const logged = consoleError.mock.calls[0]?.[1] as Record<string, unknown>
    expect(logged.operation).toBe('listPendingReview')
    consoleError.mockRestore()
  })
})

describe('countPendingReview', () => {
  it('returns the count from a dedicated COUNT query, not the full rows', async () => {
    mockExecute.mockResolvedValueOnce([{ count: 7 }])
    await expect(countPendingReview()).resolves.toBe(7)

    const { sql: compiled, params } = compileCall(0)
    expect(compiled).toMatch(/COUNT\(\*\)::int AS count/i)
    expect(compiled).not.toMatch(/p\.extracted/i)
    // Same status as listPendingReview — the badge and the list cannot drift.
    expect(params).toContain('pending_review')
  })

  it('returns 0 when the queue is empty', async () => {
    mockExecute.mockResolvedValueOnce([])
    await expect(countPendingReview()).resolves.toBe(0)
  })

  it('a query failure is logged with context and rethrown as DatabaseError', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExecute.mockRejectedValueOnce(new Error('connection terminated'))

    await expect(countPendingReview()).rejects.toThrow(DatabaseError)

    const logged = consoleError.mock.calls[0]?.[1] as Record<string, unknown>
    expect(logged.operation).toBe('countPendingReview')
    consoleError.mockRestore()
  })
})
