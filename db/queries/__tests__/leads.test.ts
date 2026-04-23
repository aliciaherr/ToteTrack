import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import { getLeads, getLeadDetail, getLeadNotes } from '../leads'
import { DatabaseError, LeadNotFoundError } from '@/lib/errors'

const dialect = new PgDialect()

function compileLastCall(): { sql: string; params: unknown[] } {
  const sqlArg = mockExecute.mock.calls[0]?.[0] as SQL | undefined
  if (!sqlArg) throw new Error('db.execute was not called')
  return dialect.sqlToQuery(sqlArg)
}

function sampleLead(status: string, next_follow_up_date: string | null) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Jane Smith',
    company: 'Acme Corp',
    status,
    next_follow_up_date,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getLeads', () => {
  it('returns rows from the database when no filters are provided', async () => {
    const row = sampleLead('warm', '2026-05-10')
    mockExecute.mockResolvedValueOnce([row])
    const result = await getLeads()
    expect(result).toEqual([row])
    expect(mockExecute).toHaveBeenCalledOnce()
  })

  it('never includes converted leads in the query (status != converted hardcoded)', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getLeads()
    const { sql } = compileLastCall()
    expect(sql).toMatch(/status != 'converted'/i)
  })

  it("filters by status='hot' when requested", async () => {
    mockExecute.mockResolvedValueOnce([])
    await getLeads({ status: 'hot' })
    const { sql, params } = compileLastCall()
    expect(params).toContain('hot')
    // Should NOT include a warm or cold param
    expect(params).not.toContain('warm')
    expect(params).not.toContain('cold')
  })

  it("does not add a status clause for status='all'", async () => {
    mockExecute.mockResolvedValueOnce([])
    await getLeads({ status: 'all' })
    const { params } = compileLastCall()
    expect(params).not.toContain('hot')
    expect(params).not.toContain('warm')
    expect(params).not.toContain('cold')
  })

  it('adds ILIKE search clause when search is provided', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getLeads({ search: 'acme' })
    const { sql, params } = compileLastCall()
    expect(sql).toMatch(/ilike/i)
    expect(params.some((p) => String(p).includes('acme'))).toBe(true)
  })

  it('trims whitespace from search term before building clause', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getLeads({ search: '  acme  ' })
    const { params } = compileLastCall()
    expect(params.some((p) => String(p) === '%acme%')).toBe(true)
  })

  it('omits search clause when search is empty string', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getLeads({ search: '' })
    const { sql } = compileLastCall()
    expect(sql).not.toMatch(/ilike/i)
  })

  it('orders by next_follow_up_date ASC NULLS LAST', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getLeads()
    const { sql } = compileLastCall()
    expect(sql).toMatch(/next_follow_up_date.*asc.*nulls last/i)
  })

  it('throws DatabaseError when the query rejects', async () => {
    mockExecute.mockRejectedValueOnce(new Error('connection refused'))
    await expect(getLeads()).rejects.toBeInstanceOf(DatabaseError)
  })
})

const LEAD_ID = '22222222-2222-2222-2222-222222222222'

const sampleDetail = {
  id: LEAD_ID,
  name: 'Jane Smith',
  title: 'Procurement Manager',
  company: 'Acme Corp',
  email: 'jane@acme.com',
  phone: '555-1234',
  status: 'warm',
  lead_source: 'Referral',
  next_follow_up_date: '2026-05-15',
  next_action_type: 'call',
  updated_at: '2026-04-20T10:00:00Z',
}

describe('getLeadDetail', () => {
  it('returns the lead detail row when found', async () => {
    mockExecute.mockResolvedValueOnce([sampleDetail])
    const result = await getLeadDetail(LEAD_ID)
    expect(result).toEqual(sampleDetail)
  })

  it('throws LeadNotFoundError when no row is returned', async () => {
    mockExecute.mockResolvedValueOnce([])
    await expect(getLeadDetail(LEAD_ID)).rejects.toBeInstanceOf(LeadNotFoundError)
  })

  it('throws DatabaseError when the query rejects', async () => {
    mockExecute.mockRejectedValueOnce(new Error('timeout'))
    await expect(getLeadDetail(LEAD_ID)).rejects.toBeInstanceOf(DatabaseError)
  })
})

describe('getLeadNotes', () => {
  it('returns notes sorted by created_at ASC', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getLeadNotes(LEAD_ID)
    const { sql } = compileLastCall()
    expect(sql).toMatch(/order by created_at asc/i)
  })

  it('returns the notes array on success', async () => {
    const notes = [
      { id: 'n1', content: 'First note', created_at: '2026-04-01T10:00:00Z' },
      { id: 'n2', content: 'Second note', created_at: '2026-04-02T10:00:00Z' },
    ]
    mockExecute.mockResolvedValueOnce(notes)
    const result = await getLeadNotes(LEAD_ID)
    expect(result).toEqual(notes)
  })

  it('throws DatabaseError when the query rejects', async () => {
    mockExecute.mockRejectedValueOnce(new Error('connection lost'))
    await expect(getLeadNotes(LEAD_ID)).rejects.toBeInstanceOf(DatabaseError)
  })
})
