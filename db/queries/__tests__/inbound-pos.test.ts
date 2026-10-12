import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import { buildPoByContentHashQuery, countPendingReview, listPendingReview } from '../inbound-pos'
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
})

describe('buildPoByContentHashQuery', () => {
  it('selects the earliest row carrying the hash, so duplicate_of_id names the original', () => {
    const hash = 'a'.repeat(64)
    const { sql: compiled, params } = dialect.sqlToQuery(buildPoByContentHashQuery(hash))
    expect(params).toEqual([hash])
    expect(compiled).toMatch(/WHERE p\.content_hash = \$1/i)
    expect(compiled).toMatch(/ORDER BY\s+p\.created_at ASC/i)
    expect(compiled).toMatch(/LIMIT 1/i)
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
