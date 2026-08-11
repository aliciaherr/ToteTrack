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
import UnscheduledPickupsCallout from '../UnscheduledPickupsCallout'
import AddOrderMenu from '../AddOrderMenu'
import { ArmModeProvider, type ArmModeValue } from '../armMode'
import { type ArmedCard } from '../armPlacement'
import { useProductionPlacement } from '../useProductionPlacement'
import {
  resolveUnscheduleTarget,
  UNSCHEDULED_DROPPABLE_ID,
  UNSCHEDULED_ORIGIN,
  UNSCHEDULED_PICKUPS_DROPPABLE_ID,
  type CardDragData,
  type CardGroup,
} from '../calendarDnd'
import { UNSCHEDULED_DROPDOWN_VISIBLE } from '@/db/queries/calendar.constants'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

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
    contacts: [],
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

function makePickup(overrides: Partial<CalendarPickupRow> = {}): CalendarPickupRow {
  return {
    id: 'pickup-1',
    customer_id: '33333333-3333-3333-3333-333333333333',
    customer_name: 'Northside Bottling',
    status: 'scheduled',
    qty_275: 12,
    qty_330: 4,
    pickup_date: null,
    sort_index: null,
    address: null,
    notes: null,
    contacts: [],
    ...overrides,
  }
}

function makePickups(count: number): CalendarPickupRow[] {
  return Array.from({ length: count }, (_, index) =>
    makePickup({ id: `pickup-${index}`, customer_name: `Customer ${index}` }),
  )
}

const CARD_AT = (dateKey: string, index: number, group: CardGroup = 'order'): CardDragData => ({
  type: 'card',
  group,
  dateKey,
  index,
})

/** Minimal `DragEndEvent` — only the fields the resolver reads. */
function dropOnCallout(
  activeData: CardDragData,
  calloutGroup: CardGroup = 'order',
  activeId = 'order-1',
): DragEndEvent {
  const droppableId =
    calloutGroup === 'pickup' ? UNSCHEDULED_PICKUPS_DROPPABLE_ID : UNSCHEDULED_DROPPABLE_ID
  return {
    active: { id: activeId, data: { current: activeData } },
    over: { id: droppableId, data: { current: { type: 'callout', group: calloutGroup } } },
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
    expect(resolveUnscheduleTarget(dropOnCallout(CARD_AT(MONDAY, 0)))).toEqual({
      group: 'order',
      cardId: 'order-1',
    })
  })

  it('returns null for a card that was already unscheduled', () => {
    // Nothing to clear — firing would set two nulls to null.
    expect(resolveUnscheduleTarget(dropOnCallout(CARD_AT(UNSCHEDULED_ORIGIN, 0)))).toBeNull()
  })

  it('returns null when the drop was not on the callout', () => {
    const event = {
      active: { id: 'order-1', data: { current: CARD_AT(MONDAY, 0) } },
      over: {
        id: MONDAY,
        data: { current: { type: 'column', group: 'order', dateKey: MONDAY, cardCount: 0 } },
      },
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

  it('resolves a placed pickup dropped on the pickups callout to that pickup', () => {
    const event = dropOnCallout(CARD_AT(MONDAY, 0, 'pickup'), 'pickup', 'pickup-1')

    expect(resolveUnscheduleTarget(event)).toEqual({ group: 'pickup', cardId: 'pickup-1' })
  })

  it('refuses to unschedule an order across onto the pickups callout', () => {
    // The two pills sit side by side in one header; without the group check a
    // mis-aimed drop would clear a date on the wrong table (CONSTRAINT-25).
    const event = dropOnCallout(CARD_AT(MONDAY, 0, 'order'), 'pickup')

    expect(resolveUnscheduleTarget(event)).toBeNull()
  })

  it('refuses to unschedule a pickup across onto the orders callout', () => {
    const event = dropOnCallout(CARD_AT(MONDAY, 0, 'pickup'), 'order', 'pickup-1')

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
  function renderMenu(props: Partial<React.ComponentProps<typeof AddOrderMenu>> = {}) {
    return render(
      <AddOrderMenu
        date={new Date(2026, 6, 27)}
        rows={[]}
        pickups={[]}
        onPick={vi.fn()}
        onPickPickup={vi.fn()}
        onClose={vi.fn()}
        {...props}
      />,
    )
  }

  it('leads with both create actions, then the undated sets', () => {
    const rows = makeRows(3)
    renderMenu({ rows })

    const [createOrder, createPickup, ...items] = screen.getAllByRole('menuitem')
    expect(createOrder).toHaveTextContent('Add Purchase Order')
    expect(createPickup).toHaveTextContent('Add Pickup')
    expect(items).toHaveLength(3)
    expect(items.map((item) => item.textContent)).toEqual(
      expect.arrayContaining(rows.map((row) => expect.stringContaining(row.po_number))),
    )
  })

  it('lists undated rows of both kinds, each under its own label', () => {
    renderMenu({ rows: makeRows(2), pickups: makePickups(2) })

    const orderGroup = screen.getByRole('group', { name: 'Undated orders' })
    const pickupGroup = screen.getByRole('group', { name: 'Undated pickups' })

    expect(within(orderGroup).getAllByRole('menuitem')).toHaveLength(2)
    expect(within(pickupGroup).getAllByRole('menuitem')).toHaveLength(2)
    // A pickup has no PO number, so its row leads with the customer instead.
    expect(within(pickupGroup).getByRole('menuitem', { name: /Customer 0/ })).toBeInTheDocument()
  })

  it('hands the chosen order id to onPick', () => {
    const onPick = vi.fn()
    renderMenu({ rows: makeRows(2), onPick })

    fireEvent.click(screen.getByRole('menuitem', { name: /PO-1001/ }))
    expect(onPick).toHaveBeenCalledWith('order-1')
  })

  it('hands the chosen pickup id to its own handler, never to onPick', () => {
    const onPick = vi.fn()
    const onPickPickup = vi.fn()
    renderMenu({ rows: makeRows(1), pickups: makePickups(2), onPick, onPickPickup })

    fireEvent.click(screen.getByRole('menuitem', { name: /Customer 1/ }))

    expect(onPickPickup).toHaveBeenCalledWith('pickup-1')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('draws only the group that has rows', () => {
    renderMenu({ pickups: makePickups(1) })

    expect(screen.queryByRole('group', { name: 'Undated orders' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Undated pickups' })).toBeInTheDocument()
  })

  it('says so when there is nothing to add', () => {
    renderMenu()

    expect(screen.getByText(/everything has a date/i)).toBeInTheDocument()
    // Both create actions survive an empty undated set — creating a row on this
    // day stays possible when there is nothing left to date.
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Add Purchase Order')
    expect(items[1]).toHaveTextContent('Add Pickup')
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    renderMenu({ rows: makeRows(1), onClose })

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

function armModeValue(armed: ArmedCard | null): ArmModeValue {
  return { armed, flyingId: null, arm: vi.fn(), cancel: vi.fn(), tap: vi.fn() }
}

const ARMED_ORDER: ArmedCard = { group: 'order', row: makeRow(), dateKey: MONDAY, index: 0 }

describe('UnscheduledCallout while a card is armed (Task 68)', () => {
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
    const value = armModeValue(ARMED_ORDER)
    renderArmedCallout(value, [makeRow({ id: 'order-9', po_number: 'PO-1009' })])

    fireEvent.click(screen.getByRole('button', { name: /need a production date/ }))

    expect(value.tap).toHaveBeenCalledWith({ type: 'callout', group: 'order' })
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

describe('UnscheduledPickupsCallout', () => {
  function renderPickupsCallout(
    pickups: CalendarPickupRow[],
    value: ArmModeValue = armModeValue(null),
  ) {
    return render(
      <DndContext>
        <ArmModeProvider value={value}>
          <UnscheduledPickupsCallout pickups={pickups} onSelect={vi.fn()} />
        </ArmModeProvider>
      </DndContext>,
    )
  }

  it('renders nothing when every pickup already has a date', () => {
    // No all-clear message, unlike the orders callout — the header has no
    // horizontal room to spare at iPad landscape width (CONSTRAINT-19).
    renderPickupsCallout([])

    expect(screen.queryByRole('button', { name: /pickups need a date/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('unscheduled-pickups-dropdown')).not.toBeInTheDocument()
  })

  it('shows the undated count behind a 44px trigger', () => {
    renderPickupsCallout(makePickups(3))

    const pill = screen.getByRole('button', { name: /pickups need a date/i })
    expect(pill).toHaveTextContent('3')
    expect(pill.className).toContain('min-h-[44px]')
  })

  it('opens a dropdown of draggable pickup cards', () => {
    renderPickupsCallout(makePickups(2))

    fireEvent.click(screen.getByRole('button', { name: /pickups need a date/i }))

    const dropdown = screen.getByTestId('unscheduled-pickups-dropdown')
    const cards = within(dropdown).getAllByTestId('pickup-card')
    expect(cards).toHaveLength(2)
    // Draggable straight out onto a day column — the gesture Task 81 adds.
    expect(cards[0]).toHaveAttribute('data-draggable', 'true')
    expect(cards[0].parentElement).toHaveAttribute('aria-roledescription')
  })

  it(`sizes the dropdown to ${UNSCHEDULED_DROPDOWN_VISIBLE} cards, then scrolls`, () => {
    renderPickupsCallout(makePickups(6))
    fireEvent.click(screen.getByRole('button', { name: /pickups need a date/i }))

    const dropdown = screen.getByTestId('unscheduled-pickups-dropdown')
    expect(dropdown.style.maxHeight).toContain(`var(--card-h) * ${UNSCHEDULED_DROPDOWN_VISIBLE}`)
    expect(dropdown.className).toContain('overflow-y-auto')
  })

  it('a tap while a pickup is armed routes to the pickups callout target', () => {
    const value = armModeValue({
      group: 'pickup',
      row: makePickup({ pickup_date: MONDAY }),
      dateKey: MONDAY,
      index: 0,
    })
    renderPickupsCallout(makePickups(1), value)

    fireEvent.click(screen.getByRole('button', { name: /pickups need a date/i }))

    expect(value.tap).toHaveBeenCalledWith({ type: 'callout', group: 'pickup' })
    expect(screen.queryByTestId('unscheduled-pickups-dropdown')).not.toBeInTheDocument()
  })

  it('a tap while an ORDER is armed still reports the pickup group, which cancels', () => {
    // The pill never lies about which group it is. `resolveTapAction` turns the
    // mismatch into `cancel`, so an armed order cannot be cleared from here.
    const value = armModeValue(ARMED_ORDER)
    renderPickupsCallout(makePickups(1), value)

    fireEvent.click(screen.getByRole('button', { name: /pickups need a date/i }))

    expect(value.tap).toHaveBeenCalledWith({ type: 'callout', group: 'pickup' })
  })
})
