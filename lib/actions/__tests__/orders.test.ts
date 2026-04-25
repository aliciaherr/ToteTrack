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

import { createOrder, updateOrder, updateOrderStatus } from '../orders'

const AUTH_OK = { data: { user: { id: 'user-1' } }, error: null }
const ORDER_ID = '33333333-3333-3333-3333-333333333333'
const CUSTOMER_ID = '22222222-2222-2222-2222-222222222222'

// Captures the last `.values(...)` payload so tests can assert what would
// be written to the orders table without running a real query.
let lastInsertValues: Record<string, unknown> | null = null
let lastUpdateSet: Record<string, unknown> | null = null

function stubInsertReturning(id: string) {
  lastInsertValues = null
  mockInsert.mockReturnValueOnce({
    values: (payload: Record<string, unknown>) => {
      lastInsertValues = payload
      return {
        returning: () => Promise.resolve([{ id }]),
      }
    },
  })
}

function stubInsertRejects(cause: unknown) {
  lastInsertValues = null
  mockInsert.mockReturnValueOnce({
    values: (payload: Record<string, unknown>) => {
      lastInsertValues = payload
      return {
        returning: () => Promise.reject(cause),
      }
    },
  })
}

function stubUpdateResolves() {
  lastUpdateSet = null
  mockUpdate.mockReturnValueOnce({
    set: (payload: Record<string, unknown>) => {
      lastUpdateSet = payload
      return {
        where: () => Promise.resolve(undefined),
      }
    },
  })
}

const VALID_CREATE = {
  po_number: 'PO-9001',
  customer_id: CUSTOMER_ID,
  qty_275_recon: 0,
  qty_275_rebot: 10,
  qty_275_new: 0,
  qty_330_recon: 0,
  qty_330_rebot: 0,
  qty_330_new: 0,
  price: 250,
  pickup_only: false,
  delivery_address: '123 Main Street',
  requested_delivery_date: '2026-05-01',
  backhaul: false,
  notes: null,
}

const VALID_UPDATE = {
  po_number: 'PO-9001',
  customer_id: CUSTOMER_ID,
  qty_275_recon: 0,
  qty_275_rebot: 12,
  qty_275_new: 0,
  qty_330_recon: 0,
  qty_330_rebot: 0,
  qty_330_new: 0,
  price: 300,
  pickup_only: false,
  delivery_address: '123 Main Street',
  requested_delivery_date: '2026-05-01',
  backhaul: false,
  notes: null,
}

// Snapshot of the current row's status + qty + price columns. Used by the
// edit-lock check inside `updateOrder` (Feature 9). When the test wants the
// PO to be in a state that doesn't lock qty/price edits (scheduled,
// completed) AND the input matches the current row, no lock fires.
interface CurrentRowSnapshot {
  status: string
  qty_275_recon: number
  qty_275_rebot: number
  qty_275_new: number
  qty_330_recon: number
  qty_330_rebot: number
  qty_330_new: number
  price: string
}

function buildCurrentSnapshot(
  partial: Partial<CurrentRowSnapshot> = {},
): CurrentRowSnapshot {
  return {
    status: 'scheduled',
    qty_275_recon: 0,
    qty_275_rebot: 0,
    qty_275_new: 0,
    qty_330_recon: 0,
    qty_330_rebot: 0,
    qty_330_new: 0,
    price: '0.00',
    ...partial,
  }
}

function stubSelectCurrent(row: CurrentRowSnapshot | null) {
  mockSelect.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(row ? [row] : []),
      }),
    }),
  })
}

function stubSelectStatus(status: string | null) {
  mockSelect.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(status ? [{ status }] : []),
      }),
    }),
  })
}

function stubSelectRejects(cause: unknown) {
  mockSelect.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: () => Promise.reject(cause),
      }),
    }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue(AUTH_OK)
  lastInsertValues = null
  lastUpdateSet = null
})

describe('createOrder', () => {
  it('creates the order and returns the new id on success', async () => {
    stubInsertReturning(ORDER_ID)
    const result = await createOrder(VALID_CREATE)
    expect(result).toEqual({ id: ORDER_ID })
    expect(mockRevalidatePath).toHaveBeenCalledWith('/orders')
    expect(lastInsertValues).toMatchObject({
      po_number: 'PO-9001',
      customer_id: CUSTOMER_ID,
      status: 'scheduled',
      qty_275_recon: 0,
      qty_275_rebot: 10,
      qty_275_new: 0,
      qty_330_recon: 0,
      qty_330_rebot: 0,
      qty_330_new: 0,
      price: '250.00',
      pickup_only: false,
      delivery_address: '123 Main Street',
    })
  })

  it('rejects a duplicate po_number with the mapped error message', async () => {
    const driverError = Object.assign(new Error('duplicate key'), { code: '23505' })
    stubInsertRejects(driverError)
    const result = await createOrder(VALID_CREATE)
    expect(result).toEqual({ error: 'PO number already exists.' })
  })

  it('rejects when delivery_address is missing and pickup_only is false', async () => {
    const result = await createOrder({
      ...VALID_CREATE,
      pickup_only: false,
      delivery_address: '',
    })
    expect(result).toEqual({
      error: 'Delivery address is required when not pickup-only.',
    })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('accepts a missing delivery_address when pickup_only is true and stores null', async () => {
    stubInsertReturning(ORDER_ID)
    const result = await createOrder({
      ...VALID_CREATE,
      pickup_only: true,
      delivery_address: '',
    })
    expect(result).toEqual({ id: ORDER_ID })
    expect(lastInsertValues).toMatchObject({
      pickup_only: true,
      delivery_address: null,
    })
  })

  it('rejects when all 6 quantity cells are zero (Feature 9 sum > 0 invariant)', async () => {
    const result = await createOrder({
      ...VALID_CREATE,
      qty_275_recon: 0,
      qty_275_rebot: 0,
      qty_275_new: 0,
      qty_330_recon: 0,
      qty_330_rebot: 0,
      qty_330_new: 0,
    })
    expect(result).toEqual({ error: 'At least one quantity is required.' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('accepts a multi-combo PO (more than one cell > 0)', async () => {
    stubInsertReturning(ORDER_ID)
    const result = await createOrder({
      ...VALID_CREATE,
      qty_275_rebot: 10,
      qty_330_new: 5,
    })
    expect(result).toEqual({ id: ORDER_ID })
    expect(lastInsertValues).toMatchObject({
      qty_275_rebot: 10,
      qty_330_new: 5,
    })
  })

  it('rejects negative quantities (per-cell ≥ 0 invariant)', async () => {
    const result = await createOrder({ ...VALID_CREATE, qty_275_rebot: -1 })
    expect(result).toMatchObject({
      error: expect.stringMatching(/Quantities must be 0 or greater\./),
    })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects when price is zero or negative', async () => {
    const result = await createOrder({ ...VALID_CREATE, price: 0 })
    expect(result).toEqual({ error: 'Price must be greater than $0.' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects when price exceeds the numeric(10,2) column ceiling', async () => {
    const result = await createOrder({ ...VALID_CREATE, price: 10_000_000 })
    expect(result).toMatchObject({
      error: expect.stringMatching(/^Price must be less than \$/),
    })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects when the user is not authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const result = await createOrder(VALID_CREATE)
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('returns a generic error and logs context on non-unique driver failures', async () => {
    stubInsertRejects(new Error('connection terminated'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await createOrder(VALID_CREATE)
    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})

describe('updateOrder', () => {
  it('updates the order and returns success on valid input', async () => {
    stubSelectCurrent(buildCurrentSnapshot({ status: 'scheduled' }))
    stubUpdateResolves()
    const result = await updateOrder(ORDER_ID, VALID_UPDATE)
    expect(result).toEqual({ success: true })
    expect(mockRevalidatePath).toHaveBeenCalledWith('/orders')
    expect(lastUpdateSet).toMatchObject({
      po_number: 'PO-9001',
      qty_275_rebot: 12,
      price: '300.00',
    })
  })

  it('never writes a status column even when status is passed in the payload', async () => {
    stubSelectCurrent(buildCurrentSnapshot({ status: 'scheduled' }))
    stubUpdateResolves()
    const payloadWithStatus = {
      ...VALID_UPDATE,
      // These keys are not part of UpdateOrderInput's type, but a buggy client
      // could send them. The Zod schema + explicit .set() payload guarantee
      // they never reach the column.
      status: 'completed',
      initial_status: 'scheduled',
    } as unknown as typeof VALID_UPDATE
    const result = await updateOrder(ORDER_ID, payloadWithStatus)
    expect(result).toEqual({ success: true })
    expect(lastUpdateSet).not.toHaveProperty('status')
    expect(lastUpdateSet).not.toHaveProperty('initial_status')
  })

  it('rejects a malformed order id before touching the database', async () => {
    const result = await updateOrder('not-a-uuid', VALID_UPDATE)
    expect(result).toEqual({ error: 'Invalid order id.' })
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects when the user is not authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const result = await updateOrder(ORDER_ID, VALID_UPDATE)
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects when the order does not exist (current snapshot empty)', async () => {
    stubSelectCurrent(null)
    const result = await updateOrder(ORDER_ID, VALID_UPDATE)
    expect(result).toEqual({ error: 'Order not found.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('maps a PO# unique-violation during update to the user-facing message', async () => {
    stubSelectCurrent(buildCurrentSnapshot({ status: 'scheduled' }))
    const driverError = Object.assign(new Error('duplicate key'), { code: '23505' })
    mockUpdate.mockReturnValueOnce({
      set: () => ({
        where: () => Promise.reject(driverError),
      }),
    })
    const result = await updateOrder(ORDER_ID, VALID_UPDATE)
    expect(result).toEqual({ error: 'PO number already exists.' })
  })

  // Edit-lock tests (Feature 9, Q3): qty + price changes blocked on
  // invoiced + cancelled POs. Other field changes still allowed on those
  // statuses. scheduled + completed remain fully editable.

  it('blocks qty changes on an invoiced PO with the lock error message', async () => {
    stubSelectCurrent(
      buildCurrentSnapshot({
        status: 'invoiced',
        qty_275_rebot: 10, // current is 10; VALID_UPDATE asks for 12 → change
        price: '300.00',
      }),
    )
    const result = await updateOrder(ORDER_ID, VALID_UPDATE)
    expect(result).toEqual({
      error: 'PO is locked. Revert to scheduled before editing quantities or price.',
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('blocks qty changes on a cancelled PO with the lock error message', async () => {
    stubSelectCurrent(
      buildCurrentSnapshot({
        status: 'cancelled',
        qty_275_rebot: 10,
        price: '300.00',
      }),
    )
    const result = await updateOrder(ORDER_ID, VALID_UPDATE)
    expect(result).toEqual({
      error: 'PO is locked. Revert to scheduled before editing quantities or price.',
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('blocks price changes on an invoiced PO even when qty is unchanged', async () => {
    stubSelectCurrent(
      buildCurrentSnapshot({
        status: 'invoiced',
        qty_275_rebot: 12, // matches input
        price: '999.00', // differs from input price 300
      }),
    )
    const result = await updateOrder(ORDER_ID, VALID_UPDATE)
    expect(result).toEqual({
      error: 'PO is locked. Revert to scheduled before editing quantities or price.',
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('allows notes-only changes on an invoiced PO (qty + price unchanged)', async () => {
    stubSelectCurrent(
      buildCurrentSnapshot({
        status: 'invoiced',
        qty_275_rebot: 12, // matches VALID_UPDATE
        price: '300.00', // matches VALID_UPDATE.price.toFixed(2)
      }),
    )
    stubUpdateResolves()
    const result = await updateOrder(ORDER_ID, {
      ...VALID_UPDATE,
      notes: 'Updated note — quantities and price unchanged.',
    })
    expect(result).toEqual({ success: true })
    expect(lastUpdateSet).toMatchObject({
      notes: 'Updated note — quantities and price unchanged.',
    })
  })

  it('allows qty changes on a completed PO (lock applies to invoiced + cancelled only)', async () => {
    stubSelectCurrent(
      buildCurrentSnapshot({
        status: 'completed',
        qty_275_rebot: 5, // input asks for 12 → change
        price: '999.00',
      }),
    )
    stubUpdateResolves()
    const result = await updateOrder(ORDER_ID, VALID_UPDATE)
    expect(result).toEqual({ success: true })
    expect(lastUpdateSet).toMatchObject({ qty_275_rebot: 12, price: '300.00' })
  })
})

describe('updateOrderStatus', () => {
  it('advances scheduled → completed on a valid transition', async () => {
    stubSelectStatus('scheduled')
    stubUpdateResolves()
    const result = await updateOrderStatus(ORDER_ID, 'completed')
    expect(result).toEqual({ success: true })
    expect(lastUpdateSet).toMatchObject({ status: 'completed' })
    expect(lastUpdateSet).toHaveProperty('updated_at')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/orders')
  })

  it('advances scheduled → cancelled on a valid transition', async () => {
    stubSelectStatus('scheduled')
    stubUpdateResolves()
    const result = await updateOrderStatus(ORDER_ID, 'cancelled')
    expect(result).toEqual({ success: true })
    expect(lastUpdateSet).toMatchObject({ status: 'cancelled' })
  })

  it('rejects invoiced as the target via Zod before touching the database', async () => {
    // 'invoiced' is not in the updateOrderStatus Zod enum — the invoice
    // creation flow (Task 24) is the only path that writes this status.
    const result = await updateOrderStatus(
      ORDER_ID,
      'invoiced' as unknown as 'completed',
    )
    expect('error' in result).toBe(true)
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects scheduled as the target via Zod (initial-only state)', async () => {
    const result = await updateOrderStatus(
      ORDER_ID,
      'scheduled' as unknown as 'completed',
    )
    expect('error' in result).toBe(true)
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects completed → completed with a transition-shaped error (terminal state)', async () => {
    stubSelectStatus('completed')
    const result = await updateOrderStatus(ORDER_ID, 'completed')
    expect(result).toEqual({
      error: 'Invalid status transition from completed to completed.',
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects cancelled → completed (terminal state)', async () => {
    stubSelectStatus('cancelled')
    const result = await updateOrderStatus(ORDER_ID, 'completed')
    expect(result).toEqual({
      error: 'Invalid status transition from cancelled to completed.',
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects when the order does not exist', async () => {
    stubSelectStatus(null)
    const result = await updateOrderStatus(ORDER_ID, 'completed')
    expect(result).toEqual({ error: 'Order not found.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects a malformed order id before touching the database', async () => {
    const result = await updateOrderStatus('not-a-uuid', 'completed')
    expect(result).toEqual({ error: 'Invalid order id.' })
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects when the user is not authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })
    const result = await updateOrderStatus(ORDER_ID, 'completed')
    expect(result).toEqual({ error: 'You are not signed in.' })
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns a generic error and logs context on driver failures', async () => {
    stubSelectRejects(new Error('connection terminated'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await updateOrderStatus(ORDER_ID, 'completed')
    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
