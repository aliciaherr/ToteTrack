import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.hoisted(() => vi.fn())
const mockTransaction = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
const mockDeleteRoot = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
  }),
}))

vi.mock('@/db', () => ({
  db: {
    transaction: mockTransaction,
    select: mockSelect,
    delete: mockDeleteRoot,
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }))

import { createCustomer, updateCustomer, deleteCustomer } from '../customers'

const AUTH_OK = { data: { user: { id: 'user-1' } }, error: null }

const VALID_CUSTOMER = {
  company_name: 'Acme Industrial',
  contacts: [
    {
      name: 'Jane Doe',
      role: 'Operations Manager',
      email: 'jane@acme.example',
      phone: '555-0100',
      is_primary: true,
    },
  ],
}

const CUSTOMER_ID = '11111111-1111-1111-1111-111111111111'

function stubTransactionReturning(id: string) {
  mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
    const tx = {
      insert: () => ({
        values: () => ({
          returning: () => Promise.resolve([{ id }]),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Promise.resolve(undefined),
        }),
      }),
      delete: () => ({
        where: () => Promise.resolve(undefined),
      }),
    }
    return await fn(tx)
  })
}

interface CapturedWrites {
  insertValues: unknown[]
  updateSets: unknown[]
}

// Like stubTransactionReturning, but records every insert values / update set
// payload so tests can assert on exactly what would be written.
function stubTransactionCapturing(id: string): CapturedWrites {
  const captured: CapturedWrites = { insertValues: [], updateSets: [] }
  mockTransaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
    const tx = {
      insert: () => ({
        values: (values: unknown) => {
          captured.insertValues.push(values)
          return { returning: () => Promise.resolve([{ id }]) }
        },
      }),
      update: () => ({
        set: (set: unknown) => {
          captured.updateSets.push(set)
          return { where: () => Promise.resolve(undefined) }
        },
      }),
      delete: () => ({
        where: () => Promise.resolve(undefined),
      }),
    }
    return await fn(tx)
  })
  return captured
}

function stubOrderCount(count: number) {
  mockSelect.mockReturnValueOnce({
    from: () => ({
      where: () => Promise.resolve([{ count }]),
    }),
  })
}

function stubRootDelete() {
  mockDeleteRoot.mockReturnValueOnce({
    where: () => Promise.resolve(undefined),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue(AUTH_OK)
})

describe('createCustomer', () => {
  it('creates the customer and returns the new id on success', async () => {
    stubTransactionReturning(CUSTOMER_ID)
    const result = await createCustomer(VALID_CUSTOMER)
    expect(result).toEqual({ id: CUSTOMER_ID })
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockRevalidatePath).toHaveBeenCalledWith('/customers')
  })

  it('rejects when company_name is empty', async () => {
    const result = await createCustomer({ ...VALID_CUSTOMER, company_name: '' })
    expect(result).toEqual({ error: 'Company name is required.' })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('accepts a contact with no email and no phone (both optional)', async () => {
    mockTransaction.mockResolvedValueOnce({ id: '11111111-1111-1111-1111-111111111111' })
    const result = await createCustomer({
      ...VALID_CUSTOMER,
      contacts: [
        {
          name: 'Jane Doe',
          role: null,
          email: null,
          phone: null,
          is_primary: true,
        },
      ],
    })
    expect(result).toEqual({ id: '11111111-1111-1111-1111-111111111111' })
    expect(mockTransaction).toHaveBeenCalled()
  })

  it('never writes the deprecated default_delivery_address column (Feature 14)', async () => {
    const captured = stubTransactionCapturing(CUSTOMER_ID)
    const result = await createCustomer({
      ...VALID_CUSTOMER,
      // Stale clients may still send the field; the schema must strip it.
      default_delivery_address: '123 Legacy Ln',
    } as Parameters<typeof createCustomer>[0])
    expect(result).toEqual({ id: CUSTOMER_ID })
    expect(captured.insertValues.length).toBeGreaterThan(0)
    expect(captured.insertValues[0]).not.toHaveProperty('default_delivery_address')
  })

  it('rejects when no contact is marked primary', async () => {
    const result = await createCustomer({
      ...VALID_CUSTOMER,
      contacts: [{ ...VALID_CUSTOMER.contacts[0], is_primary: false }],
    })
    expect(result).toEqual({ error: 'Exactly one contact must be marked as primary.' })
  })

  it('rejects when the user is not authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const result = await createCustomer(VALID_CUSTOMER)
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

describe('updateCustomer', () => {
  it('updates the customer and returns success', async () => {
    stubTransactionReturning(CUSTOMER_ID)
    const result = await updateCustomer(CUSTOMER_ID, VALID_CUSTOMER)
    expect(result).toEqual({ success: true })
    expect(mockTransaction).toHaveBeenCalledOnce()
    expect(mockRevalidatePath).toHaveBeenCalledWith('/customers')
  })

  it('never writes the deprecated default_delivery_address column (Feature 14)', async () => {
    const captured = stubTransactionCapturing(CUSTOMER_ID)
    const result = await updateCustomer(CUSTOMER_ID, VALID_CUSTOMER)
    expect(result).toEqual({ success: true })
    expect(captured.updateSets.length).toBeGreaterThan(0)
    expect(captured.updateSets[0]).not.toHaveProperty('default_delivery_address')
  })

  it('rejects a malformed customer id before touching the database', async () => {
    const result = await updateCustomer('not-a-uuid', VALID_CUSTOMER)
    expect(result).toEqual({ error: 'Invalid customer id.' })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('rejects when the user is not authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const result = await updateCustomer(CUSTOMER_ID, VALID_CUSTOMER)
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

describe('deleteCustomer', () => {
  it('rejects when the customer has any orders', async () => {
    stubOrderCount(3)
    const result = await deleteCustomer(CUSTOMER_ID)
    expect(result).toEqual({
      error: 'Cannot delete a customer with order history. Set them to Inactive instead.',
    })
    expect(mockDeleteRoot).not.toHaveBeenCalled()
  })

  it('succeeds when the customer has zero orders', async () => {
    stubOrderCount(0)
    stubRootDelete()
    const result = await deleteCustomer(CUSTOMER_ID)
    expect(result).toEqual({ success: true })
    expect(mockDeleteRoot).toHaveBeenCalledOnce()
    expect(mockRevalidatePath).toHaveBeenCalledWith('/customers')
  })

  it('rejects a malformed customer id before touching the database', async () => {
    const result = await deleteCustomer('not-a-uuid')
    expect(result).toEqual({ error: 'Invalid customer id.' })
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('rejects when the user is not authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const result = await deleteCustomer(CUSTOMER_ID)
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('returns a user-facing error and logs context when the query fails', async () => {
    mockSelect.mockReturnValueOnce({
      from: () => ({
        where: () => Promise.reject(new Error('connection terminated')),
      }),
    })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await deleteCustomer(CUSTOMER_ID)
    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
