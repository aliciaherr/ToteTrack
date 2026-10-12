import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CandidateRow } from '@/db/queries/customer-match'
import { DatabaseError } from '@/lib/errors'
import { makePo } from '@/lib/checks/__tests__/fixtures'
import { ADDRESS_BOOST, MAX_CUSTOMER_CANDIDATES, NAME_IN_ADDRESS_SIMILARITY_MIN } from '../matching.constants'
import { customerMatchFailures, matchCustomer } from '../match-customer'

vi.mock('@/db/queries/customer-match', () => ({ findCustomerCandidates: vi.fn() }))
const { findCustomerCandidates } = await import('@/db/queries/customer-match')
const findMock = vi.mocked(findCustomerCandidates)

function row(overrides: Partial<CandidateRow>): CandidateRow {
  return { customerId: 'c-1', status: 'active', nameScore: 0.5, addressScore: 0, nameInAddressScore: 0, exactName: false, ...overrides }
}

beforeEach(() => {
  findMock.mockReset()
})

describe('matchCustomer', () => {
  it('pre-fills the one customer whose normalised name is equal', async () => {
    findMock.mockResolvedValue([row({ customerId: 'exact', nameScore: 1, exactName: true }), row({ customerId: 'near' })])
    const match = await matchCustomer(makePo())
    expect(match.prefillCustomerId).toBe('exact')
    expect(match.candidates.map((candidate) => candidate.customerId)).toEqual(['exact', 'near'])
  })

  it('does not pre-fill when two customers share the normalised name', async () => {
    findMock.mockResolvedValue([
      row({ customerId: 'a', nameScore: 1, exactName: true }),
      row({ customerId: 'b', nameScore: 1, exactName: true }),
    ])
    const match = await matchCustomer(makePo())
    expect(match.prefillCustomerId).toBeNull()
    expect(match.candidates).toHaveLength(2)
  })

  it('ranks fuzzy matches without pre-filling', async () => {
    findMock.mockResolvedValue([row({ customerId: 'low', nameScore: 0.4 }), row({ customerId: 'high', nameScore: 0.8 })])
    const match = await matchCustomer(makePo())
    expect(match.prefillCustomerId).toBeNull()
    expect(match.candidates.map((candidate) => candidate.customerId)).toEqual(['high', 'low'])
  })

  it('lists an address-only match but never pre-fills it, even alone', async () => {
    findMock.mockResolvedValue([row({ customerId: 'addr', nameScore: 0, addressScore: 0.9 })])
    const match = await matchCustomer(makePo())
    expect(match.prefillCustomerId).toBeNull()
    expect(match.candidates).toEqual([
      { customerId: 'addr', score: ADDRESS_BOOST, nameScore: 0, nameInAddress: false, addressMatched: true, status: 'active' },
    ])
  })

  it('lists a customer whose saved address contains the name, ranked by that score, never pre-filled', async () => {
    findMock.mockResolvedValue([
      row({ customerId: 'nickname', nameScore: 0.1, nameInAddressScore: 0.95 }),
      row({ customerId: 'fuzzy', nameScore: 0.6 }),
    ])
    const match = await matchCustomer(makePo())
    expect(match.prefillCustomerId).toBeNull()
    expect(match.candidates[0]).toMatchObject({ customerId: 'nickname', score: 0.95, nameInAddress: true })
  })

  it('ignores a name-in-address score below the threshold', async () => {
    findMock.mockResolvedValue([row({ nameScore: 0.4, nameInAddressScore: NAME_IN_ADDRESS_SIMILARITY_MIN - 0.01 })])
    const match = await matchCustomer(makePo())
    expect(match.candidates[0]).toMatchObject({ score: 0.4, nameInAddress: false })
  })

  it('lets an address match lift a weaker name above a stronger one', async () => {
    findMock.mockResolvedValue([
      row({ customerId: 'name-only', nameScore: 0.6 }),
      row({ customerId: 'name-and-address', nameScore: 0.5, addressScore: 0.7 }),
    ])
    const match = await matchCustomer(makePo())
    expect(match.candidates[0].customerId).toBe('name-and-address')
  })

  it('keeps inactive customers and labels them', async () => {
    findMock.mockResolvedValue([row({ customerId: 'dormant', status: 'inactive' })])
    const match = await matchCustomer(makePo())
    expect(match.candidates[0].status).toBe('inactive')
  })

  it('caps the list at MAX_CUSTOMER_CANDIDATES, best first', async () => {
    const rows = Array.from({ length: MAX_CUSTOMER_CANDIDATES + 2 }, (_, index) =>
      row({ customerId: `c-${index}`, nameScore: 0.3 + index / 100 }),
    )
    findMock.mockResolvedValue(rows)
    const match = await matchCustomer(makePo())
    expect(match.candidates).toHaveLength(MAX_CUSTOMER_CANDIDATES)
    expect(match.candidates[0].customerId).toBe(`c-${MAX_CUSTOMER_CANDIDATES + 1}`)
  })

  it('returns no candidates without querying when name and ship-to are both missing', async () => {
    const po = makePo({ customerName: { value: '  ', quote: '' }, shipToAddress: { value: null, quote: '' } })
    expect(await matchCustomer(po)).toEqual({ prefillCustomerId: null, candidates: [] })
    expect(findMock).not.toHaveBeenCalled()
  })

  it('passes trimmed inputs, and null for a missing one', async () => {
    findMock.mockResolvedValue([])
    await matchCustomer(makePo({ customerName: { value: ' Acme ', quote: 'Acme' }, shipToAddress: { value: null, quote: '' } }))
    expect(findMock).toHaveBeenCalledWith('Acme', null)
  })

  it('throws the DatabaseError rather than returning an empty match', async () => {
    findMock.mockRejectedValue(new DatabaseError('findCustomerCandidates', 'Failed to score customers against a PO'))
    await expect(matchCustomer(makePo())).rejects.toBeInstanceOf(DatabaseError)
  })
})

describe('customerMatchFailures', () => {
  const candidate = { customerId: 'c-1', score: 0.5, nameScore: 0.5, nameInAddress: false, addressMatched: false, status: 'active' as const }

  it('returns nothing when a customer is pre-filled', () => {
    expect(customerMatchFailures({ prefillCustomerId: 'c-1', candidates: [candidate] })).toEqual([])
  })

  it('flags no_customer_match when there are no candidates', () => {
    const [failure] = customerMatchFailures({ prefillCustomerId: null, candidates: [] })
    expect(failure.check).toBe('no_customer_match')
    expect(failure.field).toBe('customerName')
  })

  it('flags ambiguous_customer with a count, and no customer text, when nothing is pre-filled', () => {
    const failures = customerMatchFailures({ prefillCustomerId: null, candidates: [candidate, { ...candidate, customerId: 'c-2' }] })
    expect(failures).toEqual([
      { check: 'ambiguous_customer', field: 'customerName', detail: '2 possible customer(s); none matched the name exactly' },
    ])
  })
})
