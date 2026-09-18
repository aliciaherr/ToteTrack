import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import { findOrdersByPoNumber, CALENDAR_SEARCH_LIMIT } from '../calendar'
import { DatabaseError } from '@/lib/errors'

const dialect = new PgDialect()

function compileLastCall(): { sql: string; params: unknown[] } {
  const calls = mockExecute.mock.calls
  const sqlArg = calls[calls.length - 1]?.[0] as SQL | undefined
  if (!sqlArg) throw new Error('db.execute was not called')
  return dialect.sqlToQuery(sqlArg)
}

const sampleHit = {
  id: '11111111-1111-1111-1111-111111111111',
  po_number: 'PO-2026-0412',
  customer_name: 'Acme Rebottling',
  production_date: '2026-07-27',
}

describe('findOrdersByPoNumber', () => {
  beforeEach(() => {
    mockExecute.mockReset()
  })

  it('returns the matching orders', async () => {
    mockExecute.mockResolvedValueOnce([sampleHit])

    await expect(findOrdersByPoNumber('0412')).resolves.toEqual({
      hits: [sampleHit],
      hasMore: false,
    })
  })

  it('matches anywhere in the PO number, not just the start', async () => {
    mockExecute.mockResolvedValueOnce([])

    await findOrdersByPoNumber('0412')

    const { sql, params } = compileLastCall()
    expect(sql).toContain('ILIKE')
    expect(params).toContain('%0412%')
  })

  it('binds the term as a parameter rather than interpolating it (SEC-02)', async () => {
    mockExecute.mockResolvedValueOnce([])

    await findOrdersByPoNumber("'; DROP TABLE orders; --")

    const { sql, params } = compileLastCall()
    expect(sql).not.toContain('DROP TABLE')
    expect(params).toContain("%'; DROP TABLE orders; --%")
  })

  it('excludes cancelled orders — they have no card to scroll to', async () => {
    mockExecute.mockResolvedValueOnce([])

    await findOrdersByPoNumber('0412')

    expect(compileLastCall().sql).toContain("status <> 'cancelled'")
  })

  it('asks for one row beyond the cap, to learn whether more matched', async () => {
    mockExecute.mockResolvedValueOnce([])

    await findOrdersByPoNumber('PO')

    expect(compileLastCall().params).toContain(CALENDAR_SEARCH_LIMIT + 1)
  })

  it('reports hasMore and drops the probe row when the cap bites', async () => {
    // Silently returning the alphabetically-first N of many is how someone
    // concludes their order does not exist.
    const many = Array.from({ length: CALENDAR_SEARCH_LIMIT + 1 }, (_, index) => ({
      ...sampleHit,
      id: `order-${index}`,
      po_number: `PO-${index}`,
    }))
    mockExecute.mockResolvedValueOnce(many)

    const result = await findOrdersByPoNumber('PO')

    expect(result.hits).toHaveLength(CALENDAR_SEARCH_LIMIT)
    expect(result.hasMore).toBe(true)
  })

  it('orders hits by PO number so typing narrows rather than reshuffles', async () => {
    mockExecute.mockResolvedValueOnce([])

    await findOrdersByPoNumber('PO')

    expect(compileLastCall().sql).toContain('ORDER BY')
    expect(compileLastCall().sql).toContain('o.po_number ASC')
  })

  it('returns an empty date for an undated order rather than omitting it', async () => {
    // An undated hit is still a hit — it lives in the callout, not a column.
    mockExecute.mockResolvedValueOnce([{ ...sampleHit, production_date: null }])

    const { hits } = await findOrdersByPoNumber('0412')

    expect(hits[0].production_date).toBeNull()
  })

  it('never issues a query for an empty term', async () => {
    // `%%` matches every order in the table, so an empty term has to be caught
    // before it becomes a pattern.
    await expect(findOrdersByPoNumber('   ')).resolves.toEqual({ hits: [], hasMore: false })

    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('wraps a query failure in a DatabaseError', async () => {
    mockExecute.mockRejectedValueOnce(new Error('connection reset'))

    await expect(findOrdersByPoNumber('0412')).rejects.toBeInstanceOf(DatabaseError)
  })
})
