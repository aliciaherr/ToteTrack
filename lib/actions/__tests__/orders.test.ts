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
import { defaultProductionDate } from '../orders.internal'
import { InvalidDateError } from '@/lib/errors'

const AUTH_OK = { data: { user: { id: 'user-1' } }, error: null }
const ORDER_ID = '33333333-3333-3333-3333-333333333333'
const CUSTOMER_ID = '22222222-2222-2222-2222-222222222222'
const ADDRESS_ID = '55555555-5555-5555-5555-555555555555'

// Captures the last `.values(...)` payload so tests can assert what would
// be written to the orders table without running a real query.
let lastInsertValues: Record<string, unknown> | null = null
let lastUpdateSet: Record<string, unknown> | null = null
// Separate capture for the customer_addresses upsert (Feature 14) so the
// order-row assertion above is never clobbered by the second insert. The
// conflict `set` is captured too — it is what bumps a duplicate (L-03).
let lastAddressInsertValues: Record<string, unknown> | null = null
let lastAddressConflictSet: Record<string, unknown> | null = null

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

// Feature 10: `price` is no longer a client input — it is derived server-side
// as Σ(qty × unit price). Each active qty cell carries a per-combo unit price;
// idle cells carry null. VALID_CREATE: 10 × $25 = $250.00.
const VALID_CREATE = {
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
  pickup_only: false,
  delivery_address: '123 Main Street',
  requested_delivery_date: '2026-05-01',
  backhaul: false,
  notes: null,
}

// VALID_UPDATE: 12 × $25 = $300.00.
const VALID_UPDATE = {
  po_number: 'PO-9001',
  customer_id: CUSTOMER_ID,
  qty_275_recon: 0,
  qty_275_rebot: 12,
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
  unit_price_275_recon: string | null
  unit_price_275_rebot: string | null
  unit_price_275_new: string | null
  unit_price_330_recon: string | null
  unit_price_330_rebot: string | null
  unit_price_330_new: string | null
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
    unit_price_275_recon: null,
    unit_price_275_rebot: null,
    unit_price_275_new: null,
    unit_price_330_recon: null,
    unit_price_330_rebot: null,
    unit_price_330_new: null,
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

// Feature 14 stubs: the `customer_addresses` ownership lookup (before the
// order insert) and the dedupe upsert after it —
// insert(...).values(...).onConflictDoUpdate(...) awaited with no returning().
function stubSelectAddressRow(row: { id: string } | null) {
  mockSelect.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(row ? [row] : []),
      }),
    }),
  })
}

function stubAddressUpsert() {
  mockInsert.mockReturnValueOnce({
    values: (payload: Record<string, unknown>) => {
      lastAddressInsertValues = payload
      return {
        onConflictDoUpdate: (config: { set: Record<string, unknown> }) => {
          lastAddressConflictSet = config.set
          return Promise.resolve(undefined)
        },
      }
    },
  })
}

function stubAddressUpsertRejects(cause: unknown) {
  mockInsert.mockReturnValueOnce({
    values: (payload: Record<string, unknown>) => {
      lastAddressInsertValues = payload
      return {
        onConflictDoUpdate: () => Promise.reject(cause),
      }
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue(AUTH_OK)
  lastInsertValues = null
  lastUpdateSet = null
  lastAddressInsertValues = null
  lastAddressConflictSet = null
  // Default DB behavior for the Feature 14 address bookkeeping that runs
  // after every non-pickup order insert: lookups find nothing, writes
  // resolve (both the plain .returning() chain and the upsert's
  // .onConflictDoUpdate() chain). Tests asserting address behavior stack
  // ...Once stubs on top; pre-Feature-14 tests just fall through to these
  // without noise.
  mockSelect.mockImplementation(() => ({
    from: () => ({
      where: () => ({ limit: () => Promise.resolve([]) }),
    }),
  }))
  mockInsert.mockImplementation(() => ({
    values: () => ({
      returning: () => Promise.resolve([{ id: ADDRESS_ID }]),
      onConflictDoUpdate: () => Promise.resolve(undefined),
    }),
  }))
  mockUpdate.mockImplementation(() => ({
    set: () => ({ where: () => Promise.resolve(undefined) }),
  }))
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

  it('accepts a multi-combo PO and stores the server-derived total (Σ qty×unit)', async () => {
    stubInsertReturning(ORDER_ID)
    const result = await createOrder({
      ...VALID_CREATE,
      qty_275_rebot: 10,
      unit_price_275_rebot: 25, // 10 × 25 = 250
      qty_330_new: 5,
      unit_price_330_new: 40, // 5 × 40 = 200
    })
    expect(result).toEqual({ id: ORDER_ID })
    expect(lastInsertValues).toMatchObject({
      qty_275_rebot: 10,
      qty_330_new: 5,
      unit_price_275_rebot: '25.00',
      unit_price_330_new: '40.00',
      // Derived total = 250 + 200 = 450.00 (client sends no total).
      price: '450.00',
    })
  })

  it('normalizes a qty-0 cell that carries a unit price to null on write', async () => {
    stubInsertReturning(ORDER_ID)
    const result = await createOrder({
      ...VALID_CREATE,
      // qty_330_new stays 0 but a stale/mis-sent unit price rides along — the
      // server clears it to null rather than rejecting (PRD Feature 10 edge).
      qty_330_new: 0,
      unit_price_330_new: 30,
    })
    expect(result).toEqual({ id: ORDER_ID })
    expect(lastInsertValues).toMatchObject({
      unit_price_330_new: null,
      // Only the active 10 × $25 combo contributes to the total.
      price: '250.00',
    })
  })

  it('rejects negative quantities (per-cell ≥ 0 invariant)', async () => {
    const result = await createOrder({ ...VALID_CREATE, qty_275_rebot: -1 })
    expect(result).toMatchObject({
      error: expect.stringMatching(/Quantities must be 0 or greater\./),
    })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects a qty>0 cell whose unit price is missing (coupling rule)', async () => {
    const result = await createOrder({
      ...VALID_CREATE,
      qty_275_rebot: 10,
      unit_price_275_rebot: null,
    })
    expect(result).toEqual({
      error: 'Unit price for 275 gal Rebottled is required and must be greater than $0.',
    })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects a qty>0 cell whose unit price is zero or negative (coupling rule)', async () => {
    const result = await createOrder({
      ...VALID_CREATE,
      qty_275_rebot: 10,
      unit_price_275_rebot: 0,
    })
    expect(result).toMatchObject({
      error: expect.stringMatching(/Unit price must be greater than \$0\.|Unit price for 275 gal Rebottled/),
    })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects when a unit price exceeds the numeric(10,2) column ceiling', async () => {
    const result = await createOrder({
      ...VALID_CREATE,
      unit_price_275_rebot: 10_000_000,
    })
    expect(result).toMatchObject({
      error: expect.stringMatching(/^Unit price must be less than \$/),
    })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects a unit price with more than 2 decimal places (>2dp precision)', async () => {
    const result = await createOrder({
      ...VALID_CREATE,
      // 25.005 would store as 25.01 while the total would use 25.005 — the
      // exact price↔unit_price divergence Fix A(2) closes. Reject, don't round.
      unit_price_275_rebot: 25.005,
    })
    expect(result).toEqual({
      error: 'Unit price can have at most 2 decimal places.',
    })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects when the derived total exceeds the numeric(10,2) column ceiling', async () => {
    const result = await createOrder({
      ...VALID_CREATE,
      // Each cell is individually valid (qty ≤ 100,000, unit price ≤ max) but
      // 100,000 × $100 = $10,000,000 > $9,999,999.99 → the total overflows.
      qty_275_rebot: 100_000,
      unit_price_275_rebot: 100,
    })
    expect(result).toEqual({
      error: 'Order total exceeds the maximum of $9,999,999.99.',
    })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('stores price exactly equal to Σ(unit × qty) for valid 2-decimal unit prices', async () => {
    stubInsertReturning(ORDER_ID)
    const result = await createOrder({
      ...VALID_CREATE,
      qty_275_rebot: 3,
      unit_price_275_rebot: 25.05, // 3 × 25.05 = 75.15
      qty_330_new: 7,
      unit_price_330_new: 10.1, //  7 × 10.10 = 70.70
    })
    expect(result).toEqual({ id: ORDER_ID })
    // Stored total must exactly equal Σ(stored unit_price × qty).
    const expectedTotal = (3 * 25.05 + 7 * 10.1).toFixed(2) // '145.85'
    expect(lastInsertValues).toMatchObject({
      unit_price_275_rebot: '25.05',
      unit_price_330_new: '10.10',
      price: expectedTotal,
    })
  })

  it('revalidates the orders list, the calendar and the dashboard', async () => {
    // Without all three the new card is invisible on /calendar and in the
    // dashboard production widget until a manual reload (Task 63).
    stubInsertReturning(ORDER_ID)
    await createOrder(VALID_CREATE)
    expect(mockRevalidatePath).toHaveBeenCalledWith('/orders')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/calendar')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard')
  })

  it('stores an explicit production_date verbatim, ignoring the delivery-date default', async () => {
    stubInsertReturning(ORDER_ID)
    const result = await createOrder({
      ...VALID_CREATE,
      // Delivery Friday 2026-05-01 would default production to Thursday
      // 2026-04-30. The override names a day three weeks later and must win —
      // position is stored, never derived (CONSTRAINT-19).
      requested_delivery_date: '2026-05-01',
      production_date: '2026-05-21',
    })
    expect(result).toEqual({ id: ORDER_ID })
    expect(lastInsertValues).toMatchObject({
      production_date: '2026-05-21',
      requested_delivery_date: '2026-05-01',
    })
  })

  it('stores an explicit production_date even when no delivery date was given', async () => {
    stubInsertReturning(ORDER_ID)
    await createOrder({
      ...VALID_CREATE,
      requested_delivery_date: '',
      production_date: '2026-05-21',
    })
    expect(lastInsertValues).toMatchObject({
      production_date: '2026-05-21',
      requested_delivery_date: null,
    })
  })

  it('falls back to the delivery-date default when no production_date is sent', async () => {
    // Regression guard: the no-override path must behave exactly as before
    // Task 63 — Friday 2026-05-01 delivery → Thursday 2026-04-30 build day.
    stubInsertReturning(ORDER_ID)
    await createOrder(VALID_CREATE)
    expect(lastInsertValues).toMatchObject({ production_date: '2026-04-30' })
  })

  it('rejects a Saturday production_date with the shared no-weekend message', async () => {
    // 2026-05-23 is a Saturday. The calendar has no column to draw it in.
    const result = await createOrder({ ...VALID_CREATE, production_date: '2026-05-23' })
    expect(result).toEqual({ error: 'Production dates must fall on a weekday.' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects a Sunday production_date', async () => {
    // 2026-05-24 is a Sunday.
    const result = await createOrder({ ...VALID_CREATE, production_date: '2026-05-24' })
    expect(result).toEqual({ error: 'Production dates must fall on a weekday.' })
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects a production_date that is not a real calendar day', async () => {
    const result = await createOrder({ ...VALID_CREATE, production_date: '2026-02-31' })
    expect(result).toEqual({ error: 'Invalid date format.' })
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
    // The log names the failing inputs (EH-02) — po_number is not sensitive.
    expect(consoleSpy).toHaveBeenCalledWith(
      'createOrder: insert failed',
      expect.objectContaining({ poNumber: 'PO-9001', customerId: CUSTOMER_ID }),
    )
    consoleSpy.mockRestore()
  })

  // Feature 14: address-book MRU bookkeeping around the order insert.

  it('bumps last_used_at when delivery_address_id is provided', async () => {
    stubSelectAddressRow({ id: ADDRESS_ID }) // ownership check passes
    stubInsertReturning(ORDER_ID)
    stubUpdateResolves()
    const result = await createOrder({ ...VALID_CREATE, delivery_address_id: ADDRESS_ID })
    expect(result).toEqual({ id: ORDER_ID })
    expect(lastUpdateSet).toMatchObject({ last_used_at: expect.any(Date) })
    // SEC-03 ordering: the ownership lookup ran BEFORE the order insert.
    expect(mockSelect.mock.invocationCallOrder[0]).toBeLessThan(
      mockInsert.mock.invocationCallOrder[0],
    )
    // Only the order row was inserted — a picked address is bumped, not re-added.
    expect(mockInsert).toHaveBeenCalledTimes(1)
    // The customer detail panel renders the address book, so it revalidates too.
    expect(mockRevalidatePath).toHaveBeenCalledWith('/customers')
  })

  it('rejects a delivery_address_id not belonging to the customer', async () => {
    stubSelectAddressRow(null) // no row for (id, customer_id) — foreign/forged id
    const result = await createOrder({ ...VALID_CREATE, delivery_address_id: ADDRESS_ID })
    expect(result).toEqual({
      error: 'Selected delivery address does not belong to this customer.',
    })
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects a malformed delivery_address_id via Zod before touching the database', async () => {
    const result = await createOrder({ ...VALID_CREATE, delivery_address_id: 'not-a-uuid' })
    expect(result).toEqual({ error: 'Invalid delivery address id.' })
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('inserts a new customer address when no id and the text is non-blank', async () => {
    stubInsertReturning(ORDER_ID) // order row
    stubAddressUpsert() // customer_addresses upsert (no probe — L-03)
    const result = await createOrder(VALID_CREATE)
    expect(result).toEqual({ id: ORDER_ID })
    expect(lastAddressInsertValues).toMatchObject({
      customer_id: CUSTOMER_ID,
      address: '123 Main Street',
      last_used_at: expect.any(Date),
    })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockRevalidatePath).toHaveBeenCalledWith('/customers')
  })

  it('dedupes an exact-text match instead of inserting', async () => {
    // One atomic upsert (L-03): a duplicate conflicts with the unique
    // (customer_id, address) index and is bumped in place — never re-added,
    // and never a separate probe/update round trip.
    stubInsertReturning(ORDER_ID) // order row
    stubAddressUpsert() // customer_addresses upsert
    const result = await createOrder(VALID_CREATE)
    expect(result).toEqual({ id: ORDER_ID })
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockSelect).not.toHaveBeenCalled()
    expect(lastAddressConflictSet).toMatchObject({ last_used_at: expect.any(Date) })
  })

  it('writes nothing to the address book when the order is pickup-only', async () => {
    // Blank-address non-pickup input is impossible (schema rejects it), so
    // pickup-only IS the no-address-writes path.
    stubInsertReturning(ORDER_ID)
    const result = await createOrder({
      ...VALID_CREATE,
      pickup_only: true,
      delivery_address: '',
    })
    expect(result).toEqual({ id: ORDER_ID })
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(mockRevalidatePath).not.toHaveBeenCalledWith('/customers')
  })

  it('still returns the order id when address bookkeeping fails after the insert', async () => {
    // The PO row is already committed; reporting an error would push the
    // salesperson into a duplicate-PO retry. The failure logs loudly instead.
    stubInsertReturning(ORDER_ID)
    stubAddressUpsertRejects(new Error('connection terminated')) // upsert blows up
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await createOrder(VALID_CREATE)
    expect(result).toEqual({ id: ORDER_ID })
    expect(consoleSpy).toHaveBeenCalledWith(
      'createOrder: address bookkeeping failed',
      expect.objectContaining({ orderId: ORDER_ID, customerId: CUSTOMER_ID }),
    )
    expect(mockRevalidatePath).not.toHaveBeenCalledWith('/customers')
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

  it('rejects an update whose derived total exceeds the numeric(10,2) ceiling', async () => {
    // Validation runs before any DB read, so the overflow is rejected without
    // touching select/update.
    const result = await updateOrder(ORDER_ID, {
      ...VALID_UPDATE,
      qty_275_rebot: 100_000,
      unit_price_275_rebot: 100, // 100,000 × $100 = $10,000,000 > max
    })
    expect(result).toEqual({
      error: 'Order total exceeds the maximum of $9,999,999.99.',
    })
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

  it('blocks unit-price changes on an invoiced PO even when qty is unchanged', async () => {
    stubSelectCurrent(
      buildCurrentSnapshot({
        status: 'invoiced',
        qty_275_rebot: 12, // matches VALID_UPDATE qty
        unit_price_275_rebot: '99.00', // differs from input unit price 25
        price: '1188.00', // 12 × 99
      }),
    )
    const result = await updateOrder(ORDER_ID, VALID_UPDATE)
    expect(result).toEqual({
      error: 'PO is locked. Revert to scheduled before editing quantities or price.',
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('allows notes-only changes on an invoiced PO (qty + unit price + total unchanged)', async () => {
    stubSelectCurrent(
      buildCurrentSnapshot({
        status: 'invoiced',
        qty_275_rebot: 12, // matches VALID_UPDATE
        unit_price_275_rebot: '25.00', // matches VALID_UPDATE derived unit price
        price: '300.00', // matches derived total 12 × 25
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

  it('revalidates the orders list, the calendar and the dashboard on edit', async () => {
    // An edit can change backhaul, the delivery date, or the quantity mix —
    // all drawn on the calendar card and the dashboard production widget.
    // Before this pinning test the action revalidated only /orders, leaving
    // stale cards on the other two surfaces until a hard reload.
    stubSelectCurrent(buildCurrentSnapshot())
    stubUpdateResolves()
    const result = await updateOrder(ORDER_ID, VALID_UPDATE)
    expect(result).toEqual({ success: true })
    expect(mockRevalidatePath).toHaveBeenCalledWith('/orders')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/calendar')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard')
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
    // All three surfaces draw the row — a completed card dims on the calendar
    // and in the dashboard widget, not just in the orders list.
    expect(mockRevalidatePath).toHaveBeenCalledWith('/orders')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/calendar')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard')
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

describe('defaultProductionDate', () => {
  it('is the business day before the delivery date', () => {
    // Wed 2026-07-29 → Tue 2026-07-28.
    expect(defaultProductionDate('2026-07-29')).toBe('2026-07-28')
  })

  it.each([
    ['Monday', '2026-07-27', '2026-07-24'],
    ['Sunday', '2026-07-26', '2026-07-24'],
    ['Saturday', '2026-07-25', '2026-07-24'],
  ])('resolves a %s delivery to the prior Friday', (_label, delivery, expected) => {
    expect(defaultProductionDate(delivery)).toBe(expected)
  })

  it('never returns a weekend', () => {
    for (let day = 1; day <= 28; day += 1) {
      const delivery = `2026-07-${String(day).padStart(2, '0')}`
      const result = defaultProductionDate(delivery)
      const dayOfWeek = new Date(`${result}T12:00:00`).getDay()
      expect(dayOfWeek, `${delivery} → ${result}`).not.toBe(0)
      expect(dayOfWeek, `${delivery} → ${result}`).not.toBe(6)
    }
  })

  it('throws InvalidDateError on an unparseable delivery date', () => {
    // Coverage removed with the old effectiveProductionDate suite; this helper
    // calls the same parseDbDate and throws identically.
    expect(() => defaultProductionDate('07/29/2026')).toThrow(InvalidDateError)
    expect(() => defaultProductionDate('2026-02-31')).toThrow(InvalidDateError)
  })

  it('returns null when there is no delivery date, leaving the order unscheduled', () => {
    // Correct: nobody has decided when to build it, so it sits in the callout.
    expect(defaultProductionDate(null)).toBeNull()
  })
})
