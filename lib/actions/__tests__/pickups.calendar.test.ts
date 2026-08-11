import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockRevalidatePath = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
  }),
}))

vi.mock('@/db', () => ({
  db: {
    select: mockSelect,
    update: mockUpdate,
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }))

import { clearPickupPlacement, setPickupPlacement } from '../pickups.calendar'
import { SORT_INDEX_MAX } from '../calendar.validation'
import type { SetPickupPlacementInput } from '../pickups.calendar.validation'

const AUTH_OK = { data: { user: { id: 'user-1' } }, error: null }
const AUTH_MISSING = { data: { user: null }, error: null }

const PICKUP_ID = '44444444-4444-4444-4444-444444444444'
const ORDER_ID = '11111111-1111-1111-1111-111111111111'

// 2026-07-27 is a Monday; 2026-07-25 the Saturday before it. A pickup carries
// no weekday rule, unlike a production date — see the weekend case below.
const MONDAY = '2026-07-27'
const SATURDAY = '2026-07-25'

const GENERIC_FAILURE = 'Something went wrong. Please try again.'
// The auth guard's own copy, shared by every action module.
const NOT_SIGNED_IN = 'You are not signed in.'

type UpdatePayload = Record<string, unknown>

/** A well-formed placement payload, so each test varies only what it is about. */
function placementInput(overrides: Partial<SetPickupPlacementInput> = {}) {
  return { group: 'pickup', pickupDate: MONDAY, sortIndex: 0, ...overrides } as SetPickupPlacementInput
}

/** Queues the single status lookup `assertPlaceable` performs. */
function stubStatus(status: string | null) {
  mockSelect.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(status === null ? [] : [{ status }]),
      }),
    }),
  })
}

/**
 * Queues one `db.update(...)` and records the payload handed to `.set()`, so
 * assertions can inspect exactly which columns the action wrote.
 */
function captureUpdatePayload(): { current: UpdatePayload | null } {
  const captured: { current: UpdatePayload | null } = { current: null }
  mockUpdate.mockReturnValueOnce({
    set: (payload: UpdatePayload) => {
      captured.current = payload
      return { where: () => Promise.resolve(undefined) }
    },
  })
  return captured
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue(AUTH_OK)
})

describe('setPickupPlacement', () => {
  it('writes the date and sort index', async () => {
    stubStatus('scheduled')
    const captured = captureUpdatePayload()

    const result = await setPickupPlacement(PICKUP_ID, placementInput({ sortIndex: 2 }))

    expect(result).toEqual({ success: true })
    expect(captured.current).toMatchObject({ pickup_date: MONDAY, sort_index: 2 })
    // A pickup's date *is* its placement (CONSTRAINT-25) — quantities, address,
    // notes and status are untouched by a drag.
    expect(captured.current).not.toHaveProperty('qty_275')
    expect(captured.current).not.toHaveProperty('status')
  })

  it('rejects an unknown pickup id', async () => {
    stubStatus(null)

    const result = await setPickupPlacement(PICKUP_ID, placementInput())

    expect(result).toEqual({ error: 'Pickup not found.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('accepts a weekend date — a collection carries no business-day rule', async () => {
    // Deliberately unlike `setProductionPlacement`, which rejects one: the
    // calendar renders Mon–Fri, but the server must not invent an invariant
    // the entity does not have.
    stubStatus('scheduled')
    const captured = captureUpdatePayload()

    const result = await setPickupPlacement(PICKUP_ID, placementInput({ pickupDate: SATURDAY }))

    expect(result).toEqual({ success: true })
    expect(captured.current).toMatchObject({ pickup_date: SATURDAY })
  })

  it('revalidates the calendar and pickups, and never the dashboard', async () => {
    stubStatus('scheduled')
    captureUpdatePayload()

    await setPickupPlacement(PICKUP_ID, placementInput())

    const paths = mockRevalidatePath.mock.calls.map((call) => call[0])
    expect(paths).toContain('/calendar')
    expect(paths).toContain('/pickups')
    // No dashboard widget reads pickups (CONSTRAINT-25).
    expect(paths).not.toContain('/dashboard')
  })

  it('refuses to move a completed pickup', async () => {
    stubStatus('completed')

    const result = await setPickupPlacement(PICKUP_ID, placementInput())

    expect(result).toEqual({ error: 'Completed pickups cannot be moved on the calendar.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('an invalid uuid is rejected before any query', async () => {
    const result = await setPickupPlacement('not-a-uuid', placementInput())

    expect(result).toEqual({ error: 'Invalid pickup id.' })
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('unauthenticated is refused and writes nothing', async () => {
    mockGetUser.mockResolvedValue(AUTH_MISSING)

    const result = await setPickupPlacement(PICKUP_ID, placementInput())

    expect(result).toEqual({ error: NOT_SIGNED_IN })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects an out-of-range sort index', async () => {
    const result = await setPickupPlacement(
      PICKUP_ID,
      placementInput({ sortIndex: SORT_INDEX_MAX + 1 }),
    )

    expect(result).toEqual({ error: `Sort index must be ${SORT_INDEX_MAX} or less.` })
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('rejects an impossible date', async () => {
    const result = await setPickupPlacement(PICKUP_ID, placementInput({ pickupDate: '2026-02-30' }))

    expect('error' in result).toBe(true)
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('logs the cause and returns the generic failure when the write throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubStatus('scheduled')
    mockUpdate.mockReturnValueOnce({
      set: () => ({ where: () => Promise.reject(new Error('driver exploded')) }),
    })

    const result = await setPickupPlacement(PICKUP_ID, placementInput())

    // EH-01/02: the real cause is logged with the operation and ids; only the
    // generic message crosses back to the client.
    expect(result).toEqual({ error: GENERIC_FAILURE })
    expect(consoleError).toHaveBeenCalledWith(
      'setPickupPlacement: update failed',
      expect.objectContaining({ operation: 'setPickupPlacement', pickupId: PICKUP_ID }),
    )
    consoleError.mockRestore()
  })
})

describe('setPickupPlacement — the group discriminator is a trust boundary', () => {
  it('rejects a payload carrying the order group', async () => {
    // The crossed payload: a client that reuses the order placement shape, or
    // hand-crafts one, must be refused by the *server* — the UI preventing the
    // mistake is not the guarantee (CONSTRAINT-25).
    const result = await setPickupPlacement(PICKUP_ID, {
      group: 'order',
      pickupDate: MONDAY,
      sortIndex: 0,
    } as unknown as SetPickupPlacementInput)

    expect(result).toEqual({ error: 'That card is not a pickup.' })
    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects a payload with no group at all', async () => {
    const result = await setPickupPlacement(PICKUP_ID, {
      pickupDate: MONDAY,
      sortIndex: 0,
    } as unknown as SetPickupPlacementInput)

    expect(result).toEqual({ error: 'That card is not a pickup.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects an order id even when the payload claims the pickup group', async () => {
    // The second, independent check: pickups and orders are separate tables, so
    // an order id is simply not here and comes back as not-found. A well-formed
    // payload cannot smuggle a row from the other table into this write.
    stubStatus(null)

    const result = await setPickupPlacement(ORDER_ID, placementInput())

    expect(result).toEqual({ error: 'Pickup not found.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

describe('clearPickupPlacement', () => {
  it('nulls both the date and the sort index', async () => {
    stubStatus('scheduled')
    const captured = captureUpdatePayload()

    const result = await clearPickupPlacement(PICKUP_ID)

    expect(result).toEqual({ success: true })
    // Supersedes Task 80's `updatePickup` shortcut (INFO-05), which left
    // `sort_index` pointing at a column the pickup no longer sits in.
    expect(captured.current).toMatchObject({ pickup_date: null, sort_index: null })
  })

  it('leaves the collection itself alone — this clears a day, not a pickup', async () => {
    stubStatus('scheduled')
    const captured = captureUpdatePayload()

    await clearPickupPlacement(PICKUP_ID)

    for (const column of ['qty_275', 'qty_330', 'status', 'address', 'notes', 'customer_id']) {
      expect(captured.current).not.toHaveProperty(column)
    }
  })

  it('rejects an unknown pickup id', async () => {
    stubStatus(null)

    const result = await clearPickupPlacement(PICKUP_ID)

    expect(result).toEqual({ error: 'Pickup not found.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('an invalid uuid is rejected before any query', async () => {
    const result = await clearPickupPlacement('../../etc/passwd')

    expect(result).toEqual({ error: 'Invalid pickup id.' })
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('unauthenticated is refused and writes nothing', async () => {
    mockGetUser.mockResolvedValue(AUTH_MISSING)

    const result = await clearPickupPlacement(PICKUP_ID)

    expect(result).toEqual({ error: NOT_SIGNED_IN })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('refuses to unplace a completed pickup', async () => {
    stubStatus('completed')

    const result = await clearPickupPlacement(PICKUP_ID)

    expect(result).toEqual({ error: 'Completed pickups cannot be moved on the calendar.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('logs the cause and returns the generic failure when the write throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubStatus('scheduled')
    mockUpdate.mockReturnValueOnce({
      set: () => ({ where: () => Promise.reject(new Error('driver exploded')) }),
    })

    const result = await clearPickupPlacement(PICKUP_ID)

    expect(result).toEqual({ error: GENERIC_FAILURE })
    expect(consoleError).toHaveBeenCalledWith(
      'clearPickupPlacement: update failed',
      expect.objectContaining({ operation: 'clearPickupPlacement', pickupId: PICKUP_ID }),
    )
    consoleError.mockRestore()
  })
})
