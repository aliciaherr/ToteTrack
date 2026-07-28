import { render, screen, waitFor, within } from '@testing-library/react'
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DndContext, type DragEndEvent } from '@dnd-kit/core'

const mockSetProductionPlacement = vi.hoisted(() => vi.fn())
const mockClearProductionPlacement = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/calendar', () => ({
  setProductionPlacement: mockSetProductionPlacement,
  clearProductionPlacement: mockClearProductionPlacement,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

import DayColumn from '../DayColumn'
import { useProductionPlacement } from '../useProductionPlacement'
import {
  resolveDropTarget,
  toTranslate,
  POINTER_ACTIVATION_DISTANCE_PX,
  type CardDragData,
  type ColumnDropData,
} from '../calendarDnd'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { PoStatus } from '@/db/queries/orders'

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
    production_date: null,
    requested_delivery_date: '2026-07-31',
    production_sort_index: null,
    ...overrides,
  }
}

/** Minimal `DragEndEvent` — only the fields `resolveDropTarget` reads. */
function dragEvent(
  activeId: string,
  activeData: CardDragData,
  overData: CardDragData | ColumnDropData | null,
): DragEndEvent {
  return {
    active: { id: activeId, data: { current: activeData } },
    over: overData === null ? null : { id: 'over', data: { current: overData } },
  } as unknown as DragEndEvent
}

const CARD_AT = (dateKey: string, index: number): CardDragData => ({
  type: 'card',
  dateKey,
  index,
})

const COLUMN = (dateKey: string, cardCount: number): ColumnDropData => ({
  type: 'column',
  dateKey,
  cardCount,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockSetProductionPlacement.mockResolvedValue({ success: true })
  mockClearProductionPlacement.mockResolvedValue({ success: true })
})

describe('resolveDropTarget', () => {
  it('resolves a drop on another day to that date and the released index', () => {
    const target = resolveDropTarget(
      dragEvent('order-1', CARD_AT(MONDAY, 0), CARD_AT(TUESDAY, 2)),
    )

    expect(target).toEqual({ orderId: 'order-1', dateKey: TUESDAY, index: 2 })
  })

  it('lands at the exact index released, never appended to the end', () => {
    const target = resolveDropTarget(
      dragEvent('order-1', CARD_AT(MONDAY, 3), CARD_AT(TUESDAY, 0)),
    )

    expect(target?.index).toBe(0)
  })

  it('resolves a reorder within the same day', () => {
    const target = resolveDropTarget(
      dragEvent('order-1', CARD_AT(MONDAY, 0), CARD_AT(MONDAY, 2)),
    )

    expect(target).toEqual({ orderId: 'order-1', dateKey: MONDAY, index: 2 })
  })

  it('appends when dropped on a column’s empty space — the one case with no neighbour', () => {
    const target = resolveDropTarget(dragEvent('order-1', CARD_AT(MONDAY, 0), COLUMN(TUESDAY, 3)))

    expect(target).toEqual({ orderId: 'order-1', dateKey: TUESDAY, index: 3 })
  })

  it('returns null for a drop at the origin', () => {
    expect(resolveDropTarget(dragEvent('order-1', CARD_AT(MONDAY, 1), CARD_AT(MONDAY, 1)))).toBeNull()
  })

  it('returns null for a drop outside any target', () => {
    expect(resolveDropTarget(dragEvent('order-1', CARD_AT(MONDAY, 0), null))).toBeNull()
  })

  it('returns null when the drop target carries no calendar data', () => {
    const event = {
      active: { id: 'order-1', data: { current: CARD_AT(MONDAY, 0) } },
      over: { id: 'stray', data: { current: { type: 'something-else' } } },
    } as unknown as DragEndEvent

    expect(resolveDropTarget(event)).toBeNull()
  })

  it('returns null when the dragged item is not a card', () => {
    const event = {
      active: { id: 'x', data: { current: COLUMN(MONDAY, 0) } },
      over: { id: 'over', data: { current: CARD_AT(TUESDAY, 0) } },
    } as unknown as DragEndEvent

    expect(resolveDropTarget(event)).toBeNull()
  })
})

describe('sensor configuration', () => {
  it('keeps the pointer threshold small enough that a tap is not a drag', () => {
    expect(POINTER_ACTIVATION_DISTANCE_PX).toBe(6)
  })

  // Touch drag has no sensor constants any more: A-05's contingency fired and
  // touch is long-press-to-arm + tap-to-place — see armPlacement.test.ts.
})

describe('toTranslate', () => {
  it('builds a translate3d string from a transform', () => {
    expect(toTranslate({ x: 4, y: -8 })).toBe('translate3d(4px, -8px, 0)')
  })

  it('returns undefined when there is no transform', () => {
    expect(toTranslate(null)).toBeUndefined()
  })
})

describe('useProductionPlacement', () => {
  it('drop on another day calls setProductionPlacement with that date and index', async () => {
    const { result } = renderHook(() => useProductionPlacement())

    await act(async () => {
      await result.current.place({ orderId: 'order-1', dateKey: TUESDAY, index: 2 })
    })

    expect(mockSetProductionPlacement).toHaveBeenCalledWith('order-1', {
      productionDate: TUESDAY,
      sortIndex: 2,
    })
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('failed placement shows a toast and does not refresh', async () => {
    mockSetProductionPlacement.mockResolvedValue({ error: 'Cancelled orders cannot be placed.' })
    const { result } = renderHook(() => useProductionPlacement())

    await act(async () => {
      await result.current.place({ orderId: 'order-1', dateKey: TUESDAY, index: 0 })
    })

    expect(mockToast).toHaveBeenCalledWith('Cancelled orders cannot be placed.', 'error')
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})

describe('DayColumn drag wiring', () => {
  function renderColumn(rows: CalendarOrderRow[]) {
    return render(
      <DndContext>
        <DayColumn
          date={new Date(2026, 6, 27)}
          rows={rows}
          isToday={false}
          unscheduled={[]}
          onPick={vi.fn()}
        />
      </DndContext>,
    )
  }

  it('scheduled cards expose drag listeners', () => {
    renderColumn([makeRow({ status: 'scheduled' })])

    const card = screen.getByTestId('production-card')
    expect(card.parentElement).toHaveAttribute('aria-roledescription')
    expect(card).toHaveAttribute('data-draggable', 'true')
  })

  it.each(['completed', 'invoiced'] as const)(
    'built (%s) cards expose no drag listeners',
    (status: PoStatus) => {
      renderColumn([makeRow({ status })])

      const card = screen.getByTestId('production-card')
      expect(card.parentElement).not.toHaveAttribute('aria-roledescription')
      expect(card).not.toHaveAttribute('data-draggable')
    },
  )

  it('an empty day is still a drop target', () => {
    renderColumn([])

    const column = screen.getByTestId('day-column')
    expect(within(column).getByText('Nothing scheduled.')).toBeInTheDocument()
  })

  it('renders no weekend column to drop onto — the column is the only target', () => {
    // The strip emits Mon–Fri only (CONSTRAINT-19), so a weekend drop target
    // cannot exist; a column's droppable id is always its own weekday key.
    renderColumn([makeRow()])

    expect(screen.getByTestId('day-column')).toHaveAttribute('data-date', MONDAY)
  })
})
