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

import {
  setProductionPlacement,
  clearProductionPlacement,
  toggleBackhaul,
  toggleSameDayDelivery,
} from '../calendar'
import { SORT_INDEX_MAX } from '../calendar.validation'

const AUTH_OK = { data: { user: { id: 'user-1' } }, error: null }
const AUTH_MISSING = { data: { user: null }, error: null }

const ORDER_ID = '11111111-1111-1111-1111-111111111111'

// 2026-07-27 is a Monday; 2026-07-25 the Saturday before it.
const MONDAY = '2026-07-27'
const SATURDAY = '2026-07-25'
const SUNDAY = '2026-07-26'

type UpdatePayload = Record<string, unknown>

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

describe('setProductionPlacement', () => {
  it('writes production_date and sort index without touching the delivery date', async () => {
    stubStatus('scheduled')
    const captured = captureUpdatePayload()

    const result = await setProductionPlacement(ORDER_ID, {
      productionDate: MONDAY,
      sortIndex: 2,
    })

    expect(result).toEqual({ success: true })
    expect(captured.current).toMatchObject({
      production_date: MONDAY,
      production_sort_index: 2,
    })
    // CONSTRAINT-19: the customer's delivery promise is never rewritten by a
    // calendar placement.
    expect(captured.current).not.toHaveProperty('requested_delivery_date')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/calendar')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard')
  })

  it('rejects a Saturday date', async () => {
    const result = await setProductionPlacement(ORDER_ID, {
      productionDate: SATURDAY,
      sortIndex: 0,
    })

    expect(result).toEqual({ error: 'Production dates must fall on a weekday.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects a Sunday date', async () => {
    const result = await setProductionPlacement(ORDER_ID, {
      productionDate: SUNDAY,
      sortIndex: 0,
    })

    expect(result).toEqual({ error: 'Production dates must fall on a weekday.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects an impossible calendar date that still matches the ISO shape', async () => {
    const result = await setProductionPlacement(ORDER_ID, {
      productionDate: '2026-02-31',
      sortIndex: 0,
    })

    expect(result).toEqual({ error: 'Invalid date format.' })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects a sort index above SORT_INDEX_MAX', async () => {
    const result = await setProductionPlacement(ORDER_ID, {
      productionDate: MONDAY,
      sortIndex: SORT_INDEX_MAX + 1,
    })

    expect(result).toEqual({ error: `Sort index must be ${SORT_INDEX_MAX} or less.` })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects a cancelled order', async () => {
    stubStatus('cancelled')

    const result = await setProductionPlacement(ORDER_ID, {
      productionDate: MONDAY,
      sortIndex: 0,
    })

    expect(result).toEqual({
      error: 'Cancelled orders cannot be placed on the production calendar.',
    })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it.each(['completed', 'invoiced'])('rejects a %s order — its card is not draggable', async (status) => {
    stubStatus(status)

    const result = await setProductionPlacement(ORDER_ID, {
      productionDate: MONDAY,
      sortIndex: 0,
    })

    expect(result).toHaveProperty('error')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('rejects a malformed order id before any DB access', async () => {
    const result = await setProductionPlacement('not-a-uuid', {
      productionDate: MONDAY,
      sortIndex: 0,
    })

    expect(result).toEqual({ error: 'Invalid order id.' })
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('returns a generic message and logs context when the update throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    stubStatus('scheduled')
    mockUpdate.mockImplementationOnce(() => {
      throw new Error('connection reset')
    })

    const result = await setProductionPlacement(ORDER_ID, {
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

describe('clearProductionPlacement', () => {
  it('nulls both production columns', async () => {
    stubStatus('scheduled')
    const captured = captureUpdatePayload()

    const result = await clearProductionPlacement(ORDER_ID)

    expect(result).toEqual({ success: true })
    expect(captured.current).toMatchObject({
      production_date: null,
      production_sort_index: null,
    })
    expect(captured.current).not.toHaveProperty('requested_delivery_date')
    expect(captured.current).not.toHaveProperty('same_day_delivery')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/calendar')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard')
  })

  it('returns not-found when the order does not exist', async () => {
    stubStatus(null)

    const result = await clearProductionPlacement(ORDER_ID)

    expect(result).toEqual({ error: 'Order not found.' })
    expect(mockUpdate).not.toHaveBeenCalled()
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
    expect(mockUpdate).not.toHaveBeenCalled()
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
    expect(mockUpdate).not.toHaveBeenCalled()
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
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
