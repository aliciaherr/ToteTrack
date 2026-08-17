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

import { clearPickupPlacement, setPickupPlacement } from '../pickups.calendar'
import { SORT_INDEX_MAX } from '../calendar.validation'
import type { SetPickupPlacementInput } from '../pickups.calendar.validation'
import {
  createFakeTable,
  expectDenseSequence,
  type FakeRow,
  type FakeTable,
} from './placement.fake-db'

const AUTH_OK = { data: { user: { id: 'user-1' } }, error: null }
const AUTH_MISSING = { data: { user: null }, error: null }

const PICKUP_ID = '44444444-4444-4444-4444-444444444444'
const ORDER_ID = '11111111-1111-1111-1111-111111111111'

// Pickups sharing the moved one's column, so a placement has something to
// renumber. Their `created_at` values are the read query's final tiebreak — a
// pickup has no PO number to fall back on.
const SIBLING_B = '66666666-6666-6666-6666-666666666666'
const SIBLING_C = '77777777-7777-7777-7777-777777777777'

// 2026-07-27 is a Monday; 2026-07-25 the Saturday before it. A pickup carries
// no production-day rule, unlike a production date — see the Sunday case below.
const MONDAY = '2026-07-27'
const SATURDAY = '2026-07-25'
const SUNDAY = '2026-07-26'

const GENERIC_FAILURE = 'Something went wrong. Please try again.'
// The auth guard's own copy, shared by every action module.
const NOT_SIGNED_IN = 'You are not signed in.'

// Drizzle `.set()` keys for the two columns a pickup placement writes.
const PICKUP_COLUMNS = { dateKey: 'pickup_date', sortIndex: 'sort_index' }

// The columns the *order* half owns. No pickup write may ever name one — the
// two groups are separate tables with separate configs (CONSTRAINT-25).
const ORDER_ONLY_COLUMNS = ['production_date', 'production_sort_index']

/** Three pickups on one Monday, indices all `NULL` — the pre-Task-89 state. */
const MONDAY_COLUMN: FakeRow[] = [
  { id: PICKUP_ID, dateKey: MONDAY, sortIndex: null, tiebreak: '2026-01-01T09:00:00Z' },
  { id: SIBLING_B, dateKey: MONDAY, sortIndex: null, tiebreak: '2026-01-02T09:00:00Z' },
  { id: SIBLING_C, dateKey: MONDAY, sortIndex: null, tiebreak: '2026-01-03T09:00:00Z' },
]

let table: FakeTable

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
 * Asserts nothing was written by either route — a direct `db.update`, or the
 * transaction every placement now runs in.
 */
function expectNoWrites(): void {
  expect(mockUpdate).not.toHaveBeenCalled()
  expect(mockTransaction).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockResolvedValue(AUTH_OK)
  table = createFakeTable(PICKUP_COLUMNS, MONDAY_COLUMN)
  mockTransaction.mockImplementation((run) => table.transaction(run))
})

describe('setPickupPlacement', () => {
  it('writes the date and leaves the collection itself alone', async () => {
    stubStatus('scheduled')

    const result = await setPickupPlacement(PICKUP_ID, placementInput({ sortIndex: 2 }))

    expect(result).toEqual({ success: true })
    expect(table.row(PICKUP_ID)?.dateKey).toBe(MONDAY)
    // A pickup's date *is* its placement (CONSTRAINT-25) — quantities, address,
    // notes and status are untouched by a drag.
    for (const payload of table.payloads()) {
      expect(payload).not.toHaveProperty('qty_275')
      expect(payload).not.toHaveProperty('status')
    }
  })

  it('a same-day reorder lands the card at the released position and renumbers the column', async () => {
    // The defect this task fixes: before it, the moved pickup took index 2 while
    // its siblings stayed NULL, and `NULLS LAST` sorted it to the *top*.
    stubStatus('scheduled')

    const result = await setPickupPlacement(PICKUP_ID, placementInput({ sortIndex: 2 }))

    expect(result).toEqual({ success: true })
    expect(table.ids(MONDAY)).toEqual([SIBLING_B, SIBLING_C, PICKUP_ID])
    expectDenseSequence(table.indices(MONDAY))
  })

  it('never names an order column, so orders sharing the day are not renumbered', async () => {
    // The guarantee is structural: `pickups.calendar.ts` drives the renumberer
    // with a config naming `pickups` and only `pickups`, so no statement this
    // action issues can reach the orders table (CONSTRAINT-25).
    stubStatus('scheduled')

    await setPickupPlacement(PICKUP_ID, placementInput({ sortIndex: 1 }))

    expect(table.payloads().length).toBeGreaterThan(0)
    for (const payload of table.payloads()) {
      for (const column of ORDER_ONLY_COLUMNS) {
        expect(payload).not.toHaveProperty(column)
      }
    }
  })

  it('clamps a sort index past the end of the column to last place', async () => {
    stubStatus('scheduled')

    const result = await setPickupPlacement(PICKUP_ID, placementInput({ sortIndex: SORT_INDEX_MAX }))

    expect(result).toEqual({ success: true })
    expect(table.ids(MONDAY)).toEqual([SIBLING_B, SIBLING_C, PICKUP_ID])
    expectDenseSequence(table.indices(MONDAY))
  })

  it('rolls the whole column back when a write fails partway through', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubStatus('scheduled')
    // Statement 1 moves the card, statements 2+ renumber the column.
    table.failWriteAt(3, 'driver exploded')

    const result = await setPickupPlacement(PICKUP_ID, placementInput({ sortIndex: 2 }))

    expect(result).toEqual({ error: GENERIC_FAILURE })
    expect(table.indices(MONDAY)).toEqual([null, null, null])
    expect(table.ids(MONDAY)).toEqual([PICKUP_ID, SIBLING_B, SIBLING_C])
    consoleError.mockRestore()
  })

  it('rejects an unknown pickup id', async () => {
    stubStatus(null)

    const result = await setPickupPlacement(PICKUP_ID, placementInput())

    expect(result).toEqual({ error: 'Pickup not found.' })
    expectNoWrites()
  })

  it.each([SATURDAY, SUNDAY])(
    'accepts %s — a collection carries no production-day rule',
    async (weekendDate) => {
      // Deliberately unlike `setProductionPlacement`, which rejects Sunday: the
      // calendar renders Mon–Sat, but the server must not invent an invariant
      // the entity does not have.
      stubStatus('scheduled')

      const result = await setPickupPlacement(PICKUP_ID, placementInput({ pickupDate: weekendDate }))

      expect(result).toEqual({ success: true })
      expect(table.row(PICKUP_ID)?.dateKey).toBe(weekendDate)
    },
  )

  it('revalidates the calendar and pickups, and never the dashboard', async () => {
    stubStatus('scheduled')

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
    expectNoWrites()
    expect(table.indices(MONDAY)).toEqual([null, null, null])
  })

  it('an invalid uuid is rejected before any query', async () => {
    const result = await setPickupPlacement('not-a-uuid', placementInput())

    expect(result).toEqual({ error: 'Invalid pickup id.' })
    expect(mockSelect).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it('unauthenticated is refused and writes nothing', async () => {
    mockGetUser.mockResolvedValue(AUTH_MISSING)

    const result = await setPickupPlacement(PICKUP_ID, placementInput())

    expect(result).toEqual({ error: NOT_SIGNED_IN })
    expectNoWrites()
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
    table.failWriteAt(1, 'driver exploded')

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
    expectNoWrites()
  })

  it('rejects a payload with no group at all', async () => {
    const result = await setPickupPlacement(PICKUP_ID, {
      pickupDate: MONDAY,
      sortIndex: 0,
    } as unknown as SetPickupPlacementInput)

    expect(result).toEqual({ error: 'That card is not a pickup.' })
    expectNoWrites()
  })

  it('rejects an order id even when the payload claims the pickup group', async () => {
    // The second, independent check: pickups and orders are separate tables, so
    // an order id is simply not here and comes back as not-found. A well-formed
    // payload cannot smuggle a row from the other table into this write.
    stubStatus(null)

    const result = await setPickupPlacement(ORDER_ID, placementInput())

    expect(result).toEqual({ error: 'Pickup not found.' })
    expectNoWrites()
  })
})

describe('clearPickupPlacement', () => {
  it('nulls both columns and renumbers the day it left', async () => {
    stubStatus('scheduled')

    const result = await clearPickupPlacement(SIBLING_B)

    expect(result).toEqual({ success: true })
    // Supersedes Task 80's `updatePickup` shortcut (INFO-05), which left
    // `sort_index` pointing at a column the pickup no longer sits in.
    expect(table.row(SIBLING_B)).toMatchObject({ dateKey: null, sortIndex: null })
    expect(table.ids(MONDAY)).toEqual([PICKUP_ID, SIBLING_C])
    expectDenseSequence(table.indices(MONDAY))
  })

  it('leaves the collection itself alone — this clears a day, not a pickup', async () => {
    stubStatus('scheduled')

    await clearPickupPlacement(PICKUP_ID)

    for (const payload of table.payloads()) {
      for (const column of ['qty_275', 'qty_330', 'status', 'address', 'notes', 'customer_id']) {
        expect(payload).not.toHaveProperty(column)
      }
    }
  })

  it('rejects an unknown pickup id', async () => {
    stubStatus(null)

    const result = await clearPickupPlacement(PICKUP_ID)

    expect(result).toEqual({ error: 'Pickup not found.' })
    expectNoWrites()
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
    expectNoWrites()
  })

  it('refuses to unplace a completed pickup', async () => {
    stubStatus('completed')

    const result = await clearPickupPlacement(PICKUP_ID)

    expect(result).toEqual({ error: 'Completed pickups cannot be moved on the calendar.' })
    expectNoWrites()
  })

  it('logs the cause and returns the generic failure when the write throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubStatus('scheduled')
    table.failWriteAt(1, 'driver exploded')

    const result = await clearPickupPlacement(PICKUP_ID)

    expect(result).toEqual({ error: GENERIC_FAILURE })
    expect(consoleError).toHaveBeenCalledWith(
      'clearPickupPlacement: update failed',
      expect.objectContaining({ operation: 'clearPickupPlacement', pickupId: PICKUP_ID }),
    )
    consoleError.mockRestore()
  })
})
