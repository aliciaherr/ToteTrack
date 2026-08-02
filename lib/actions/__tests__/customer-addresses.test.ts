import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
const mockInsert = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockDelete = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: mockGetUser } }),
}))

vi.mock('@/db', () => ({
  db: { select: mockSelect, insert: mockInsert, update: mockUpdate, delete: mockDelete },
}))

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }))

import {
  addCustomerAddress,
  updateCustomerAddress,
  deleteCustomerAddress,
} from '../customer-addresses'

const AUTH_OK = { data: { user: { id: 'user-1' } }, error: null }
const CUSTOMER_ID = '22222222-2222-2222-2222-222222222222'
const ADDRESS_ID = '44444444-4444-4444-4444-444444444444'
// Keep in sync with ADDRESS_REVALIDATE_PATHS in customer-addresses.ts.
const EXPECTED_PATHS = ['/customers', '/orders', '/calendar'] as const

// Captures the last `.values(...)` / `.set(...)` payloads so tests can assert
// what would be written without running a real query. The upsert's conflict
// `set` is captured separately — it only applies on a duplicate (L-03).
let lastInsertValues: Record<string, unknown> | null = null
let lastUpdateSet: Record<string, unknown> | null = null
let lastConflictSet: Record<string, unknown> | null = null

// addCustomerAddress: insert(...).values(...).onConflictDoUpdate(...).returning()
// — a single atomic upsert against the (customer_id, address) unique index.
function stubUpsertReturning(id: string) {
  lastInsertValues = null
  lastConflictSet = null
  mockInsert.mockReturnValueOnce({
    values: (payload: Record<string, unknown>) => {
      lastInsertValues = payload
      return {
        onConflictDoUpdate: (config: { set: Record<string, unknown> }) => {
          lastConflictSet = config.set
          return { returning: () => Promise.resolve([{ id }]) }
        },
      }
    },
  })
}

// updateCustomerAddress chains .returning() to detect no-row-matched.
function stubUpdateReturning(rows: Array<{ id: string }>) {
  lastUpdateSet = null
  mockUpdate.mockReturnValueOnce({
    set: (payload: Record<string, unknown>) => {
      lastUpdateSet = payload
      return { where: () => ({ returning: () => Promise.resolve(rows) }) }
    },
  })
}

function stubDeleteReturning(rows: Array<{ id: string }>) {
  mockDelete.mockReturnValueOnce({
    where: () => ({ returning: () => Promise.resolve(rows) }),
  })
}

function expectRevalidatedAll() {
  for (const path of EXPECTED_PATHS) {
    expect(mockRevalidatePath).toHaveBeenCalledWith(path)
  }
  expect(mockRevalidatePath).toHaveBeenCalledTimes(EXPECTED_PATHS.length)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue(AUTH_OK)
  // Capture vars are also reset inside the stub helpers; resetting here too
  // keeps tests that never install a stub from seeing a previous test's payload.
  lastInsertValues = null
  lastUpdateSet = null
  lastConflictSet = null
})

describe('addCustomerAddress', () => {
  it('inserts a new address (trimmed) and returns the new id', async () => {
    stubUpsertReturning(ADDRESS_ID)
    const result = await addCustomerAddress(CUSTOMER_ID, '  123 Main St, Dover, OH  ')
    expect(result).toEqual({ id: ADDRESS_ID })
    // Fresh insert leaves last_used_at NULL — it is not in the values payload;
    // the conflict `set` only applies when a duplicate already exists.
    expect(lastInsertValues).toEqual({
      customer_id: CUSTOMER_ID,
      address: '123 Main St, Dover, OH',
    })
    expectRevalidatedAll()
  })

  it('bumps last_used_at and returns the existing id on an exact-text duplicate', async () => {
    // The upsert is one statement: on conflict with the (customer_id, address)
    // unique index (migration 0013) the existing row is bumped and its id
    // returned — no duplicate row, no separate probe/update round trips.
    stubUpsertReturning(ADDRESS_ID)
    const result = await addCustomerAddress(CUSTOMER_ID, '123 Main St, Dover, OH')
    expect(result).toEqual({ id: ADDRESS_ID })
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(lastConflictSet).toEqual({
      last_used_at: expect.any(Date),
      updated_at: expect.any(Date),
    })
    expectRevalidatedAll()
  })

  it('rejects when the user is not authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const result = await addCustomerAddress(CUSTOMER_ID, '123 Main St')
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('rejects a whitespace-only address before touching the database', async () => {
    const result = await addCustomerAddress(CUSTOMER_ID, '   ')
    expect(result).toEqual({ error: 'Address is required.' })
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('rejects a malformed customer id before touching the database', async () => {
    const result = await addCustomerAddress('not-a-uuid', '123 Main St')
    expect(result).toEqual({ error: 'Invalid customer id.' })
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })
})

describe('updateCustomerAddress', () => {
  it('updates the address text (trimmed) and returns success', async () => {
    stubUpdateReturning([{ id: ADDRESS_ID }])
    const result = await updateCustomerAddress(ADDRESS_ID, '  456 Oak Ave  ')
    expect(result).toEqual({ success: true })
    expect(lastUpdateSet).toEqual({
      address: '456 Oak Ave',
      updated_at: expect.any(Date),
    })
    expectRevalidatedAll()
  })

  it('rejects a malformed address id before touching the database', async () => {
    const result = await updateCustomerAddress('not-a-uuid', '456 Oak Ave')
    expect(result).toEqual({ error: 'Invalid address id.' })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('returns an error when no row matched the id', async () => {
    stubUpdateReturning([])
    const result = await updateCustomerAddress(ADDRESS_ID, '456 Oak Ave')
    expect(result).toEqual({ error: 'Address not found.' })
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('rejects when the user is not authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const result = await updateCustomerAddress(ADDRESS_ID, '456 Oak Ave')
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })
})

describe('deleteCustomerAddress', () => {
  it('deletes the row and returns success', async () => {
    stubDeleteReturning([{ id: ADDRESS_ID }])
    const result = await deleteCustomerAddress(ADDRESS_ID)
    expect(result).toEqual({ success: true })
    expect(mockDelete).toHaveBeenCalledOnce()
    expectRevalidatedAll()
  })

  it('rejects a malformed address id before touching the database', async () => {
    const result = await deleteCustomerAddress('not-a-uuid')
    expect(result).toEqual({ error: 'Invalid address id.' })
    expect(mockDelete).not.toHaveBeenCalled()
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('returns an error when no row matched the id', async () => {
    stubDeleteReturning([])
    const result = await deleteCustomerAddress(ADDRESS_ID)
    expect(result).toEqual({ error: 'Address not found.' })
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('rejects when the user is not authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const result = await deleteCustomerAddress(ADDRESS_ID)
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockDelete).not.toHaveBeenCalled()
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('returns a user-facing error and logs context when the delete fails', async () => {
    mockDelete.mockReturnValueOnce({
      where: () => ({ returning: () => Promise.reject(new Error('connection terminated')) }),
    })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await deleteCustomerAddress(ADDRESS_ID)
    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(consoleSpy).toHaveBeenCalledWith(
      'deleteCustomerAddress: delete failed',
      expect.objectContaining({ addressId: ADDRESS_ID, cause: expect.any(Error) }),
    )
    expect(mockRevalidatePath).not.toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
