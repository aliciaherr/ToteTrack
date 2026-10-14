import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import { buildPoByContentHashQuery, countUndecided } from '../inbound-pos'
// The queue's filter and order live here; the production reader is in review-source.ts.
import { listReviewQueueIds } from '../review-source'
import { DatabaseError } from '@/lib/errors'

const dialect = new PgDialect()

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

describe('review queue order (PENDING_REVIEW_ORDER_CLAUSE, via listReviewQueueIds)', () => {
  it('rotates skipped rows in skip order, failures first only among the unskipped (Task 120)', async () => {
    mockExecute.mockResolvedValueOnce([])
    await listReviewQueueIds()
    const { sql: compiled } = compileCall(0)

    const orderBy = compiled.slice(compiled.search(/ORDER BY/i))
    const skippedTerm = orderBy.search(/p\.skipped_at ASC NULLS FIRST/i)
    const failureBucket = orderBy.search(/CASE WHEN\s+CASE/i)
    const createdTerm = orderBy.search(/p\.created_at ASC/i)

    // All three sort terms present...
    expect(skippedTerm, 'skipped_at term missing from ORDER BY').toBeGreaterThan(-1)
    expect(failureBucket, 'check-failure bucket missing from ORDER BY').toBeGreaterThan(-1)
    expect(createdTerm, 'created_at tiebreak missing from ORDER BY').toBeGreaterThan(-1)
    // ...and in the specified precedence: skip order, then failures, then age.
    expect(skippedTerm).toBeLessThan(failureBucket)
    expect(failureBucket).toBeLessThan(createdTerm)
  })

  it('treats a failures array as a failure and never raises on another shape', async () => {
    mockExecute.mockResolvedValueOnce([])
    await listReviewQueueIds()
    const { sql: compiled } = compileCall(0)
    // jsonb_array_length raises on a non-array, so the type is tested first:
    // a NULL column, a missing key or an object must sort as "no failures"
    // rather than breaking the whole queue.
    expect(compiled).toMatch(/jsonb_typeof\(p\.check_results -> 'failures'\) = 'array'/i)
    expect(compiled).toMatch(/jsonb_array_length\(p\.check_results -> 'failures'\) > 0/i)
    expect(compiled).toMatch(/ELSE FALSE/i)
  })

  it('lists pending_review and extraction_failed rows, and never paginates', async () => {
    mockExecute.mockResolvedValueOnce([])
    await listReviewQueueIds()
    const { sql: compiled, params } = compileCall(0)
    expect(compiled).toMatch(/WHERE\s+p\.status IN \(\$1, \$2\)/i)
    expect(params).toEqual(['pending_review', 'extraction_failed'])
    expect(compiled).not.toMatch(/\bLIMIT\b|\bOFFSET\b/i)
  })
})

describe('countUndecided', () => {
  it('splits the undecided rows into to-review and being-read in one query', async () => {
    mockExecute.mockResolvedValueOnce([{ to_review: 4, being_read: 2 }])
    await expect(countUndecided()).resolves.toEqual({ toReview: 4, beingRead: 2 })

    const { sql: compiled, params } = compileCall(0)
    expect(compiled).toMatch(/COUNT\(\*\) FILTER \(WHERE\s+p\.status IN \(\$1, \$2\)\)::int AS to_review/i)
    expect(compiled).toMatch(/COUNT\(\*\) FILTER \(WHERE\s+p\.status IN \(\$3, \$4\)\)::int AS being_read/i)
    expect(params).toEqual(['pending_review', 'extraction_failed', 'pending_extraction', 'extracting'])
  })

  it('a query failure is logged with context and rethrown as DatabaseError', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExecute.mockRejectedValueOnce(new Error('connection terminated'))

    await expect(countUndecided()).rejects.toThrow(DatabaseError)
    const logged = consoleError.mock.calls[0]?.[1] as Record<string, unknown>
    expect(logged.operation).toBe('countUndecided')
    // SEC-05: the raw error never reaches the log, only its safe summary.
    expect(logged).not.toHaveProperty('cause')
    expect(logged.failure).toMatchObject({ error: 'Error' })
    consoleError.mockRestore()
  })

  it('throws DatabaseError when a count reads back as something else', async () => {
    mockExecute.mockResolvedValueOnce([{ to_review: 'many', being_read: 0 }])
    await expect(countUndecided()).rejects.toThrow(/to_review read back as many/)
  })
})
