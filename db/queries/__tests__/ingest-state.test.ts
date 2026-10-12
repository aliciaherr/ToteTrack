import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import { readIngestState, writeIngestState } from '../ingest-state'
import { DatabaseError } from '@/lib/errors'

const dialect = new PgDialect()

function compiled(callIndex = 0): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(mockExecute.mock.calls[callIndex][0] as SQL)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('readIngestState', () => {
  it('returns the stored watermark with bigint strings read back as numbers', async () => {
    mockExecute.mockResolvedValueOnce([
      { mailbox: 'INBOX', uid_validity: '7', last_uid: '42', last_run_at: '2026-10-12T06:00:00.000Z' },
    ])

    await expect(readIngestState('INBOX')).resolves.toEqual({
      mailbox: 'INBOX',
      uidValidity: 7,
      lastUid: 42,
      lastRunAt: new Date('2026-10-12T06:00:00.000Z'),
    })
    expect(compiled().params).toEqual(['INBOX'])
  })

  it('returns null before the first run has written a row', async () => {
    mockExecute.mockResolvedValueOnce([])
    await expect(readIngestState('INBOX')).resolves.toBeNull()
  })

  // L-14: the watermark becomes part of an IMAP command, so a corrupted value
  // is refused here rather than interpolated there.
  it('throws on a stored watermark that is not a usable integer', async () => {
    mockExecute.mockResolvedValueOnce([
      { mailbox: 'INBOX', uid_validity: '7', last_uid: '1:*', last_run_at: null },
    ])
    await expect(readIngestState('INBOX')).rejects.toThrow(/last_uid/)
  })

  it('throws DatabaseError when the query fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExecute.mockRejectedValueOnce(new Error('connection terminated'))

    await expect(readIngestState('INBOX')).rejects.toThrow(DatabaseError)
    expect((consoleError.mock.calls[0]?.[1] as Record<string, unknown>).operation).toBe(
      'readIngestState',
    )
    consoleError.mockRestore()
  })
})

describe('writeIngestState', () => {
  const STATE = {
    mailbox: 'INBOX',
    uidValidity: 7,
    lastUid: 42,
    lastRunAt: new Date('2026-10-12T06:00:00.000Z'),
  }

  it('upserts the full state keyed by mailbox', async () => {
    mockExecute.mockResolvedValueOnce([])

    await writeIngestState(STATE)

    const { sql, params } = compiled()
    expect(sql).toMatch(/INSERT INTO ingest_mailbox_state/)
    expect(sql).toMatch(/ON CONFLICT \(mailbox\) DO UPDATE SET/)
    expect(params).toEqual(['INBOX', 7, 42, '2026-10-12T06:00:00.000Z'])
  })

  it('throws DatabaseError when the upsert fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExecute.mockRejectedValueOnce(new Error('connection terminated'))

    await expect(writeIngestState(STATE)).rejects.toThrow(DatabaseError)
    consoleError.mockRestore()
  })
})
