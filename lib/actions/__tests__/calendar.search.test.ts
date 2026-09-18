import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.hoisted(() => vi.fn())
const mockFindOrdersByPoNumber = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: mockGetUser } }),
}))

vi.mock('@/db/queries/calendar', () => ({
  findOrdersByPoNumber: mockFindOrdersByPoNumber,
}))

import { searchCalendarOrders } from '../calendar.search'
import { PO_NUMBER_MAX } from '../orders.validation'
import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'

const sampleHit = {
  id: '11111111-1111-1111-1111-111111111111',
  po_number: 'PO-2026-0412',
  customer_name: 'Acme Rebottling',
  production_date: '2026-07-27',
}

function signedIn() {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
}

describe('searchCalendarOrders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    signedIn()
  })

  it('returns the hits for a term', async () => {
    mockFindOrdersByPoNumber.mockResolvedValueOnce({ hits: [sampleHit], hasMore: false })

    await expect(searchCalendarOrders('0412')).resolves.toEqual({
      hits: [sampleHit],
      hasMore: false,
    })
  })

  it('passes the cap signal through, so the box can say more matched', async () => {
    mockFindOrdersByPoNumber.mockResolvedValueOnce({ hits: [sampleHit], hasMore: true })

    await expect(searchCalendarOrders('PO')).resolves.toEqual({
      hits: [sampleHit],
      hasMore: true,
    })
  })

  it('returns an empty hit list rather than an error when nothing matches', async () => {
    // A miss is an answer, not a failure — the caller turns it into "No order
    // matching …", which an `{ error }` would render as a system problem.
    mockFindOrdersByPoNumber.mockResolvedValueOnce({ hits: [], hasMore: false })

    await expect(searchCalendarOrders('nope')).resolves.toEqual({ hits: [], hasMore: false })
  })

  it('trims the term before searching', async () => {
    mockFindOrdersByPoNumber.mockResolvedValueOnce({ hits: [], hasMore: false })

    await searchCalendarOrders('  0412  ')

    expect(mockFindOrdersByPoNumber).toHaveBeenCalledWith('0412')
  })

  it('rejects an empty term without touching the database', async () => {
    const result = await searchCalendarOrders('   ')

    expect(result).toEqual({ error: 'Type a PO number to search.' })
    expect(mockFindOrdersByPoNumber).not.toHaveBeenCalled()
  })

  it('rejects a term longer than a PO number can be', async () => {
    const result = await searchCalendarOrders('x'.repeat(PO_NUMBER_MAX + 1))

    expect(result).toEqual({ error: `Search for ${PO_NUMBER_MAX} characters or fewer.` })
    expect(mockFindOrdersByPoNumber).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })

    const result = await searchCalendarOrders('0412')

    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockFindOrdersByPoNumber).not.toHaveBeenCalled()
  })

  it('reports a query failure instead of rejecting', async () => {
    // A rejected promise here would surface as an unhandled rejection in the
    // header with nothing to explain it, so the failure comes back as a value.
    mockFindOrdersByPoNumber.mockRejectedValueOnce(new Error('connection reset'))

    await expect(searchCalendarOrders('0412')).resolves.toEqual({
      error: GENERIC_FAILURE_MESSAGE,
    })
  })
})
