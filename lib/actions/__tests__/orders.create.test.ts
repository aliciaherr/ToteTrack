import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockAddressBelongs = vi.hoisted(() => vi.fn())
const mockRecordUsage = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())

vi.mock('@/db', () => ({ db: {} }))
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }))
vi.mock('../orders.addresses', () => ({
  addressBelongsToCustomer: mockAddressBelongs,
  recordDeliveryAddressUsage: mockRecordUsage,
}))

import {
  ADDRESS_NOT_OWNED_MESSAGE,
  ORDER_REVALIDATE_PATHS,
  afterOrderCreated,
  checkAddressOwnership,
  insertOrderRow,
  isUniqueViolation,
  type OrderExecutor,
} from '../orders.create'
import { createOrderInputSchema, type ValidatedCreate } from '../orders.validation'

const ORDER_ID = '33333333-3333-3333-3333-333333333333'
const CUSTOMER_ID = '22222222-2222-2222-2222-222222222222'
const ADDRESS_ID = '55555555-5555-5555-5555-555555555555'

// 10 × $25 = $250.00, delivered to typed text.
const DATA: ValidatedCreate = createOrderInputSchema.parse({
  po_number: 'PO-9001',
  customer_id: CUSTOMER_ID,
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
  requested_delivery_date: '2026-05-01',
  backhaul: false,
  notes: null,
})

/**
 * Fake executor whose insert chain records the `.values(...)` payload and
 * resolves (or rejects) `.returning(...)`. Cast once: tests only need the
 * one chain `insertOrderRow` calls.
 */
function fakeExecutor(result: Promise<{ id: string }[]>) {
  const captured: { values: Record<string, unknown> | null } = { values: null }
  const executor = {
    insert: () => ({
      values: (payload: Record<string, unknown>) => {
        captured.values = payload
        return { returning: () => result }
      },
    }),
  } as unknown as OrderExecutor
  return { executor, captured }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('isUniqueViolation', () => {
  it('is true for a Postgres 23505 error', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
  })

  it('is true when drizzle wraps the Postgres error on .cause', () => {
    const wrapped = new Error('DrizzleQueryError', { cause: { code: '23505' } })
    expect(isUniqueViolation(wrapped)).toBe(true)
  })

  it('is false for other codes, non-objects and null', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false)
    expect(isUniqueViolation(new Error('boom'))).toBe(false)
    expect(isUniqueViolation('23505')).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
  })
})

describe('checkAddressOwnership', () => {
  it('returns null when the picked address belongs to the customer', async () => {
    mockAddressBelongs.mockResolvedValueOnce(true)
    const result = await checkAddressOwnership({ ...DATA, delivery_address_id: ADDRESS_ID })
    expect(result).toBeNull()
    expect(mockAddressBelongs).toHaveBeenCalledWith(ADDRESS_ID, CUSTOMER_ID)
  })

  it('returns the not-owned message for a foreign address id', async () => {
    mockAddressBelongs.mockResolvedValueOnce(false)
    const result = await checkAddressOwnership({ ...DATA, delivery_address_id: ADDRESS_ID })
    expect(result).toBe(ADDRESS_NOT_OWNED_MESSAGE)
  })

  it('skips the lookup when the customer collects or no id was picked', async () => {
    const collects = { ...DATA, customer_collects: true, delivery_address_id: ADDRESS_ID }
    expect(await checkAddressOwnership(collects)).toBeNull()
    expect(await checkAddressOwnership(DATA)).toBeNull()
    expect(mockAddressBelongs).not.toHaveBeenCalled()
  })

  it('propagates a lookup failure to the caller', async () => {
    mockAddressBelongs.mockRejectedValueOnce(new Error('db down'))
    await expect(
      checkAddressOwnership({ ...DATA, delivery_address_id: ADDRESS_ID }),
    ).rejects.toThrow('db down')
  })
})

describe('insertOrderRow', () => {
  it('inserts the normalized row with extra columns merged over it', async () => {
    const { executor, captured } = fakeExecutor(Promise.resolve([{ id: ORDER_ID }]))
    const result = await insertOrderRow(executor, DATA, {
      document_url: 'po-documents/abc.pdf',
    })
    expect(result).toEqual({ id: ORDER_ID })
    expect(captured.values).toMatchObject({
      po_number: 'PO-9001',
      customer_id: CUSTOMER_ID,
      document_url: 'po-documents/abc.pdf',
    })
  })

  it('lets extra override a normalized column', async () => {
    const { executor, captured } = fakeExecutor(Promise.resolve([{ id: ORDER_ID }]))
    await insertOrderRow(executor, DATA, { notes: 'from review' })
    expect(captured.values?.notes).toBe('from review')
  })

  it('rethrows a unique violation for the caller to map', async () => {
    const duplicate = { code: '23505' }
    const { executor } = fakeExecutor(Promise.reject(duplicate))
    await expect(insertOrderRow(executor, DATA)).rejects.toBe(duplicate)
  })
})

describe('afterOrderCreated', () => {
  const CONTEXT = { operation: 'createOrder' }

  it('revalidates /customers and every order path when the address book changed', async () => {
    mockRecordUsage.mockResolvedValueOnce(true)
    await afterOrderCreated(DATA, ORDER_ID, CONTEXT)
    expect(mockRecordUsage).toHaveBeenCalledWith(DATA, ORDER_ID)
    expect(mockRevalidatePath.mock.calls.map(([path]) => path)).toEqual([
      '/customers',
      ...ORDER_REVALIDATE_PATHS,
    ])
  })

  it('skips /customers when the address book was not written', async () => {
    mockRecordUsage.mockResolvedValueOnce(false)
    await afterOrderCreated(DATA, ORDER_ID, CONTEXT)
    expect(mockRevalidatePath.mock.calls.map(([path]) => path)).toEqual([
      ...ORDER_REVALIDATE_PATHS,
    ])
  })

  it('revalidates /customers when the caller changed the customers list', async () => {
    mockRecordUsage.mockResolvedValueOnce(false)
    await afterOrderCreated(DATA, ORDER_ID, { ...CONTEXT, customersChanged: true })
    expect(mockRevalidatePath).toHaveBeenCalledWith('/customers')
  })

  // The contract changed: the order row already exists, so a post-commit
  // failure is logged here (EH-04) and never reaches the caller, which would
  // otherwise report a failed create for a PO that was saved.
  it('logs a revalidation failure with the caller and ids, and does not throw', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRecordUsage.mockResolvedValueOnce(false)
    mockRevalidatePath.mockImplementationOnce(() => {
      throw new Error('revalidate failed')
    })
    await expect(
      afterOrderCreated(DATA, ORDER_ID, { operation: 'approveReviewPo', poId: 'po-1' }),
    ).resolves.toBeUndefined()
    expect(consoleSpy).toHaveBeenCalledWith('approveReviewPo: order created, but the post-commit step failed', {
      poId: 'po-1',
      orderId: ORDER_ID,
      failure: expect.objectContaining({ error: 'Error' }),
    })
    consoleSpy.mockRestore()
  })

  it('logs no PO id when the caller has none', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRecordUsage.mockRejectedValueOnce(new Error('connection reset'))
    await afterOrderCreated(DATA, ORDER_ID, CONTEXT)
    expect(consoleSpy).toHaveBeenCalledWith('createOrder: order created, but the post-commit step failed', {
      orderId: ORDER_ID,
      failure: expect.objectContaining({ error: 'Error' }),
    })
    consoleSpy.mockRestore()
  })
})
