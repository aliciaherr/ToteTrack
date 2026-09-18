import { render, screen } from '@testing-library/react'
import { renderHook, act, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DndContext } from '@dnd-kit/core'
import DayColumn from '../DayColumn'
import { ArmModeProvider, useArmModeState, type ArmModeValue } from '../armMode'
import { PickupVisibilityProvider } from '../pickupVisibility'
import { FLY_RESET_MS, type ArmedCard } from '../armPlacement'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

const MONDAY = '2026-07-27'
const TUESDAY = '2026-07-28'

function makeRow(overrides: Partial<CalendarOrderRow> = {}): CalendarOrderRow {
  return {
    id: 'order-1',
    po_number: 'PO-1000',
    customer_id: '22222222-2222-2222-2222-222222222222',
    customer_name: 'Acme Industrial',
    status: 'scheduled',
    qty_275_recon: 12,
    qty_275_rebot: 0,
    qty_275_new: 0,
    qty_330_recon: 0,
    qty_330_rebot: 0,
    qty_330_new: 0,
    price: '4200.00',
    unit_price_275_recon: '350.00',
    unit_price_275_rebot: null,
    unit_price_275_new: null,
    unit_price_330_recon: null,
    unit_price_330_rebot: null,
    unit_price_330_new: null,
    backhaul: false,
    notes: null,
    same_day_delivery: false,
    production_date: MONDAY,
    requested_delivery_date: '2026-07-31',
    production_sort_index: 0,
    contacts: [],
    ...overrides,
  }
}

function makePickup(overrides: Partial<CalendarPickupRow> = {}): CalendarPickupRow {
  return {
    id: 'pickup-1',
    customer_id: '33333333-3333-3333-3333-333333333333',
    customer_name: 'Northside Bottling',
    status: 'scheduled',
    qty_275: 12,
    qty_330: 4,
    pickup_date: MONDAY,
    sort_index: 0,
    address: null,
    notes: null,
    contacts: [],
    ...overrides,
  }
}

function armedAt(dateKey: string, index: number): ArmedCard {
  return { group: 'order', row: makeRow(), dateKey, index }
}

function armedPickupAt(dateKey: string, index: number): ArmedCard {
  return { group: 'pickup', row: makePickup(), dateKey, index }
}

describe('useArmModeState', () => {
  const place = vi.fn()
  const unschedule = vi.fn()

  beforeEach(() => {
    place.mockClear()
    unschedule.mockClear()
  })

  it('routes an armed tap on a day target to the placement mutation and disarms', () => {
    const { result } = renderHook(() => useArmModeState(place, unschedule, false))

    act(() => result.current.arm(armedAt(MONDAY, 0)))
    expect(result.current.armed?.row.id).toBe('order-1')

    act(() =>
      result.current.tap({ type: 'column', group: 'order', dateKey: TUESDAY, cardCount: 2 }),
    )

    expect(place).toHaveBeenCalledWith({
      group: 'order',
      cardId: 'order-1',
      dateKey: TUESDAY,
      index: 2,
    })
    expect(result.current.armed).toBeNull()
  })

  it('routes an armed tap on the callout to the unschedule mutation', () => {
    const { result } = renderHook(() => useArmModeState(place, unschedule, false))

    act(() => result.current.arm(armedAt(MONDAY, 0)))
    act(() => result.current.tap({ type: 'callout', group: 'order' }))

    expect(unschedule).toHaveBeenCalledWith({ group: 'order', cardId: 'order-1' })
    expect(place).not.toHaveBeenCalled()
  })

  it('routes an armed pickup to the same callbacks, carrying its own group', () => {
    // The hook never chooses a table — `useGroupedPlacement` does, from this
    // discriminator (CONSTRAINT-25).
    const { result } = renderHook(() => useArmModeState(place, unschedule, false))

    act(() => result.current.arm(armedPickupAt(MONDAY, 0)))
    act(() =>
      result.current.tap({ type: 'column', group: 'pickup', dateKey: TUESDAY, cardCount: 1 }),
    )

    expect(place).toHaveBeenCalledWith({
      group: 'pickup',
      cardId: 'pickup-1',
      dateKey: TUESDAY,
      index: 1,
    })
  })

  it('a cross-group tap disarms and reaches neither mutation', () => {
    const { result } = renderHook(() => useArmModeState(place, unschedule, false))

    act(() => result.current.arm(armedPickupAt(MONDAY, 0)))
    act(() =>
      result.current.tap({ type: 'column', group: 'order', dateKey: TUESDAY, cardCount: 2 }),
    )

    expect(place).not.toHaveBeenCalled()
    expect(unschedule).not.toHaveBeenCalled()
    expect(result.current.armed).toBeNull()
  })

  it('ignores taps while nothing is armed — the unarmed calendar is untouched', () => {
    const { result } = renderHook(() => useArmModeState(place, unschedule, false))

    act(() =>
      result.current.tap({ type: 'column', group: 'order', dateKey: TUESDAY, cardCount: 2 }),
    )

    expect(place).not.toHaveBeenCalled()
    expect(unschedule).not.toHaveBeenCalled()
  })

  it('cancel disarms without any mutation', () => {
    const { result } = renderHook(() => useArmModeState(place, unschedule, false))

    act(() => result.current.arm(armedAt(MONDAY, 0)))
    act(() => result.current.cancel())

    expect(result.current.armed).toBeNull()
    expect(place).not.toHaveBeenCalled()
    expect(unschedule).not.toHaveBeenCalled()
  })

  it('marks a placed card as flying, then clears it after the animation window', () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() => useArmModeState(place, unschedule, false))

      act(() => result.current.arm(armedAt(MONDAY, 0)))
      act(() =>
        result.current.tap({ type: 'column', group: 'order', dateKey: TUESDAY, cardCount: 0 }),
      )
      expect(result.current.flyingId).toBe('order-1')

      act(() => vi.advanceTimersByTime(FLY_RESET_MS))
      expect(result.current.flyingId).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never marks a card as flying under reduced motion', () => {
    const { result } = renderHook(() => useArmModeState(place, unschedule, true))

    act(() => result.current.arm(armedAt(MONDAY, 0)))
    act(() =>
      result.current.tap({ type: 'column', group: 'order', dateKey: TUESDAY, cardCount: 0 }),
    )

    expect(place).toHaveBeenCalled()
    expect(result.current.flyingId).toBeNull()
  })
})

const BOTH_LISTS_ON = {
  view: 'both' as const,
  showOrders: true,
  showPickups: true,
  cycleView: vi.fn(),
  setView: vi.fn(),
}

/** DayColumn with a hand-built arm-mode value, for tap-surface wiring tests. */
function renderColumn(
  value: ArmModeValue,
  rows: CalendarOrderRow[],
  pickups: CalendarPickupRow[] = [],
) {
  return render(
    <DndContext>
      <ArmModeProvider value={value}>
        <PickupVisibilityProvider value={BOTH_LISTS_ON}>
          <DayColumn
            date={new Date(2026, 6, 28)}
            rows={rows}
            pickups={pickups}
            isToday={false}
            unscheduled={[]}
            unscheduledPickups={[]}
            onPick={vi.fn()}
            onPickPickup={vi.fn()}
            onSelectPickup={vi.fn()}
          />
        </PickupVisibilityProvider>
      </ArmModeProvider>
    </DndContext>,
  )
}

function armModeValue(overrides: Partial<ArmModeValue> = {}): ArmModeValue {
  return {
    armed: armedAt(MONDAY, 0),
    flyingId: null,
    arm: vi.fn(),
    cancel: vi.fn(),
    tap: vi.fn(),
    ...overrides,
  }
}

describe('armed tap surfaces', () => {
  it('a tap on a column’s list space reports the column and its card count', () => {
    const value = armModeValue()
    const rows = [makeRow({ id: 'order-2', po_number: 'PO-1001', production_date: TUESDAY })]
    renderColumn(value, rows)

    fireEvent.click(screen.getByRole('list'))

    expect(value.tap).toHaveBeenCalledWith({
      type: 'column',
      group: 'order',
      dateKey: TUESDAY,
      cardCount: 1,
    })
  })

  it('a tap on an empty day reports a card count of zero', () => {
    const value = armModeValue()
    renderColumn(value, [])

    fireEvent.click(screen.getByText('Nothing scheduled.'))

    expect(value.tap).toHaveBeenCalledWith({
      type: 'column',
      group: 'order',
      dateKey: TUESDAY,
      cardCount: 0,
    })
  })

  it('a tap on a card while armed routes to placement, not the popup', () => {
    const value = armModeValue()
    const rows = [makeRow({ id: 'order-2', po_number: 'PO-1001', production_date: TUESDAY })]
    renderColumn(value, rows)

    fireEvent.click(screen.getByTestId('production-card'))

    expect(value.tap).toHaveBeenCalledWith({
      type: 'card',
      group: 'order',
      cardId: 'order-2',
      dateKey: TUESDAY,
      index: 0,
    })
  })

  it('a tap on a card while nothing is armed does not fire placement routing', () => {
    const value = armModeValue({ armed: null })
    const rows = [makeRow({ id: 'order-2', po_number: 'PO-1001', production_date: TUESDAY })]
    renderColumn(value, rows)

    fireEvent.click(screen.getByTestId('production-card'))

    expect(value.tap).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'card' }))
  })

  it('a tap on an armed card fires placement exactly once, at that card’s index', () => {
    // The regression this file exists to catch (Task 91). The card sits inside
    // the real `ColumnOrderList`, whose `<ul>` is itself a tap surface, so a
    // click that keeps bubbling calls `tap` a SECOND time with a column target.
    // `armMode.tap` closes over the `armed` state, which has not re-rendered
    // between the two synchronous calls, so that second call issued a second,
    // wrong placement — a bottom-of-day append racing the correct one. Counting
    // the calls is the whole point: asserting only `toHaveBeenCalledWith` passed
    // happily while the bug was live.
    const value = armModeValue()
    const rows = [
      makeRow({ id: 'order-a', po_number: 'PO-1001', production_date: TUESDAY }),
      makeRow({ id: 'order-b', po_number: 'PO-1002', production_date: TUESDAY }),
      makeRow({ id: 'order-c', po_number: 'PO-1003', production_date: TUESDAY }),
    ]
    renderColumn(value, rows)

    fireEvent.click(screen.getAllByTestId('production-card')[2])

    expect(value.tap).toHaveBeenCalledTimes(1)
    expect(value.tap).toHaveBeenCalledWith({
      type: 'card',
      group: 'order',
      cardId: 'order-c',
      dateKey: TUESDAY,
      index: 2,
    })
  })

  it('an unarmed card click still bubbles to the column, so the popup path is untouched', () => {
    // The `stopPropagation` is armed-only. With nothing armed the click must
    // still reach the list — `tap` no-ops there — because suppressing it
    // unconditionally would be a behaviour change nobody asked for.
    const value = armModeValue({ armed: null })
    const rows = [makeRow({ id: 'order-a', po_number: 'PO-1001', production_date: TUESDAY })]
    renderColumn(value, rows)

    fireEvent.click(screen.getByTestId('production-card'))

    expect(value.tap).toHaveBeenCalledWith({
      type: 'column',
      group: 'order',
      dateKey: TUESDAY,
      cardCount: 1,
    })
  })

  it('the armed card renders its armed treatment', () => {
    const rows = [makeRow({ production_date: TUESDAY })]
    const value = armModeValue({
      armed: { group: 'order', row: rows[0], dateKey: TUESDAY, index: 0 },
    })
    renderColumn(value, rows)

    expect(screen.getByTestId('production-card')).toHaveAttribute('data-armed', 'true')
  })
})

describe('armed tap surfaces — the pickups list (CONSTRAINT-25)', () => {
  it('a tap on the pickups list space reports that group and its own count', () => {
    // The count is this group's list only: a column holding one order and one
    // pickup must never report two.
    const value = armModeValue()
    renderColumn(value, [makeRow({ production_date: TUESDAY })], [makePickup()])

    fireEvent.click(screen.getByTestId('column-pickups'))

    expect(value.tap).toHaveBeenCalledWith({
      type: 'column',
      group: 'pickup',
      dateKey: TUESDAY,
      cardCount: 1,
    })
  })

  it('a tap on an empty pickups list reports a card count of zero', () => {
    const value = armModeValue()
    renderColumn(value, [], [])

    fireEvent.click(screen.getByTestId('column-pickups-empty'))

    expect(value.tap).toHaveBeenCalledWith({
      type: 'column',
      group: 'pickup',
      dateKey: TUESDAY,
      cardCount: 0,
    })
  })

  it('a tap on a pickup card reports the pickup group and that card’s id', () => {
    const value = armModeValue()
    renderColumn(value, [], [makePickup({ id: 'pickup-2' })])

    fireEvent.click(screen.getByTestId('pickup-card'))

    expect(value.tap).toHaveBeenCalledWith({
      type: 'card',
      group: 'pickup',
      cardId: 'pickup-2',
      dateKey: TUESDAY,
      index: 0,
    })
  })

  it('a tap on an armed pickup card fires placement exactly once, at that card’s index', () => {
    // The pickups mirror of the bubble guard above. `ColumnPickupList`'s `<ul>`
    // is a tap surface too, so `SortablePickupCard` must stop propagation while
    // armed or the second call appends the pickup to the bottom of the day.
    const value = armModeValue()
    renderColumn(
      value,
      [],
      [makePickup({ id: 'pickup-a' }), makePickup({ id: 'pickup-b' }), makePickup({ id: 'pickup-c' })],
    )

    fireEvent.click(screen.getAllByTestId('pickup-card')[2])

    expect(value.tap).toHaveBeenCalledTimes(1)
    expect(value.tap).toHaveBeenCalledWith({
      type: 'card',
      group: 'pickup',
      cardId: 'pickup-c',
      dateKey: TUESDAY,
      index: 2,
    })
  })

  it('an unarmed pickup card click still bubbles to the pickups list', () => {
    const value = armModeValue({ armed: null })
    renderColumn(value, [], [makePickup({ id: 'pickup-a' })])

    fireEvent.click(screen.getByTestId('pickup-card'))

    expect(value.tap).toHaveBeenCalledWith({
      type: 'column',
      group: 'pickup',
      dateKey: TUESDAY,
      cardCount: 1,
    })
  })

  it('an armed pickup never makes an order card render its armed ring', () => {
    // The id comparison includes the group, so two rows that happened to share
    // an id across the two tables could not light each other up.
    const rows = [makeRow({ id: 'shared-id', production_date: TUESDAY })]
    const value = armModeValue({
      armed: { group: 'pickup', row: makePickup({ id: 'shared-id' }), dateKey: TUESDAY, index: 0 },
    })
    renderColumn(value, rows, [])

    expect(screen.getByTestId('production-card')).not.toHaveAttribute('data-armed')
  })

  it('an armed order never makes a pickup card render its armed ring', () => {
    const value = armModeValue({
      armed: { group: 'order', row: makeRow({ id: 'shared-id' }), dateKey: TUESDAY, index: 0 },
    })
    renderColumn(value, [], [makePickup({ id: 'shared-id' })])

    expect(screen.getByTestId('pickup-card')).not.toHaveAttribute('data-armed')
  })
})
