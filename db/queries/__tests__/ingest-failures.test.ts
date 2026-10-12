import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import { clearFailures, clearOtherValidities, recordFailures } from '../ingest-failures'
import { DatabaseError } from '@/lib/errors'

const dialect = new PgDialect()
const NOW = new Date('2026-10-12T06:00:00.000Z')

function compiled(callIndex = 0): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(mockExecute.mock.calls[callIndex][0] as SQL)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('recordFailures', () => {
  it('upserts every UID and returns the post-increment rows as numbers', async () => {
    mockExecute.mockResolvedValueOnce([
      { uid_validity: '7', uid: '4', attempts: 3, first_failed_at: new Date('2026-10-12T04:00:00Z'), last_failed_at: NOW },
    ])

    await expect(recordFailures(7, [4], NOW)).resolves.toEqual([
      {
        uidValidity: 7,
        uid: 4,
        attempts: 3,
        firstFailedAt: new Date('2026-10-12T04:00:00Z'),
        lastFailedAt: NOW,
      },
    ])
    const query = compiled()
    expect(query.sql).toMatch(/ON CONFLICT \(uid_validity, uid\) DO UPDATE SET\s+attempts = ingest_uid_failures\.attempts \+ 1/)
    // `first_failed_at` is set on insert only, so the age runs from the first failure.
    expect(query.sql).not.toMatch(/first_failed_at = /)
    expect(query.params).toEqual([7, 4, NOW.toISOString(), NOW.toISOString()])
  })

  it('writes nothing for an empty list', async () => {
    await expect(recordFailures(7, [], NOW)).resolves.toEqual([])
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('throws DatabaseError naming the UIDs when the upsert fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExecute.mockRejectedValueOnce(new Error('connection terminated'))

    const failure = recordFailures(7, [4, 5], NOW)
    await expect(failure).rejects.toThrow(DatabaseError)
    await expect(failure).rejects.toThrow(/UIDs 4, 5/)
    expect(consoleError.mock.calls[0]?.[1]).toMatchObject({ operation: 'recordFailures', uids: [4, 5] })
    consoleError.mockRestore()
  })

  it('throws when a row reads back without a usable count', async () => {
    mockExecute.mockResolvedValueOnce([
      { uid_validity: '7', uid: '4', attempts: null, first_failed_at: NOW, last_failed_at: NOW },
    ])
    await expect(recordFailures(7, [4], NOW)).rejects.toThrow(/attempts/)
  })

  it('throws when a timestamp reads back unparseable rather than storing Invalid Date', async () => {
    mockExecute.mockResolvedValueOnce([
      { uid_validity: '7', uid: '4', attempts: 1, first_failed_at: 'garbage', last_failed_at: NOW },
    ])
    await expect(recordFailures(7, [4], NOW)).rejects.toThrow(/first_failed_at/)
  })
})

describe('clearFailures', () => {
  it('deletes the listed UIDs under one UIDVALIDITY', async () => {
    mockExecute.mockResolvedValueOnce([])

    await clearFailures(7, [4, 9])

    const query = compiled()
    expect(query.sql).toMatch(/DELETE FROM ingest_uid_failures\s+WHERE uid_validity = \$1 AND uid IN \(\$2, \$3\)/)
    expect(query.params).toEqual([7, 4, 9])
  })

  it('deletes nothing for an empty list', async () => {
    await clearFailures(7, [])
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('throws DatabaseError when the delete fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExecute.mockRejectedValueOnce(new Error('connection terminated'))
    await expect(clearFailures(7, [4])).rejects.toThrow(DatabaseError)
    consoleError.mockRestore()
  })
})

describe('clearOtherValidities', () => {
  it('deletes every row of another UIDVALIDITY', async () => {
    mockExecute.mockResolvedValueOnce([])

    await clearOtherValidities(7)

    expect(compiled().sql).toMatch(/DELETE FROM ingest_uid_failures WHERE uid_validity <> \$1/)
    expect(compiled().params).toEqual([7])
  })

  it('throws DatabaseError when the delete fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExecute.mockRejectedValueOnce(new Error('connection terminated'))
    await expect(clearOtherValidities(7)).rejects.toThrow(DatabaseError)
    consoleError.mockRestore()
  })
})
