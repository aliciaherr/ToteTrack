import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.hoisted(() => vi.fn())
const mockInsert = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: mockGetUser } }),
}))

vi.mock('@/db', () => ({
  db: { insert: mockInsert, update: mockUpdate, select: mockSelect },
}))

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }))

import { createPickup, updatePickup, updatePickupStatus } from '../pickups'

const AUTH_OK = { data: { user: { id: 'user-1' } }, error: null }
const PICKUP_ID = '33333333-3333-3333-3333-333333333333'
const CUSTOMER_ID = '22222222-2222-2222-2222-222222222222'
const ADDRESS_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

// Captures the last `.values(...)` / `.set(...)` payload so tests can assert
// what would be written without running a real query. The address-book upsert
// is captured separately so the pickup-row assertion is never clobbered.
let lastInsertValues: Record<string, unknown> | null = null
let lastUpdateSet: Record<string, unknown> | null = null
let lastAddressInsertValues: Record<string, unknown> | null = null

const VALID_PICKUP = {
  customer_id: CUSTOMER_ID,
  qty_275: 12,
  qty_330: 4,
  pickup_date: '2026-05-01',
  address: '123 Main Street',
  notes: null,
}

function stubInsertReturning(id: string) {
  lastInsertValues = null
  mockInsert.mockReturnValueOnce({
    values: (payload: Record<string, unknown>) => {
      lastInsertValues = payload
      return { returning: () => Promise.resolve([{ id }]) }
    },
  })
}

function stubInsertRejects(cause: unknown) {
  lastInsertValues = null
  mockInsert.mockReturnValueOnce({
    values: (payload: Record<string, unknown>) => {
      lastInsertValues = payload
      return { returning: () => Promise.reject(cause) }
    },
  })
}

function stubUpdateResolves() {
  lastUpdateSet = null
  mockUpdate.mockReturnValueOnce({
    set: (payload: Record<string, unknown>) => {
      lastUpdateSet = payload
      return { where: () => Promise.resolve(undefined) }
    },
  })
}

// The address-book upsert: insert(...).values(...).onConflictDoUpdate(...)
// awaited with no returning().
function stubAddressUpsert() {
  mockInsert.mockReturnValueOnce({
    values: (payload: Record<string, unknown>) => {
      lastAddressInsertValues = payload
      return { onConflictDoUpdate: () => Promise.resolve(undefined) }
    },
  })
}

function stubAddressUpsertRejects(cause: unknown) {
  mockInsert.mockReturnValueOnce({
    values: () => ({ onConflictDoUpdate: () => Promise.reject(cause) }),
  })
}

// Existence probe for updatePickup / status probe for updatePickupStatus.
function stubSelectRow(row: Record<string, unknown> | null) {
  mockSelect.mockReturnValueOnce({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve(row ? [row] : []) }),
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue(AUTH_OK)
  lastInsertValues = null
  lastUpdateSet = null
  lastAddressInsertValues = null
  // Default DB behavior so tests that don't care about the address
  // bookkeeping after a create fall through without noise.
  mockSelect.mockImplementation(() => ({
    from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
  }))
  mockInsert.mockImplementation(() => ({
    values: () => ({
      returning: () => Promise.resolve([{ id: PICKUP_ID }]),
      onConflictDoUpdate: () => Promise.resolve(undefined),
    }),
  }))
  mockUpdate.mockImplementation(() => ({
    set: () => ({ where: () => Promise.resolve(undefined) }),
  }))
})

describe('createPickup', () => {
  it('writes the expected row', async () => {
    stubInsertReturning(PICKUP_ID)
    const result = await createPickup(VALID_PICKUP)
    expect(result).toEqual({ id: PICKUP_ID })
    expect(lastInsertValues).toEqual({
      customer_id: CUSTOMER_ID,
      qty_275: 12,
      qty_330: 4,
      pickup_date: '2026-05-01',
      address: '123 Main Street',
      notes: null,
    })
    // Status and sort_index are never written here — the DB default supplies
    // `scheduled`, and the calendar owns placement.
    expect(lastInsertValues).not.toHaveProperty('status')
    expect(lastInsertValues).not.toHaveProperty('sort_index')
  })

  it('accepts a pickup with no date and stores null (unscheduled)', async () => {
    stubInsertReturning(PICKUP_ID)
    const result = await createPickup({ ...VALID_PICKUP, pickup_date: '' })
    expect(result).toEqual({ id: PICKUP_ID })
    expect(lastInsertValues).toMatchObject({ pickup_date: null })
  })

  it('accepts a pickup with no address at all', async () => {
    stubInsertReturning(PICKUP_ID)
    const result = await createPickup({ ...VALID_PICKUP, address: null })
    expect(result).toEqual({ id: PICKUP_ID })
    expect(lastInsertValues).toMatchObject({ address: null })
    // Nothing to remember — the address book is not touched.
    expect(mockInsert).toHaveBeenCalledOnce()
    expect(mockRevalidatePath).not.toHaveBeenCalledWith('/dashboard')
  })

  it('accepts a 330-only pickup (either size may carry the whole count)', async () => {
    stubInsertReturning(PICKUP_ID)
    const result = await createPickup({ ...VALID_PICKUP, qty_275: 0, qty_330: 6 })
    expect(result).toEqual({ id: PICKUP_ID })
    expect(lastInsertValues).toMatchObject({ qty_275: 0, qty_330: 6 })
  })

  it('rejects when both quantities are zero', async () => {
    const result = await createPickup({ ...VALID_PICKUP, qty_275: 0, qty_330: 0 })
    expect(result).toEqual({ error: 'At least one quantity is required.' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects a negative quantity', async () => {
    const result = await createPickup({ ...VALID_PICKUP, qty_275: -1 })
    expect(result).toMatchObject({
      error: expect.stringMatching(/Quantities must be 0 or greater\./),
    })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects a quantity above QUANTITY_MAX', async () => {
    const result = await createPickup({ ...VALID_PICKUP, qty_275: 100_001 })
    expect(result).toMatchObject({
      error: expect.stringMatching(/^Quantities must be /),
    })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects a malformed customer id before touching the database', async () => {
    const result = await createPickup({ ...VALID_PICKUP, customer_id: 'not-a-uuid' })
    expect(result).toEqual({ error: 'Please choose a customer.' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects a date that is not a real calendar day', async () => {
    const result = await createPickup({ ...VALID_PICKUP, pickup_date: '2026-02-31' })
    expect(result).toEqual({ error: 'Invalid date format.' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('remembers a typed address in the customer address book (CONSTRAINT-21)', async () => {
    stubInsertReturning(PICKUP_ID) // pickup row
    stubAddressUpsert() // customer_addresses upsert
    const result = await createPickup(VALID_PICKUP)
    expect(result).toEqual({ id: PICKUP_ID })
    expect(lastAddressInsertValues).toMatchObject({
      customer_id: CUSTOMER_ID,
      address: '123 Main Street',
      last_used_at: expect.any(Date),
    })
    // Upsert, not bump: with no address_id there is nothing to touch by id.
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('bumps a picked saved address instead of re-upserting its text', async () => {
    // Ownership probe finds the row under this customer, so the create goes
    // through and the address book gets an MRU bump, not a second insert.
    stubSelectRow({ id: ADDRESS_ID })
    stubInsertReturning(PICKUP_ID)
    stubUpdateResolves()
    const result = await createPickup({ ...VALID_PICKUP, address_id: ADDRESS_ID })
    expect(result).toEqual({ id: PICKUP_ID })
    expect(lastUpdateSet).toMatchObject({ last_used_at: expect.any(Date) })
    // The pickup row still stores the address as plain text (CONSTRAINT-21) —
    // no id column is written.
    expect(lastInsertValues).toMatchObject({ address: '123 Main Street' })
    expect(lastInsertValues).not.toHaveProperty('address_id')
    // One insert only: the pickup row. No address upsert.
    expect(mockInsert).toHaveBeenCalledOnce()
  })

  it('rejects an address_id belonging to a different customer (SEC-03)', async () => {
    // The ownership probe finds nothing: the id is real but hangs off another
    // customer, so a forged submit must fail server-side even though the UI
    // would never have offered it.
    stubSelectRow(null)
    const result = await createPickup({ ...VALID_PICKUP, address_id: ADDRESS_ID })
    expect(result).toEqual({
      error: 'Selected collection address does not belong to this customer.',
    })
    // Nothing was written — not the pickup row, not the address book.
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockRevalidatePath).not.toHaveBeenCalled()
  })

  it('rejects an address_id sent with no address text (CONSTRAINT-21)', async () => {
    // The snapshot/id pair must agree: bumping a saved address's last_used_at
    // while the pickup row stores no address is the state this guards.
    const result = await createPickup({
      ...VALID_PICKUP,
      address: null,
      address_id: ADDRESS_ID,
    })
    expect(result).toEqual({
      error: 'Collection address text is required when a saved address is selected.',
    })
    // Nothing at all reached the driver — not the ownership probe, not the
    // pickup insert, and above all no last_used_at bump.
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects an address_id sent with a whitespace-only address', async () => {
    const result = await createPickup({
      ...VALID_PICKUP,
      address: '   ',
      address_id: ADDRESS_ID,
    })
    expect(result).toEqual({
      error: 'Collection address text is required when a saved address is selected.',
    })
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects a malformed address_id before touching the database', async () => {
    const result = await createPickup({ ...VALID_PICKUP, address_id: 'not-a-uuid' })
    expect(result).toEqual({ error: 'Invalid collection address id.' })
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('revalidates the pickups list, the calendar and customers — never the dashboard', async () => {
    stubInsertReturning(PICKUP_ID)
    await createPickup(VALID_PICKUP)
    expect(mockRevalidatePath).toHaveBeenCalledWith('/pickups')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/calendar')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/customers')
    // PRD Feature 15: pickups appear on no dashboard surface.
    expect(mockRevalidatePath).not.toHaveBeenCalledWith('/dashboard')
  })

  it('still returns the pickup id when address bookkeeping fails after the insert', async () => {
    // The pickup row is already committed; reporting an error would push the
    // salesperson into a duplicate-pickup retry. The failure logs instead —
    // and names createPickup, not createOrder.
    stubInsertReturning(PICKUP_ID)
    stubAddressUpsertRejects(new Error('connection terminated'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await createPickup(VALID_PICKUP)
    expect(result).toEqual({ id: PICKUP_ID })
    expect(consoleSpy).toHaveBeenCalledWith(
      'createPickup: address bookkeeping failed',
      expect.objectContaining({ rowId: PICKUP_ID, customerId: CUSTOMER_ID }),
    )
    consoleSpy.mockRestore()
  })

  it('unauthenticated returns the generic failure', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const result = await createPickup(VALID_PICKUP)
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('returns a generic error and logs context on a driver failure', async () => {
    stubInsertRejects(new Error('connection terminated'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await createPickup(VALID_PICKUP)
    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(consoleSpy).toHaveBeenCalledWith(
      'createPickup: insert failed',
      expect.objectContaining({ operation: 'createPickup', customerId: CUSTOMER_ID }),
    )
    consoleSpy.mockRestore()
  })
})

describe('updatePickup', () => {
  it('updates the pickup and returns success on valid input', async () => {
    stubSelectRow({ id: PICKUP_ID })
    stubUpdateResolves()
    const result = await updatePickup(PICKUP_ID, { ...VALID_PICKUP, qty_330: 9 })
    expect(result).toEqual({ success: true })
    expect(lastUpdateSet).toMatchObject({ qty_275: 12, qty_330: 9 })
    expect(lastUpdateSet).toHaveProperty('updated_at')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/pickups')
  })

  it('never writes a status column even when status is passed in the payload', async () => {
    stubSelectRow({ id: PICKUP_ID })
    stubUpdateResolves()
    const payloadWithStatus = {
      ...VALID_PICKUP,
      status: 'completed',
    } as unknown as typeof VALID_PICKUP
    const result = await updatePickup(PICKUP_ID, payloadWithStatus)
    expect(result).toEqual({ success: true })
    expect(lastUpdateSet).not.toHaveProperty('status')
  })

  it('rejects a malformed pickup id before touching the database', async () => {
    const result = await updatePickup('not-a-uuid', VALID_PICKUP)
    expect(result).toEqual({ error: 'Invalid pickup id.' })
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects an empty-quantity edit before touching the database', async () => {
    const result = await updatePickup(PICKUP_ID, {
      ...VALID_PICKUP,
      qty_275: 0,
      qty_330: 0,
    })
    expect(result).toEqual({ error: 'At least one quantity is required.' })
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects when the pickup does not exist', async () => {
    stubSelectRow(null)
    const result = await updatePickup(PICKUP_ID, VALID_PICKUP)
    expect(result).toEqual({ error: 'Pickup not found.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects when the user is not authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const result = await updatePickup(PICKUP_ID, VALID_PICKUP)
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns a generic error and logs context on a driver failure', async () => {
    stubSelectRow({ id: PICKUP_ID })
    mockUpdate.mockReturnValueOnce({
      set: () => ({ where: () => Promise.reject(new Error('connection terminated')) }),
    })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await updatePickup(PICKUP_ID, VALID_PICKUP)
    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(consoleSpy).toHaveBeenCalledWith(
      'updatePickup: update failed',
      expect.objectContaining({ operation: 'updatePickup', pickupId: PICKUP_ID }),
    )
    consoleSpy.mockRestore()
  })
})

describe('updatePickupStatus', () => {
  it('completes a scheduled pickup', async () => {
    stubSelectRow({ status: 'scheduled' })
    stubUpdateResolves()
    const result = await updatePickupStatus(PICKUP_ID, 'completed')
    expect(result).toEqual({ success: true })
    expect(lastUpdateSet).toMatchObject({ status: 'completed' })
    expect(lastUpdateSet).toHaveProperty('updated_at')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/pickups')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/calendar')
    expect(mockRevalidatePath).not.toHaveBeenCalledWith('/dashboard')
  })

  it('cancels a scheduled pickup', async () => {
    stubSelectRow({ status: 'scheduled' })
    stubUpdateResolves()
    const result = await updatePickupStatus(PICKUP_ID, 'cancelled')
    expect(result).toEqual({ success: true })
    expect(lastUpdateSet).toMatchObject({ status: 'cancelled' })
  })

  it('reopens a completed pickup back to scheduled', async () => {
    // Unlike an order there is no invoice to unwind, so the reopen is a plain
    // status flip rather than a transactional revert.
    stubSelectRow({ status: 'completed' })
    stubUpdateResolves()
    const result = await updatePickupStatus(PICKUP_ID, 'scheduled')
    expect(result).toEqual({ success: true })
    expect(lastUpdateSet).toMatchObject({ status: 'scheduled' })
  })

  it('an invalid uuid is rejected before any query', async () => {
    const result = await updatePickupStatus('not-a-uuid', 'completed')
    expect(result).toEqual({ error: 'Invalid pickup id.' })
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects an unknown target status via Zod before touching the database', async () => {
    const result = await updatePickupStatus(
      PICKUP_ID,
      'invoiced' as unknown as 'completed',
    )
    expect('error' in result).toBe(true)
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects completed → completed with a transition-shaped error', async () => {
    stubSelectRow({ status: 'completed' })
    const result = await updatePickupStatus(PICKUP_ID, 'completed')
    expect(result).toEqual({
      error: 'Invalid status transition from completed to completed.',
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects cancelled → completed (only a reopen is allowed from cancelled)', async () => {
    stubSelectRow({ status: 'cancelled' })
    const result = await updatePickupStatus(PICKUP_ID, 'completed')
    expect(result).toEqual({
      error: 'Invalid status transition from cancelled to completed.',
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects when the pickup does not exist', async () => {
    stubSelectRow(null)
    const result = await updatePickupStatus(PICKUP_ID, 'completed')
    expect(result).toEqual({ error: 'Pickup not found.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects when the user is not authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const result = await updatePickupStatus(PICKUP_ID, 'completed')
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns a generic error and logs context on a driver failure', async () => {
    mockSelect.mockReturnValueOnce({
      from: () => ({
        where: () => ({ limit: () => Promise.reject(new Error('connection terminated')) }),
      }),
    })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await updatePickupStatus(PICKUP_ID, 'completed')
    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(consoleSpy).toHaveBeenCalledWith(
      'updatePickupStatus: update failed',
      expect.objectContaining({
        operation: 'updatePickupStatus',
        pickupId: PICKUP_ID,
        target: 'completed',
      }),
    )
    consoleSpy.mockRestore()
  })
})
