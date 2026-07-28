import { render, screen } from '@testing-library/react'
import { renderHook, act, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DndContext } from '@dnd-kit/core'
import DayColumn from '../DayColumn'
import { ArmModeProvider, useArmModeState, type ArmModeValue } from '../armMode'
import { FLY_RESET_MS, type ArmedCard } from '../armPlacement'
import type { CalendarOrderRow } from '@/db/queries/calendar'

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
    ...overrides,
  }
}

function armedAt(dateKey: string, index: number): ArmedCard {
  return { row: makeRow(), dateKey, index }
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

    act(() => result.current.tap({ type: 'column', dateKey: TUESDAY, cardCount: 2 }))

    expect(place).toHaveBeenCalledWith({ orderId: 'order-1', dateKey: TUESDAY, index: 2 })
    expect(result.current.armed).toBeNull()
  })

  it('routes an armed tap on the callout to the unschedule mutation', () => {
    const { result } = renderHook(() => useArmModeState(place, unschedule, false))

    act(() => result.current.arm(armedAt(MONDAY, 0)))
    act(() => result.current.tap({ type: 'callout' }))

    expect(unschedule).toHaveBeenCalledWith('order-1')
    expect(place).not.toHaveBeenCalled()
  })

  it('ignores taps while nothing is armed — the unarmed calendar is untouched', () => {
    const { result } = renderHook(() => useArmModeState(place, unschedule, false))

    act(() => result.current.tap({ type: 'column', dateKey: TUESDAY, cardCount: 2 }))

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
      act(() => result.current.tap({ type: 'column', dateKey: TUESDAY, cardCount: 0 }))
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
    act(() => result.current.tap({ type: 'column', dateKey: TUESDAY, cardCount: 0 }))

    expect(place).toHaveBeenCalled()
    expect(result.current.flyingId).toBeNull()
  })
})

/** DayColumn with a hand-built arm-mode value, for tap-surface wiring tests. */
function renderColumn(value: ArmModeValue, rows: CalendarOrderRow[]) {
  return render(
    <DndContext>
      <ArmModeProvider value={value}>
        <DayColumn
          date={new Date(2026, 6, 28)}
          rows={rows}
          isToday={false}
          unscheduled={[]}
          onPick={vi.fn()}
        />
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

    expect(value.tap).toHaveBeenCalledWith({ type: 'column', dateKey: TUESDAY, cardCount: 1 })
  })

  it('a tap on an empty day reports a card count of zero', () => {
    const value = armModeValue()
    renderColumn(value, [])

    fireEvent.click(screen.getByText('Nothing scheduled.'))

    expect(value.tap).toHaveBeenCalledWith({ type: 'column', dateKey: TUESDAY, cardCount: 0 })
  })

  it('a tap on a card while armed routes to placement, not the popup', () => {
    const value = armModeValue()
    const rows = [makeRow({ id: 'order-2', po_number: 'PO-1001', production_date: TUESDAY })]
    renderColumn(value, rows)

    fireEvent.click(screen.getByTestId('production-card'))

    expect(value.tap).toHaveBeenCalledWith({
      type: 'card',
      orderId: 'order-2',
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

  it('the armed card renders its armed treatment', () => {
    const rows = [makeRow({ production_date: TUESDAY })]
    const value = armModeValue({ armed: { row: rows[0], dateKey: TUESDAY, index: 0 } })
    renderColumn(value, rows)

    expect(screen.getByTestId('production-card')).toHaveAttribute('data-armed', 'true')
  })
})
