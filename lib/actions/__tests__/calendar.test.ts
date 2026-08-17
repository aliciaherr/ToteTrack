import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockTransaction = vi.hoisted(() => vi.fn())
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
    transaction: mockTransaction,
  },
}))

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }))

import {
  setProductionPlacement,
  clearProductionPlacement,
  toggleBackhaul,
  toggleSameDayDelivery,
} from '../calendar'
import {
  SORT_INDEX_MAX,
  type SetProductionPlacementInput,
} from '../calendar.validation'
import {
  createFakeTable,
  expectDenseSequence,
  type FakeRow,
  type FakeTable,
} from './placement.fake-db'

const AUTH_OK = { data: { user: { id: 'user-1' } }, error: null }
const AUTH_MISSING = { data: { user: null }, error: null }

const ORDER_ID = '11111111-1111-1111-1111-111111111111'
// A well-formed uuid that belongs to the *pickups* table — used to prove the id
// check and the group literal are two independent guards.
const PICKUP_ID = '44444444-4444-4444-4444-444444444444'

// Siblings sharing the dragged order's column, so a placement has something to
// renumber. Their PO numbers are the read query's final tiebreak.
const SIBLING_B = '22222222-2222-2222-2222-222222222222'
const SIBLING_C = '33333333-3333-3333-3333-333333333333'
const SIBLING_D = '55555555-5555-5555-5555-555555555555'

// 2026-07-27 is a Monday; 2026-07-25 the Saturday before it.
const MONDAY = '2026-07-27'
const TUESDAY = '2026-07-28'
const SATURDAY = '2026-07-25'
const SUNDAY = '2026-07-26'

// Drizzle `.set()` keys for the two columns a production placement writes.
const ORDER_COLUMNS = { dateKey: 'production_date', sortIndex: 'production_sort_index' }

type UpdatePayload = Record<string, unknown>

/**
 * The default column: four orders on one Monday whose indices are all `NULL` —
 * the pre-Task-89 state of every row in production.
 */
const MONDAY_COLUMN: FakeRow[] = [
  { id: ORDER_ID, dateKey: MONDAY, sortIndex: null, tiebreak: 'PO-001' },
  { id: SIBLING_B, dateKey: MONDAY, sortIndex: null, tiebreak: 'PO-002' },
  { id: SIBLING_C, dateKey: MONDAY, sortIndex: null, tiebreak: 'PO-003' },
  { id: SIBLING_D, dateKey: MONDAY, sortIndex: null, tiebreak: 'PO-004' },
]

let table: FakeTable

/** Replaces the backing table for one test. */
function useTable(rows: FakeRow[]): void {
  table = createFakeTable(ORDER_COLUMNS, rows)
  mockTransaction.mockImplementation((run) => table.transaction(run))
}

/** Queues the single status lookup `assertMutable` performs. */
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
 * assertions can inspect exactly which columns the action wrote. Used by the
 * flag toggles, which write a single row outside any transaction.
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

/**
 * Asserts nothing was written by either route — the direct `db.update` the
 * toggles use, or the transaction every placement now runs in.
 */
function expectNoWrites(): void {
  expect(mockUpdate).not.toHaveBeenCalled()
  expect(mockTransaction).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue(AUTH_OK)
  useTable(MONDAY_COLUMN)
})

describe('setProductionPlacement', () => {
  it('writes production_date without touching the delivery date', async () => {
    stubStatus('scheduled')

    const result = await setProductionPlacement(ORDER_ID, {
      group: 'order',
      productionDate: MONDAY,
      sortIndex: 2,
    })

    expect(result).toEqual({ success: true })
    expect(table.row(ORDER_ID)?.dateKey).toBe(MONDAY)
    // CONSTRAINT-19: the customer's delivery promise is never rewritten by a
    // calendar placement, and neither is anything else on the row.
    for (const payload of table.payloads()) {
      expect(payload).not.toHaveProperty('requested_delivery_date')
      expect(payload).not.toHaveProperty('same_day_delivery')
      expect(payload).not.toHaveProperty('status')
    }
    expect(mockRevalidatePath).toHaveBeenCalledWith('/calendar')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard')
  })

  it('a same-day move to index 2 puts the card third and renumbers its siblings', async () => {
    // The defect this task fixes: before it, the dragged card took index 2 while
    // its siblings stayed NULL, and `NULLS LAST` sorted it to the *top*.
    stubStatus('scheduled')

    const result = await setProductionPlacement(ORDER_ID, {
      group: 'order',
      productionDate: MONDAY,
      sortIndex: 2,
    })

    expect(result).toEqual({ success: true })
    expect(table.ids(MONDAY)).toEqual([SIBLING_B, SIBLING_C, ORDER_ID, SIBLING_D])
    expectDenseSequence(table.indices(MONDAY))
  })

  it('a cross-day move renumbers both the origin and the destination', async () => {
    stubStatus('scheduled')
    useTable([
      ...MONDAY_COLUMN,
      { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', dateKey: TUESDAY, sortIndex: null, tiebreak: 'PO-010' },
      { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', dateKey: TUESDAY, sortIndex: null, tiebreak: 'PO-011' },
    ])

    const result = await setProductionPlacement(ORDER_ID, {
      group: 'order',
      productionDate: TUESDAY,
      sortIndex: 1,
    })

    expect(result).toEqual({ success: true })
    expect(table.ids(TUESDAY)[1]).toBe(ORDER_ID)
    expectDenseSequence(table.indices(TUESDAY))
    // The Monday gap closes rather than leaving a hole at the old position.
    expect(table.ids(MONDAY)).toEqual([SIBLING_B, SIBLING_C, SIBLING_D])
    expectDenseSequence(table.indices(MONDAY))
  })

  it('clamps a sort index past the end of the column to last place', async () => {
    stubStatus('scheduled')

    const result = await setProductionPlacement(ORDER_ID, {
      group: 'order',
      productionDate: MONDAY,
      sortIndex: SORT_INDEX_MAX,
    })

    expect(result).toEqual({ success: true })
    expect(table.ids(MONDAY)).toEqual([SIBLING_B, SIBLING_C, SIBLING_D, ORDER_ID])
    expectDenseSequence(table.indices(MONDAY))
  })

  it('rolls the whole column back when a write fails partway through', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubStatus('scheduled')
    // Statement 1 moves the card, statements 2+ renumber the column. Failing the
    // third proves the earlier writes are undone rather than left applied.
    table.failWriteAt(3, 'connection reset')

    const result = await setProductionPlacement(ORDER_ID, {
      group: 'order',
      productionDate: MONDAY,
      sortIndex: 2,
    })

    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(table.indices(MONDAY)).toEqual([null, null, null, null])
    expect(table.ids(MONDAY)).toEqual([ORDER_ID, SIBLING_B, SIBLING_C, SIBLING_D])
    consoleError.mockRestore()
  })

  it('accepts a Saturday date — Task 88 made it a production day', async () => {
    stubStatus('scheduled')

    const result = await setProductionPlacement(ORDER_ID, {
      group: 'order',
      productionDate: SATURDAY,
      sortIndex: 0,
    })

    expect(result).toEqual({ success: true })
    expect(table.ids(SATURDAY)).toEqual([ORDER_ID])
    // The Monday it left closes its gap, same as any other cross-day move.
    expectDenseSequence(table.indices(MONDAY))
  })

  it('rejects a Sunday date', async () => {
    const result = await setProductionPlacement(ORDER_ID, {
      group: 'order',
      productionDate: SUNDAY,
      sortIndex: 0,
    })

    expect(result).toEqual({ error: 'Production dates must fall on Monday through Saturday.' })
    expectNoWrites()
  })

  it('rejects an impossible calendar date that still matches the ISO shape', async () => {
    const result = await setProductionPlacement(ORDER_ID, {
      group: 'order',
      productionDate: '2026-02-31',
      sortIndex: 0,
    })

    expect(result).toEqual({ error: 'Invalid date format.' })
    expectNoWrites()
  })

  it('rejects a sort index above SORT_INDEX_MAX', async () => {
    const result = await setProductionPlacement(ORDER_ID, {
      group: 'order',
      productionDate: MONDAY,
      sortIndex: SORT_INDEX_MAX + 1,
    })

    expect(result).toEqual({ error: `Sort index must be ${SORT_INDEX_MAX} or less.` })
    expectNoWrites()
  })

  it('rejects a cancelled order', async () => {
    stubStatus('cancelled')

    const result = await setProductionPlacement(ORDER_ID, {
      group: 'order',
      productionDate: MONDAY,
      sortIndex: 0,
    })

    expect(result).toEqual({
      error: 'Cancelled orders cannot be placed on the production calendar.',
    })
    expectNoWrites()
  })

  it.each(['completed', 'invoiced'])('rejects a %s order — its card is not draggable', async (status) => {
    stubStatus(status)

    const result = await setProductionPlacement(ORDER_ID, {
      group: 'order',
      productionDate: MONDAY,
      sortIndex: 0,
    })

    expect(result).toHaveProperty('error')
    expectNoWrites()
    // The blocked column keeps its stored indices — a refused placement
    // renumbers nothing.
    expect(table.indices(MONDAY)).toEqual([null, null, null, null])
  })

  it('rejects a malformed order id before any DB access', async () => {
    const result = await setProductionPlacement('not-a-uuid', {
      group: 'order',
      productionDate: MONDAY,
      sortIndex: 0,
    })

    expect(result).toEqual({ error: 'Invalid order id.' })
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('returns a generic message and logs context when the update throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubStatus('scheduled')
    table.failWriteAt(1, 'connection reset')

    const result = await setProductionPlacement(ORDER_ID, {
      group: 'order',
      productionDate: MONDAY,
      sortIndex: 0,
    })

    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(consoleError).toHaveBeenCalledWith(
      'setProductionPlacement: update failed',
      expect.objectContaining({ orderId: ORDER_ID, productionDate: MONDAY }),
    )
    consoleError.mockRestore()
  })
})

describe('setProductionPlacement — the group discriminator is a trust boundary', () => {
  // The mirror of `setPickupPlacement`'s block. Before this literal existed the
  // order action was the asymmetric half: a crossed payload had its `group`
  // silently stripped by Zod and accepted, leaving `assertMutable` failing to
  // find the id as the only guard (T81-L03).
  it('rejects a payload carrying the pickup group', async () => {
    const result = await setProductionPlacement(ORDER_ID, {
      group: 'pickup',
      productionDate: MONDAY,
      sortIndex: 0,
    } as unknown as SetProductionPlacementInput)

    expect(result).toEqual({ error: 'That card is not an order.' })
    expect(mockSelect).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it('rejects a payload with no group at all', async () => {
    const result = await setProductionPlacement(ORDER_ID, {
      productionDate: MONDAY,
      sortIndex: 0,
    } as unknown as SetProductionPlacementInput)

    expect(result).toEqual({ error: 'That card is not an order.' })
    expectNoWrites()
  })

  it('rejects a pickup id even when the payload claims the order group', async () => {
    // The second, independent check: orders and pickups are separate tables, so
    // a pickup id is simply not here and comes back as not-found.
    stubStatus(null)

    const result = await setProductionPlacement(PICKUP_ID, {
      group: 'order',
      productionDate: MONDAY,
      sortIndex: 0,
    })

    expect(result).toEqual({ error: 'Order not found.' })
    expectNoWrites()
  })
})

describe('clearProductionPlacement', () => {
  it('nulls both production columns and renumbers the day it left', async () => {
    stubStatus('scheduled')

    const result = await clearProductionPlacement(SIBLING_B)

    expect(result).toEqual({ success: true })
    expect(table.row(SIBLING_B)).toMatchObject({ dateKey: null, sortIndex: null })
    expect(table.ids(MONDAY)).toEqual([ORDER_ID, SIBLING_C, SIBLING_D])
    expectDenseSequence(table.indices(MONDAY))
    for (const payload of table.payloads()) {
      expect(payload).not.toHaveProperty('requested_delivery_date')
      expect(payload).not.toHaveProperty('same_day_delivery')
    }
    expect(mockRevalidatePath).toHaveBeenCalledWith('/calendar')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard')
  })

  it('returns not-found when the order does not exist', async () => {
    stubStatus(null)

    const result = await clearProductionPlacement(ORDER_ID)

    expect(result).toEqual({ error: 'Order not found.' })
    expectNoWrites()
  })
})

describe('toggleSameDayDelivery', () => {
  it('persists the boolean', async () => {
    stubStatus('scheduled')
    const captured = captureUpdatePayload()

    const result = await toggleSameDayDelivery(ORDER_ID, true)

    expect(result).toEqual({ success: true })
    expect(captured.current).toMatchObject({ same_day_delivery: true })
    expect(captured.current).not.toHaveProperty('production_date')
    expect(captured.current).not.toHaveProperty('requested_delivery_date')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/calendar')
  })

  it('persists a false target state', async () => {
    stubStatus('scheduled')
    const captured = captureUpdatePayload()

    await toggleSameDayDelivery(ORDER_ID, false)

    expect(captured.current).toMatchObject({ same_day_delivery: false })
  })

  it('stays available on a completed order — the flag is not a placement', async () => {
    stubStatus('completed')
    const captured = captureUpdatePayload()

    const result = await toggleSameDayDelivery(ORDER_ID, true)

    expect(result).toEqual({ success: true })
    expect(captured.current).toMatchObject({ same_day_delivery: true })
  })

  it('rejects a cancelled order', async () => {
    stubStatus('cancelled')

    const result = await toggleSameDayDelivery(ORDER_ID, true)

    expect(result).toEqual({
      error: 'Cancelled orders cannot be marked for same-day delivery.',
    })
    expectNoWrites()
  })
})

describe('toggleBackhaul', () => {
  it('persists the boolean without touching any other column', async () => {
    stubStatus('scheduled')
    const captured = captureUpdatePayload()

    const result = await toggleBackhaul(ORDER_ID, true)

    expect(result).toEqual({ success: true })
    expect(captured.current).toMatchObject({ backhaul: true })
    expect(captured.current).not.toHaveProperty('production_date')
    expect(captured.current).not.toHaveProperty('requested_delivery_date')
    expect(captured.current).not.toHaveProperty('same_day_delivery')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/calendar')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard')
  })

  it('persists a false target state', async () => {
    stubStatus('scheduled')
    const captured = captureUpdatePayload()

    await toggleBackhaul(ORDER_ID, false)

    expect(captured.current).toMatchObject({ backhaul: false })
  })

  it.each(['completed', 'invoiced'])(
    'stays available on a %s order — CONSTRAINT-18 locks qty and price, not flags',
    async (status) => {
      stubStatus(status)
      const captured = captureUpdatePayload()

      const result = await toggleBackhaul(ORDER_ID, true)

      expect(result).toEqual({ success: true })
      expect(captured.current).toMatchObject({ backhaul: true })
    },
  )

  it('rejects a cancelled order', async () => {
    stubStatus('cancelled')

    const result = await toggleBackhaul(ORDER_ID, true)

    expect(result).toEqual({ error: 'Cancelled orders cannot be marked as backhaul.' })
    expectNoWrites()
  })

  it('rejects a malformed order id before any DB access', async () => {
    const result = await toggleBackhaul('not-a-uuid', true)

    expect(result).toEqual({ error: 'Invalid order id.' })
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('returns a generic message and logs context when the update throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubStatus('scheduled')
    mockUpdate.mockImplementationOnce(() => {
      throw new Error('connection reset')
    })

    const result = await toggleBackhaul(ORDER_ID, true)

    expect(result).toEqual({ error: 'Something went wrong. Please try again.' })
    expect(consoleError).toHaveBeenCalledWith(
      'toggleBackhaul: update failed',
      expect.objectContaining({ orderId: ORDER_ID, next: true }),
    )
    consoleError.mockRestore()
  })
})

describe('authentication', () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue(AUTH_MISSING)
  })

  it('rejects unauthenticated calls before any DB access', async () => {
    const placement = await setProductionPlacement(ORDER_ID, {
      group: 'order',
      productionDate: MONDAY,
      sortIndex: 0,
    })
    const cleared = await clearProductionPlacement(ORDER_ID)
    const toggled = await toggleSameDayDelivery(ORDER_ID, true)
    const backhauled = await toggleBackhaul(ORDER_ID, true)

    expect(placement).toEqual({ error: 'You are not signed in.' })
    expect(cleared).toEqual({ error: 'You are not signed in.' })
    expect(toggled).toEqual({ error: 'You are not signed in.' })
    expect(backhauled).toEqual({ error: 'You are not signed in.' })
    expect(mockSelect).not.toHaveBeenCalled()
    expectNoWrites()
  })
})
