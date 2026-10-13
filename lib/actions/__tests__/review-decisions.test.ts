import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetUser = vi.hoisted(() => vi.fn())
const mockTransaction = vi.hoisted(() => vi.fn())
const mockAddressBelongs = vi.hoisted(() => vi.fn())
const mockMarkSkipped = vi.hoisted(() => vi.fn())
const mockMarkDiscarded = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: { transaction: mockTransaction } }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ auth: { getUser: mockGetUser } }) }))
vi.mock('../orders.addresses', () => ({
  addressBelongsToCustomer: mockAddressBelongs,
  recordDeliveryAddressUsage: vi.fn(),
}))
vi.mock('@/db/queries/review-decisions', () => ({
  lockReviewRow: vi.fn(),
  markApproved: vi.fn(),
  reactivateCustomer: vi.fn(),
  markSkipped: mockMarkSkipped,
  markDiscarded: mockMarkDiscarded,
}))

import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'
import * as decisionActions from '../review-decisions'
import { approveReviewPo, discardReviewPo, skipReviewPo } from '../review-decisions'
import { ADDRESS_NOT_OWNED_MESSAGE } from '../orders.create'
import type { CreateOrderInput } from '../orders.validation'

const PO_ID = '22222222-2222-2222-2222-222222222222'
const AUTH_OK = { data: { user: { id: 'user-1' } }, error: null }
const NO_SESSION = { data: { user: null }, error: null }
const ALREADY_HANDLED = 'This PO was already handled.'

// 10 × $25, to a saved address.
const INPUT: CreateOrderInput = {
  po_number: 'PO-9001',
  customer_id: '33333333-3333-3333-3333-333333333333',
  qty_275_recon: 0,
  qty_275_rebot: 10,
  qty_275_new: 0,
  qty_330_recon: 0,
  qty_330_rebot: 0,
  qty_330_new: 0,
  unit_price_275_recon: null,
  unit_price_275_rebot: 25,
  unit_price_275_new: null,
  unit_price_330_recon: null,
  unit_price_330_rebot: null,
  unit_price_330_new: null,
  customer_collects: false,
  delivery_address: '123 Main Street',
  delivery_address_id: '55555555-5555-5555-5555-555555555555',
  requested_delivery_date: '2026-05-01',
  backhaul: false,
  notes: null,
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockGetUser.mockResolvedValue(AUTH_OK)
})

afterEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

describe('module surface (SEC-08)', () => {
  it('exports only the three actions', () => {
    expect(Object.keys(decisionActions).sort()).toEqual(['approveReviewPo', 'discardReviewPo', 'skipReviewPo'])
  })
})

describe('approveReviewPo', () => {
  it('refuses without a session, before anything else (SEC-04)', async () => {
    mockGetUser.mockResolvedValue(NO_SESSION)
    expect(await approveReviewPo('not-a-uuid', INPUT)).toEqual({ error: 'You are not signed in.' })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('refuses a non-UUID id before any query (SEC-02)', async () => {
    expect(await approveReviewPo('1 OR 1=1', INPUT)).toEqual({ error: 'Invalid PO id.' })
    expect(mockAddressBelongs).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('refuses an invalid form with the schema message', async () => {
    const result = await approveReviewPo(PO_ID, { ...INPUT, po_number: '' })
    expect(result).toHaveProperty('error')
    expect(result).not.toEqual({ error: GENERIC_FAILURE_MESSAGE })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it("refuses a saved address that is not the customer's, before the transaction (SEC-03)", async () => {
    mockAddressBelongs.mockResolvedValue(false)
    expect(await approveReviewPo(PO_ID, INPUT)).toEqual({ error: ADDRESS_NOT_OWNED_MESSAGE })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns the generic message and logs only the PO id when the transaction fails', async () => {
    mockAddressBelongs.mockResolvedValue(true)
    mockTransaction.mockRejectedValue(new Error('connection reset'))
    expect(await approveReviewPo(PO_ID, INPUT)).toEqual({ error: GENERIC_FAILURE_MESSAGE })
    expect(console.error).toHaveBeenCalledWith(
      'approveReviewPo: could not approve the PO',
      expect.objectContaining({ poId: PO_ID }),
    )
  })
})

describe.each([
  { name: 'skipReviewPo', action: skipReviewPo, write: mockMarkSkipped },
  { name: 'discardReviewPo', action: discardReviewPo, write: mockMarkDiscarded },
])('$name', ({ action, write }) => {
  it('decides a queued PO', async () => {
    write.mockResolvedValue(true)
    expect(await action(PO_ID)).toEqual({ success: true })
    expect(write).toHaveBeenCalledWith(PO_ID)
  })

  it('reports a PO that was already decided', async () => {
    write.mockResolvedValue(false)
    expect(await action(PO_ID)).toEqual({ error: ALREADY_HANDLED })
  })

  it('refuses a non-UUID id before any query (SEC-02)', async () => {
    expect(await action('nope')).toEqual({ error: 'Invalid PO id.' })
    expect(write).not.toHaveBeenCalled()
  })

  it('refuses without a session (SEC-04)', async () => {
    mockGetUser.mockResolvedValue(NO_SESSION)
    expect(await action(PO_ID)).toEqual({ error: 'You are not signed in.' })
    expect(write).not.toHaveBeenCalled()
  })

  it('returns the generic message when the write fails', async () => {
    write.mockRejectedValue(new Error('db down'))
    expect(await action(PO_ID)).toEqual({ error: GENERIC_FAILURE_MESSAGE })
  })
})
