import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import { getTickets, getTicketDetail } from '../support'
import { DatabaseError, TicketNotFoundError } from '@/lib/errors'

const dialect = new PgDialect()

function compileLastCall(): { sql: string; params: unknown[] } {
  const lastIndex = mockExecute.mock.calls.length - 1
  const sqlArg = mockExecute.mock.calls[lastIndex]?.[0] as SQL | undefined
  if (!sqlArg) throw new Error('db.execute was not called')
  return dialect.sqlToQuery(sqlArg)
}

const TICKET_ID = '44444444-4444-4444-4444-444444444444'

const sampleListRow = {
  id: TICKET_ID,
  title: 'Cannot save a new lead',
  category: 'bug' as const,
  priority: 'high' as const,
  status: 'open' as const,
  created_at: '2026-04-21T10:00:00Z',
}

const sampleDetailHeader = {
  id: TICKET_ID,
  title: 'Cannot save a new lead',
  category: 'bug' as const,
  priority: 'high' as const,
  description: 'Clicking Save Lead throws a 500 from the server.',
  status: 'open' as const,
  developer_notes: null,
  created_at: '2026-04-21T10:00:00Z',
}

const sampleAttachment = {
  id: '55555555-5555-5555-5555-555555555555',
  file_name: 'screenshot.png',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getTickets', () => {
  it('returns the ticket rows on success', async () => {
    mockExecute.mockResolvedValueOnce([sampleListRow])
    const result = await getTickets()
    expect(result).toEqual([sampleListRow])
    expect(mockExecute).toHaveBeenCalledOnce()
  })

  it('sorts by created_at DESC so the newest ticket appears first', async () => {
    mockExecute.mockResolvedValueOnce([])
    await getTickets()
    const compiled = compileLastCall()
    expect(compiled.sql).toMatch(/order\s+by[^;]*created_at\s+desc/i)
  })

  it('returns an empty array (not an error) when there are no tickets', async () => {
    mockExecute.mockResolvedValueOnce([])
    const result = await getTickets()
    expect(result).toEqual([])
  })

  it('throws DatabaseError with operation context when the underlying query fails', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValueOnce(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let caught: unknown
    try {
      await getTickets()
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()
    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({ operation: 'getTickets', cause: driverError })
  })
})

describe('getTicketDetail', () => {
  it('returns the ticket header plus every attachment row', async () => {
    mockExecute
      .mockResolvedValueOnce([sampleDetailHeader])
      .mockResolvedValueOnce([sampleAttachment])

    const detail = await getTicketDetail(TICKET_ID)

    expect(detail).toEqual({ ...sampleDetailHeader, attachments: [sampleAttachment] })
  })

  it('returns an empty attachments array when the ticket has none', async () => {
    mockExecute
      .mockResolvedValueOnce([sampleDetailHeader])
      .mockResolvedValueOnce([])

    const detail = await getTicketDetail(TICKET_ID)

    expect(detail.attachments).toEqual([])
  })

  it('sorts attachments by created_at ASC', async () => {
    mockExecute
      .mockResolvedValueOnce([sampleDetailHeader])
      .mockResolvedValueOnce([])

    await getTicketDetail(TICKET_ID)

    const compiled = compileLastCall()
    expect(compiled.sql).toMatch(/order\s+by[^;]*created_at\s+asc/i)
  })

  it('throws TicketNotFoundError when the header query returns zero rows', async () => {
    mockExecute
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    let caught: unknown
    try {
      await getTicketDetail(TICKET_ID)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(TicketNotFoundError)
    expect((caught as TicketNotFoundError).ticketId).toBe(TICKET_ID)
  })

  it('wraps driver errors as DatabaseError without swallowing the cause', async () => {
    const driverError = new Error('connection terminated')
    mockExecute.mockRejectedValue(driverError)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let caught: unknown
    try {
      await getTicketDetail(TICKET_ID)
    } catch (error) {
      caught = error
    }
    consoleSpy.mockRestore()
    expect(caught).toBeInstanceOf(DatabaseError)
    expect(caught).toMatchObject({ operation: 'getTicketDetail', cause: driverError })
  })
})
