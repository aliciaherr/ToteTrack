import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'

const mockExecute = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { execute: mockExecute } }))

import { findCustomerCandidates } from '../customer-match'
import { DatabaseError } from '@/lib/errors'
import {
  ADDRESS_SIMILARITY_MIN,
  NAME_IN_ADDRESS_SIMILARITY_MIN,
  NAME_SIMILARITY_MIN,
} from '@/lib/matching/matching.constants'

const dialect = new PgDialect()

function compiled(): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(mockExecute.mock.calls[0][0] as SQL)
}

const goodRow = { customer_id: 'c-1', status: 'active', name_score: 0.75, address_score: '0', name_in_address_score: 0.2, exact_name: false }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('findCustomerCandidates', () => {
  it('binds the inputs and thresholds as parameters, never into the SQL text', async () => {
    mockExecute.mockResolvedValueOnce([goodRow])
    await findCustomerCandidates("O'Brien; DROP TABLE customers", '1 Main St')
    const query = compiled()
    expect(query.params).toEqual(["O'Brien; DROP TABLE customers", '1 Main St', NAME_SIMILARITY_MIN, ADDRESS_SIMILARITY_MIN, NAME_IN_ADDRESS_SIMILARITY_MIN])
    expect(query.sql).not.toMatch(/O'Brien|Main St/)
    expect(query.sql).toMatch(/extensions\.similarity/)
    expect(query.sql).toMatch(/extensions\.word_similarity/)
  })

  it('reads rows back as numbers and booleans', async () => {
    mockExecute.mockResolvedValueOnce([goodRow])
    await expect(findCustomerCandidates('Acme', null)).resolves.toEqual([
      { customerId: 'c-1', status: 'active', nameScore: 0.75, addressScore: 0, nameInAddressScore: 0.2, exactName: false },
    ])
  })

  it('throws a DatabaseError that does not name the inputs when the query fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockExecute.mockRejectedValueOnce(new Error('function extensions.similarity does not exist'))
    const failure = findCustomerCandidates('Secret Customer Name', null)
    await expect(failure).rejects.toBeInstanceOf(DatabaseError)
    await expect(failure).rejects.not.toThrow(/Secret Customer Name/)
  })

  it('throws on a malformed row instead of trusting it', async () => {
    mockExecute.mockResolvedValueOnce([{ ...goodRow, name_score: 'NaN' }])
    await expect(findCustomerCandidates('Acme', null)).rejects.toThrow(/name_score read back as NaN/)
    mockExecute.mockResolvedValueOnce([{ ...goodRow, status: 'archived' }])
    await expect(findCustomerCandidates('Acme', null)).rejects.toThrow(/status read back as archived/)
  })
})
