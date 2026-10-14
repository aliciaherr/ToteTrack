import { inspect } from 'node:util'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { DrizzleQueryError, type SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import { makePo } from '@/lib/checks/__tests__/fixtures'
import { DatabaseError } from '@/lib/errors'
import {
  buildClaimBatchQuery,
  claimBatch,
  completeExtraction,
  failExtraction,
  LostClaimError,
  releaseForRetry,
} from '../extraction-queue'

const dialect = new PgDialect()
const ROW_ID = '33333333-3333-3333-3333-333333333333'
const NOW = new Date('2026-10-12T12:00:00.000Z')
const TIMING = { leaseMs: 5 * 60 * 1000, retryDelayMs: 2 * 60 * 1000 }
const RESULTS = { version: 1 as const, failures: [], quotes: [] }
const CLAIMED_AT = new Date('2026-10-12T11:59:00.000Z')
const CLAIM = { id: ROW_ID, extraction_started_at: CLAIMED_AT }
/** What a fenced write returns when it still held the row. */
const MATCHED = [{ id: ROW_ID }]
const FENCE = /WHERE id = \$\d+\s+AND status = 'extracting'\s+AND extraction_started_at = \$\d+::timestamptz\s+RETURNING id/i

function compiled(callIndex = 0): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(mockExecute.mock.calls[callIndex][0] as SQL)
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('buildClaimBatchQuery', () => {
  it('claims in one statement with SKIP LOCKED, counting the attempt and stamping the lease', () => {
    const { sql, params } = dialect.sqlToQuery(buildClaimBatchQuery(4, TIMING, NOW))

    expect(sql).toMatch(/^\s*WITH claimable AS MATERIALIZED \(/i)
    expect(sql).toMatch(/UPDATE inbound_pos p[\s\S]*FROM claimable\s+WHERE p\.id = claimable\.id/i)
    expect(sql).not.toMatch(/\bIN \(/i)
    expect(sql).toMatch(/FOR UPDATE SKIP LOCKED/i)
    expect(sql).toMatch(/attempt_count = p\.attempt_count \+ 1/i)
    expect(sql).toMatch(/extraction_started_at = \$4::timestamptz/i)
    expect(sql).toMatch(/ORDER BY q\.created_at ASC/i)
    expect(params).toEqual(['2026-10-12T11:58:00.000Z', '2026-10-12T11:55:00.000Z', 4, NOW.toISOString(), NOW.toISOString()])
  })

  it('reclaims only extracting rows past the lease, and lease-less ones', () => {
    const { sql } = dialect.sqlToQuery(buildClaimBatchQuery(4, TIMING, NOW))
    expect(sql).toMatch(/q\.status = 'extracting'\s+AND \(q\.extraction_started_at IS NULL OR q\.extraction_started_at < \$2::timestamptz\)/i)
  })

  it('holds a released row back until the retry delay has passed (MEDIUM-10)', () => {
    const { sql } = dialect.sqlToQuery(buildClaimBatchQuery(4, TIMING, NOW))
    expect(sql).toMatch(/q\.status = 'pending_extraction'\s+AND \(q\.extraction_started_at IS NULL OR q\.extraction_started_at < \$1::timestamptz\)/i)
  })
})

describe('claimBatch', () => {
  it('returns the claimed rows, each carrying the lease stamp the claim wrote', async () => {
    const row = { id: ROW_ID, source_kind: 'pdf', document_path: 'inbound/x.pdf', body_text: null, attempt_count: 1 }
    mockExecute.mockResolvedValueOnce([row])
    expect(await claimBatch(4, TIMING, NOW)).toEqual([{ ...row, extraction_started_at: NOW }])
  })

  it('throws a DatabaseError when the claim fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExecute.mockRejectedValueOnce(new Error('connection refused'))
    await expect(claimBatch(4, TIMING, NOW)).rejects.toBeInstanceOf(DatabaseError)
  })
})

describe('completeExtraction', () => {
  it('writes the extraction and results and moves the row to pending_review', async () => {
    mockExecute.mockResolvedValueOnce(MATCHED)
    const extracted = makePo()

    await completeExtraction(CLAIM, extracted, RESULTS)

    const { sql, params } = compiled()
    expect(sql).toMatch(/status = 'pending_review'/i)
    expect(sql).toMatch(/extraction_started_at = NULL/i)
    expect(sql).toMatch(FENCE)
    expect(params).toEqual([JSON.stringify(extracted), JSON.stringify(RESULTS), ROW_ID, CLAIMED_AT.toISOString()])
  })

  it('keeps document text out of the log and the thrown error (MEDIUM-08)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const marker = 'MARKER-EXTRACTED-VALUE'
    const driverError = Object.assign(new Error('boom'), { code: '23514' })
    mockExecute.mockRejectedValueOnce(new DrizzleQueryError('UPDATE inbound_pos …', [marker], driverError))

    const thrown = await completeExtraction(CLAIM, makePo(), RESULTS).catch((e: unknown) => e)

    expect(thrown).toBeInstanceOf(DatabaseError)
    expect(inspect(thrown, { depth: 10 })).not.toContain(marker)
    expect(inspect(consoleError.mock.calls, { depth: 10 })).not.toContain(marker)
    expect(String((thrown as DatabaseError).cause)).toContain('SQLSTATE 23514')
  })
})

describe('failExtraction', () => {
  it('parks the row at extraction_failed with its results', async () => {
    mockExecute.mockResolvedValueOnce(MATCHED)
    await failExtraction(CLAIM, RESULTS)
    const { sql, params } = compiled()
    expect(sql).toMatch(/status = 'extraction_failed'/i)
    expect(sql).toMatch(FENCE)
    expect(params).toEqual([JSON.stringify(RESULTS), ROW_ID, CLAIMED_AT.toISOString()])
  })

  it('throws a DatabaseError when the write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExecute.mockRejectedValueOnce(new Error('down'))
    await expect(failExtraction(CLAIM, RESULTS)).rejects.toBeInstanceOf(DatabaseError)
  })
})

describe('releaseForRetry', () => {
  it('returns the row to pending_extraction, stamped with the worker clock, not the DB clock', async () => {
    mockExecute.mockResolvedValueOnce(MATCHED)
    await releaseForRetry(CLAIM, NOW)
    const { sql, params } = compiled()
    expect(sql).toMatch(/status = 'pending_extraction'/i)
    expect(sql).toMatch(/extraction_started_at = \$1::timestamptz/i)
    expect(sql).not.toMatch(/now\(\)/i)
    expect(sql).toMatch(FENCE)
    expect(params).toEqual([NOW.toISOString(), NOW.toISOString(), ROW_ID, CLAIMED_AT.toISOString()])
  })

  it('throws a DatabaseError when the write fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExecute.mockRejectedValueOnce(new Error('down'))
    await expect(releaseForRetry(CLAIM, NOW)).rejects.toBeInstanceOf(DatabaseError)
  })
})

// A worker that outlived its lease must not move a row another worker took.
describe('fenced writes after a lost claim', () => {
  it.each([
    ['completeExtraction', () => completeExtraction(CLAIM, makePo(), RESULTS)],
    ['failExtraction', () => failExtraction(CLAIM, RESULTS)],
    ['releaseForRetry', () => releaseForRetry(CLAIM, NOW)],
  ])('%s throws LostClaimError and logs the row ID when no row matched', async (operation, write) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExecute.mockResolvedValueOnce([])

    const thrown = await write().catch((e: unknown) => e)

    expect(thrown).toBeInstanceOf(LostClaimError)
    expect(thrown).toMatchObject({ rowId: ROW_ID, operation })
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('lost the claim'), expect.objectContaining({ rowId: ROW_ID }))
  })
})
