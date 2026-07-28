import { render, screen, fireEvent, within } from '@testing-library/react'
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DndContext, type DragEndEvent } from '@dnd-kit/core'

const mockSetProductionPlacement = vi.hoisted(() => vi.fn())
const mockClearProductionPlacement = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())

const mockToggleSameDayDelivery = vi.hoisted(() => vi.fn())
const mockToggleBackhaul = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/calendar', () => ({
  setProductionPlacement: mockSetProductionPlacement,
  clearProductionPlacement: mockClearProductionPlacement,
  toggleSameDayDelivery: mockToggleSameDayDelivery,
  toggleBackhaul: mockToggleBackhaul,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

import UnscheduledCallout from '../UnscheduledCallout'
import AddOrderMenu from '../AddOrderMenu'
import { ArmModeProvider, type ArmModeValue } from '../armMode'
import { type ArmedCard } from '../armPlacement'
import { useProductionPlacement } from '../useProductionPlacement'
import {
  resolveUnscheduleTarget,
  UNSCHEDULED_DROPPABLE_ID,
  UNSCHEDULED_ORIGIN,
  type CardDragData,
} from '../calendarDnd'
import { UNSCHEDULED_DROPDOWN_VISIBLE } from '@/db/queries/calendar.constants'
import type { CalendarOrderRow } from '@/db/queries/calendar'

const MONDAY = '2026-07-27'

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
    requested_delivery_date: null,
    production_sort_index: null,
    ...overrides,
  }
}

function makeRows(count: number): CalendarOrderRow[] {
  return Array.from({ length: count }, (_, index) =>
    makeRow({ id: `order-${index}`, po_number: `PO-${1000 + index}` }),
  )
}

function renderCallout(rows: CalendarOrderRow[]) {
  return render(
    <DndContext>
      <UnscheduledCallout rows={rows} />
    </DndContext>,
  )
}

const CARD_AT = (dateKey: string, index: number): CardDragData => ({
  type: 'card',
  dateKey,
  index,
})

/** Minimal `DragEndEvent` — only the fields the resolver reads. */
function dropOnCallout(activeData: CardDragData): DragEndEvent {
  return {
    active: { id: 'order-1', data: { current: activeData } },
    over: { id: UNSCHEDULED_DROPPABLE_ID, data: { current: { type: 'callout' } } },
  } as unknown as DragEndEvent
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSetProductionPlacement.mockResolvedValue({ success: true })
  mockClearProductionPlacement.mockResolvedValue({ success: true })
  mockToggleSameDayDelivery.mockResolvedValue({ success: true })
  mockToggleBackhaul.mockResolvedValue({ success: true })
})

describe('resolveUnscheduleTarget', () => {
  it('resolves a placed card dropped on the callout to that order', () => {
    expect(resolveUnscheduleTarget(dropOnCallout(CARD_AT(MONDAY, 0)))).toBe('order-1')
  })

  it('returns null for a card that was already unscheduled', () => {
    // Nothing to clear — firing would set two nulls to null.
    expect(resolveUnscheduleTarget(dropOnCallout(CARD_AT(UNSCHEDULED_ORIGIN, 0)))).toBeNull()
  })

  it('returns null when the drop was not on the callout', () => {
    const event = {
      active: { id: 'order-1', data: { current: CARD_AT(MONDAY, 0) } },
      over: { id: MONDAY, data: { current: { type: 'column', dateKey: MONDAY, cardCount: 0 } } },
    } as unknown as DragEndEvent

    expect(resolveUnscheduleTarget(event)).toBeNull()
  })

  it('returns null when there is no drop target at all', () => {
    const event = {
      active: { id: 'order-1', data: { current: CARD_AT(MONDAY, 0) } },
      over: null,
    } as unknown as DragEndEvent

    expect(resolveUnscheduleTarget(event)).toBeNull()
  })
})

describe('UnscheduledCallout', () => {
  it('shows the unscheduled count', () => {
    renderCallout(makeRows(3))

    const pill = screen.getByRole('button', { name: /need a production date/i })
    expect(pill).toHaveTextContent('3')
    expect(pill).toHaveTextContent('need a production date')
  })

  it('renders empty state when nothing is unscheduled — not a bare 0 pill', () => {
    renderCallout([])

    expect(screen.getByTestId('unscheduled-empty')).toHaveTextContent(
      'Everything has a production date.',
    )
    expect(screen.queryByRole('button', { name: /need a production date/i })).not.toBeInTheDocument()
  })

  it('starts collapsed and reflects state in aria-expanded', () => {
    renderCallout(makeRows(2))

    const pill = screen.getByRole('button', { name: /need a production date/i })
    expect(pill).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('unscheduled-dropdown')).not.toBeInTheDocument()

    fireEvent.click(pill)
    expect(pill).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('unscheduled-dropdown')).toBeInTheDocument()
  })

  it('closes again on a second click and on Escape', () => {
    renderCallout(makeRows(2))
    const pill = screen.getByRole('button', { name: /need a production date/i })

    fireEvent.click(pill)
    fireEvent.click(pill)
    expect(screen.queryByTestId('unscheduled-dropdown')).not.toBeInTheDocument()

    fireEvent.click(pill)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('unscheduled-dropdown')).not.toBeInTheDocument()
  })

  it('renders every unscheduled order as a draggable card', () => {
    renderCallout(makeRows(6))
    fireEvent.click(screen.getByRole('button', { name: /need a production date/i }))

    const dropdown = screen.getByTestId('unscheduled-dropdown')
    expect(within(dropdown).getAllByTestId('production-card')).toHaveLength(6)
  })

  it(`sizes the dropdown to ${UNSCHEDULED_DROPDOWN_VISIBLE} cards, then scrolls`, () => {
    renderCallout(makeRows(6))
    fireEvent.click(screen.getByRole('button', { name: /need a production date/i }))

    const dropdown = screen.getByTestId('unscheduled-dropdown')
    // All 6 render; the height cap plus overflow-y is what limits the view to 4.
    expect(dropdown.style.maxHeight).toContain(`var(--card-h) * ${UNSCHEDULED_DROPDOWN_VISIBLE}`)
    expect(dropdown.className).toContain('overflow-y-auto')
  })

  it('is keyboard reachable with a 44px trigger', () => {
    renderCallout(makeRows(1))

    const pill = screen.getByRole('button', { name: /need a production date/i })
    expect(pill.tagName).toBe('BUTTON')
    expect(pill.className).toContain('min-h-[44px]')
  })
})

describe('unschedule mutation', () => {
  it('drop on the callout clears the production date', async () => {
    const { result } = renderHook(() => useProductionPlacement())

    await act(async () => {
      await result.current.unschedule('order-1')
    })

    expect(mockClearProductionPlacement).toHaveBeenCalledWith('order-1')
    expect(mockRefresh).toHaveBeenCalled()
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('a failed clear toasts rather than reverting silently', async () => {
    mockClearProductionPlacement.mockResolvedValue({ error: 'Order not found.' })
    const { result } = renderHook(() => useProductionPlacement())

    await act(async () => {
      await result.current.unschedule('order-1')
    })

    expect(mockToast).toHaveBeenCalledWith('Order not found.', 'error')
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})

describe('AddOrderMenu', () => {
  it('lists exactly the same set as the callout', () => {
    const rows = makeRows(3)
    render(
      <AddOrderMenu
        date={new Date(2026, 6, 27)}
        rows={rows}
        onPick={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    // The menu leads with the Task 64 "create a new PO here" action; the
    // unscheduled set is everything after it.
    const [action, ...items] = screen.getAllByRole('menuitem')
    expect(action).toHaveTextContent('Add Purchase Order')
    expect(items).toHaveLength(3)
    expect(items.map((item) => item.textContent)).toEqual(
      expect.arrayContaining(rows.map((row) => expect.stringContaining(row.po_number))),
    )
  })

  it('hands the chosen order id to onPick', () => {
    const onPick = vi.fn()
    render(
      <AddOrderMenu
        date={new Date(2026, 6, 27)}
        rows={makeRows(2)}
        onPick={onPick}
        onClose={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('menuitem', { name: /PO-1001/ }))
    expect(onPick).toHaveBeenCalledWith('order-1')
  })

  it('says so when there is nothing to add', () => {
    render(
      <AddOrderMenu date={new Date(2026, 6, 27)} rows={[]} onPick={vi.fn()} onClose={vi.fn()} />,
    )

    expect(screen.getByText(/every order has a date/i)).toBeInTheDocument()
    // Only the new-PO action survives an empty unscheduled set — creating an
    // order on this day stays possible when there is nothing left to date.
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent('Add Purchase Order')
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(
      <AddOrderMenu
        date={new Date(2026, 6, 27)}
        rows={makeRows(1)}
        onPick={vi.fn()}
        onClose={onClose}
      />,
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('setSameDay persists the flag and refreshes', async () => {
    const { result } = renderHook(() => useProductionPlacement())

    await act(async () => {
      await result.current.setSameDay('order-1', true)
    })

    expect(mockToggleSameDayDelivery).toHaveBeenCalledWith('order-1', true)
    expect(mockRefresh).toHaveBeenCalled()
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('a rejected setSameDay toasts rather than refreshing', async () => {
    mockToggleSameDayDelivery.mockResolvedValue({ error: 'Cancelled orders cannot be marked.' })
    const { result } = renderHook(() => useProductionPlacement())

    await act(async () => {
      await result.current.setSameDay('order-1', true)
    })

    expect(mockToast).toHaveBeenCalledWith('Cancelled orders cannot be marked.', 'error')
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('setBackhaul persists the flag and refreshes', async () => {
    const { result } = renderHook(() => useProductionPlacement())

    await act(async () => {
      await result.current.setBackhaul('order-1', true)
    })

    expect(mockToggleBackhaul).toHaveBeenCalledWith('order-1', true)
    expect(mockRefresh).toHaveBeenCalled()
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('a rejected setBackhaul toasts rather than refreshing', async () => {
    mockToggleBackhaul.mockResolvedValue({ error: 'Cancelled orders cannot be marked.' })
    const { result } = renderHook(() => useProductionPlacement())

    await act(async () => {
      await result.current.setBackhaul('order-1', true)
    })

    expect(mockToast).toHaveBeenCalledWith('Cancelled orders cannot be marked.', 'error')
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('a THROWN action is reported, not swallowed', async () => {
    // Regression: callers fire these and discard the promise, so an uncaught
    // rejection used to vanish entirely — no toast, no log, the card simply
    // did not move.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockClearProductionPlacement.mockRejectedValue(new Error('action transport failed'))
    const { result } = renderHook(() => useProductionPlacement())

    await act(async () => {
      await result.current.unschedule('order-1')
    })

    expect(mockToast).toHaveBeenCalledWith('Something went wrong. Please try again.', 'error')
    expect(consoleError).toHaveBeenCalled()
    expect(mockRefresh).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe('UnscheduledCallout while a card is armed (Task 68)', () => {
  function armModeValue(armed: ArmedCard | null): ArmModeValue {
    return { armed, flyingId: null, arm: vi.fn(), cancel: vi.fn(), tap: vi.fn() }
  }

  function renderArmedCallout(value: ArmModeValue, rows: CalendarOrderRow[]) {
    return render(
      <DndContext>
        <ArmModeProvider value={value}>
          <UnscheduledCallout rows={rows} />
        </ArmModeProvider>
      </DndContext>,
    )
  }

  it('a tap on the pill routes to the callout target instead of toggling the dropdown', () => {
    const value = armModeValue({ row: makeRow(), dateKey: MONDAY, index: 0 })
    renderArmedCallout(value, [makeRow({ id: 'order-9', po_number: 'PO-1009' })])

    fireEvent.click(screen.getByRole('button', { name: /need a production date/ }))

    expect(value.tap).toHaveBeenCalledWith({ type: 'callout' })
    expect(screen.queryByTestId('unscheduled-dropdown')).not.toBeInTheDocument()
  })

  it('a tap on the pill with nothing armed still toggles the dropdown', () => {
    const value = armModeValue(null)
    renderArmedCallout(value, [makeRow({ id: 'order-9', po_number: 'PO-1009' })])

    fireEvent.click(screen.getByRole('button', { name: /need a production date/ }))

    expect(value.tap).not.toHaveBeenCalled()
    expect(screen.getByTestId('unscheduled-dropdown')).toBeInTheDocument()
  })
})
