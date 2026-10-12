import { inspect } from 'node:util'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { DrizzleQueryError, type SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())
const mockTransaction = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute, transaction: mockTransaction } }))

import { stageEmailWithPos, stagedUidsAbove, type InsertInboundEmailInput } from '../inbound-emails'
import type { InsertInboundPoInput } from '../inbound-pos'
import { DatabaseError } from '@/lib/errors'

const dialect = new PgDialect()

const EMAIL_ID = '11111111-1111-1111-1111-111111111111'
const ORIGINAL_PO_ID = '33333333-3333-3333-3333-333333333333'

// Placeholder sender only — never a real customer or the ADMIN_EMAIL account
// (CONSTRAINT-04).
const SAMPLE_EMAIL: InsertInboundEmailInput = {
  uid_validity: 7,
  uid: 42,
  message_id: '<abc-123@mail.example.com>',
  classification: 'po_found',
  from_address: 'buyer@example.com',
  subject: 'PO 4471',
  received_at: new Date('2026-10-06T14:05:00.000Z'),
}

function po(hash: string): InsertInboundPoInput {
  return { source_kind: 'pdf', document_path: `po-documents/${hash}.pdf`, body_text: null, content_hash: hash }
}

/**
 * A fake transaction: records every insert payload, answers the duplicate
 * lookup from `existingByHash`, and hands out sequential ids.
 */
function fakeTx(existingByHash: Record<string, string> = {}) {
  const inserts: Record<string, unknown>[] = []
  const lookups: string[] = []
  const tx = {
    insert: () => ({
      values: (payload: Record<string, unknown>) => {
        inserts.push(payload)
        return { returning: () => Promise.resolve([{ id: inserts.length === 1 ? EMAIL_ID : `po-${inserts.length - 1}` }]) }
      },
    }),
    execute: async (query: SQL) => {
      const hash = dialect.sqlToQuery(query).params[0] as string
      lookups.push(hash)
      return existingByHash[hash] ? [{ id: existingByHash[hash] }] : []
    },
  }
  mockTransaction.mockImplementationOnce(async (run: (handle: typeof tx) => unknown) => run(tx))
  return { inserts, lookups }
}

/** The driver error postgres-js raises, wrapped the way drizzle 0.45 wraps it. */
function wrappedUniqueViolation(constraint: string): DrizzleQueryError {
  const driver = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint_name: constraint,
  })
  return new DrizzleQueryError('insert into "inbound_emails" ...', [], driver)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('stageEmailWithPos', () => {
  it('inserts the email and every PO row in one transaction', async () => {
    const { inserts } = fakeTx()

    const result = await stageEmailWithPos(SAMPLE_EMAIL, [po('a'.repeat(64)), po('b'.repeat(64))])

    expect(result).toEqual({ id: EMAIL_ID, duplicatesFlagged: 0 })
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(inserts[0]).toEqual(SAMPLE_EMAIL)
    expect(inserts.slice(1)).toEqual([
      { ...po('a'.repeat(64)), inbound_email_id: EMAIL_ID, duplicate_of_id: null },
      { ...po('b'.repeat(64)), inbound_email_id: EMAIL_ID, duplicate_of_id: null },
    ])
  })

  it('flags a repeat hash against the original, never rejects it', async () => {
    const { inserts } = fakeTx({ ['a'.repeat(64)]: ORIGINAL_PO_ID })

    const result = await stageEmailWithPos(SAMPLE_EMAIL, [po('a'.repeat(64))])

    expect(result).toEqual({ id: EMAIL_ID, duplicatesFlagged: 1 })
    expect(inserts[1]).toMatchObject({ duplicate_of_id: ORIGINAL_PO_ID })
  })

  // Rows written in this transaction share one created_at, so the SQL ordering
  // could not tell the first sibling from the second.
  it('points a repeat sibling in the same email at the first sibling', async () => {
    const { inserts, lookups } = fakeTx()
    const hash = 'c'.repeat(64)

    const result = await stageEmailWithPos(SAMPLE_EMAIL, [po(hash), po(hash), po(hash)])

    expect(result).toEqual({ id: EMAIL_ID, duplicatesFlagged: 2 })
    expect(inserts[2]).toMatchObject({ duplicate_of_id: 'po-1' })
    expect(inserts[3]).toMatchObject({ duplicate_of_id: 'po-1' })
    expect(lookups).toEqual([hash])
  })

  // The re-run after a crash between staging and the watermark advance.
  it('returns { duplicate: true } when the UID marker is already staged', async () => {
    mockTransaction.mockRejectedValueOnce(
      wrappedUniqueViolation('inbound_emails_uid_validity_uid_unique'),
    )

    await expect(stageEmailWithPos(SAMPLE_EMAIL, [po('a'.repeat(64))])).resolves.toEqual({
      duplicate: true,
    })
  })

  it('throws on a unique violation of any other constraint', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockTransaction.mockRejectedValueOnce(wrappedUniqueViolation('some_other_unique'))

    await expect(stageEmailWithPos(SAMPLE_EMAIL, [])).rejects.toThrow(DatabaseError)
    consoleError.mockRestore()
  })

  it('logs UIDs and counts, never headers, and rethrows any other failure', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockTransaction.mockRejectedValueOnce(new Error('connection terminated'))

    await expect(stageEmailWithPos(SAMPLE_EMAIL, [po('a'.repeat(64))])).rejects.toThrow(
      DatabaseError,
    )

    const logged = consoleError.mock.calls[0]?.[1] as Record<string, unknown>
    expect(logged).toMatchObject({
      operation: 'stageEmailWithPos',
      uid_validity: 7,
      uid: 42,
      poCount: 1,
      error: 'Error',
    })
    expect(logged).not.toHaveProperty('cause')
    consoleError.mockRestore()
  })

  // MEDIUM-04. The real wrapper carries the bound params — sender, subject,
  // Message-ID — in both `.params` and its message. None may reach the log.
  it('keeps the params of a wrapped driver error out of the log sink', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const params = [SAMPLE_EMAIL.message_id, SAMPLE_EMAIL.from_address, SAMPLE_EMAIL.subject]
    const driver = Object.assign(new Error('invalid byte sequence for encoding "UTF8": 0x00'), {
      code: '22021',
    })
    mockTransaction.mockRejectedValueOnce(
      new DrizzleQueryError('insert into "inbound_emails" ...', params, driver),
    )

    await expect(stageEmailWithPos(SAMPLE_EMAIL, [])).rejects.toThrow(DatabaseError)

    const sink = inspect(consoleError.mock.calls, { depth: 10 })
    for (const header of params) expect(sink).not.toContain(header as string)
    expect(consoleError.mock.calls[0]?.[1]).toMatchObject({
      error: 'DrizzleQueryError > Error',
      code: '22021',
      constraint: null,
    })
    consoleError.mockRestore()
  })
})

describe('stagedUidsAbove', () => {
  it('returns the staged UIDs above the watermark for this UIDVALIDITY', async () => {
    // postgres-js returns bigint columns as strings through db.execute.
    mockExecute.mockResolvedValueOnce([{ uid: '43' }, { uid: '45' }])

    await expect(stagedUidsAbove(7, 42)).resolves.toEqual(new Set([43, 45]))

    const { sql: compiled, params } = dialect.sqlToQuery(mockExecute.mock.calls[0][0] as SQL)
    expect(compiled).toMatch(/e\.uid_validity = \$1 AND e\.uid > \$2/)
    expect(params).toEqual([7, 42])
    // A UID-only lookup: no header participates in admission (rule 1).
    expect(compiled).not.toMatch(/message_id/)
  })

  it('throws when the query fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExecute.mockRejectedValueOnce(new Error('connection terminated'))

    await expect(stagedUidsAbove(7, 42)).rejects.toThrow(DatabaseError)
    consoleError.mockRestore()
  })

  it('throws rather than admit on a value that is not a UID', async () => {
    mockExecute.mockResolvedValueOnce([{ uid: 'not-a-number' }])
    await expect(stagedUidsAbove(7, 42)).rejects.toThrow(/not a usable UID/)
  })
})
