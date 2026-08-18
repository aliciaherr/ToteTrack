import { render, screen, waitFor, within } from '@testing-library/react'
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DndContext, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'

const mockSetProductionPlacement = vi.hoisted(() => vi.fn())
const mockClearProductionPlacement = vi.hoisted(() => vi.fn())
const mockSetPickupPlacement = vi.hoisted(() => vi.fn())
const mockClearPickupPlacement = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/calendar', () => ({
  setProductionPlacement: mockSetProductionPlacement,
  clearProductionPlacement: mockClearProductionPlacement,
}))

vi.mock('@/lib/actions/pickups.calendar', () => ({
  setPickupPlacement: mockSetPickupPlacement,
  clearPickupPlacement: mockClearPickupPlacement,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

import DayColumn from '../DayColumn'
import { findActiveCard } from '../CalendarDragOverlay'
import { PickupVisibilityProvider } from '../pickupVisibility'
import { useProductionPlacement } from '../useProductionPlacement'
import { useGroupedPlacement, usePickupPlacement } from '../usePickupPlacement'
import { groupedCollisionDetection } from '../calendarCollision'
import {
  pickupColumnDroppableId,
  readDragGroup,
  readDroppableGroup,
  resolveDropTarget,
  sortableListId,
  toTranslate,
  POINTER_ACTIVATION_DISTANCE_PX,
  type CardDragData,
  type CardGroup,
  type ColumnDropData,
} from '../calendarDnd'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'
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
    contacts: [],
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

const CARD_AT = (dateKey: string, index: number, group: CardGroup = 'order'): CardDragData => ({
  type: 'card',
  group,
  dateKey,
  index,
})

const COLUMN = (
  dateKey: string,
  cardCount: number,
  group: CardGroup = 'order',
): ColumnDropData => ({
  type: 'column',
  group,
  dateKey,
  cardCount,
})

beforeEach(() => {
  vi.clearAllMocks()
  mockSetProductionPlacement.mockResolvedValue({ success: true })
  mockClearProductionPlacement.mockResolvedValue({ success: true })
  mockSetPickupPlacement.mockResolvedValue({ success: true })
  mockClearPickupPlacement.mockResolvedValue({ success: true })
})

describe('resolveDropTarget', () => {
  it('resolves a drop on another day to that date and the released index', () => {
    const target = resolveDropTarget(
      dragEvent('order-1', CARD_AT(MONDAY, 0), CARD_AT(TUESDAY, 2)),
    )

    expect(target).toEqual({
      group: 'order',
      cardId: 'order-1',
      dateKey: TUESDAY,
      index: 2,
    })
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

    expect(target).toEqual({
      group: 'order',
      cardId: 'order-1',
      dateKey: MONDAY,
      index: 2,
    })
  })

  it('appends when dropped on a column’s empty space — the one case with no neighbour', () => {
    const target = resolveDropTarget(dragEvent('order-1', CARD_AT(MONDAY, 0), COLUMN(TUESDAY, 3)))

    expect(target).toEqual({
      group: 'order',
      cardId: 'order-1',
      dateKey: TUESDAY,
      index: 3,
    })
  })

  it('moves to last place on its own column’s empty space, discounting itself', () => {
    // [dragged, B, C] → drop below the cards → [B, C, dragged]. The rendered
    // count includes the dragged card, so last place is `cardCount - 1` — the
    // same correction `armPlacement.resolveColumnTap` makes for a tap.
    const target = resolveDropTarget(dragEvent('order-1', CARD_AT(MONDAY, 0), COLUMN(MONDAY, 3)))

    expect(target).toEqual({
      group: 'order',
      cardId: 'order-1',
      dateKey: MONDAY,
      index: 2,
    })
  })

  it('returns null when the already-last card is dropped on its own empty space', () => {
    // [A, B, dragged] → drop below the cards → nothing moves. Reading
    // `cardCount` verbatim resolved this to 3 against an origin index of 2, so
    // the origin guard let it through and burned a write, a revalidation and a
    // refresh on a card that was already where it landed (Task 94).
    expect(
      resolveDropTarget(dragEvent('order-1', CARD_AT(MONDAY, 2), COLUMN(MONDAY, 3))),
    ).toBeNull()
  })

  it('applies the same correction to a pickup dropped on its own column’s space', () => {
    // The two lists must never grow separate index rules (CONSTRAINT-25).
    expect(
      resolveDropTarget(
        dragEvent('pickup-1', CARD_AT(MONDAY, 1, 'pickup'), COLUMN(MONDAY, 2, 'pickup')),
      ),
    ).toBeNull()
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

  it('rejects a cross-group drop', () => {
    // An order card released over a pickup card. Nothing may cross groups
    // (CONSTRAINT-25) — a write here would put an order id in `pickups`.
    const target = resolveDropTarget(
      dragEvent('order-1', CARD_AT(MONDAY, 0, 'order'), CARD_AT(TUESDAY, 2, 'pickup')),
    )

    expect(target).toBeNull()
  })

  it('rejects a cross-group drop in the other direction too', () => {
    const target = resolveDropTarget(
      dragEvent('pickup-1', CARD_AT(MONDAY, 0, 'pickup'), COLUMN(TUESDAY, 3, 'order')),
    )

    expect(target).toBeNull()
  })

  it('a same-group same-position drop is a no-op', () => {
    const target = resolveDropTarget(
      dragEvent('pickup-1', CARD_AT(MONDAY, 1, 'pickup'), CARD_AT(MONDAY, 1, 'pickup')),
    )

    expect(target).toBeNull()
  })

  it('resolves a pickup drop, carrying the pickup group through to the mutation', () => {
    const target = resolveDropTarget(
      dragEvent('pickup-1', CARD_AT(MONDAY, 0, 'pickup'), COLUMN(TUESDAY, 2, 'pickup')),
    )

    expect(target).toEqual({
      group: 'pickup',
      cardId: 'pickup-1',
      dateKey: TUESDAY,
      index: 2,
    })
  })

  it('returns null when a payload carries no legal group', () => {
    // A hand-crafted payload, or one from a future card kind. Refused rather
    // than defaulted to orders — a default would silently pick a table.
    const event = {
      active: { id: 'order-1', data: { current: { type: 'card', dateKey: MONDAY, index: 0 } } },
      over: { id: 'over', data: { current: CARD_AT(TUESDAY, 0) } },
    } as unknown as DragEndEvent

    expect(resolveDropTarget(event)).toBeNull()
  })
})

describe('findActiveCard — the fifth enforcement site of the group discriminator', () => {
  /** Minimal `DragStartEvent` — only the fields `findActiveCard` reads. */
  function startEvent(activeId: string, activeData: unknown): DragStartEvent {
    return {
      active: { id: activeId, data: { current: activeData } },
    } as unknown as DragStartEvent
  }

  // The same uuid in both collections. This cannot happen with real data —
  // `orders` and `pickups` are separate tables with separate uuids — but it is
  // exactly the collision the overlay's doc comment says it refuses to paper
  // over, and nothing tested that claim until now.
  const SHARED_ID = 'collided-uuid'

  it('searches the payload’s own group, not both collections', () => {
    const card = findActiveCard(
      startEvent(SHARED_ID, CARD_AT(MONDAY, 0, 'pickup')),
      [makeRow({ id: SHARED_ID })],
      [makePickup({ id: SHARED_ID })],
    )

    // The pickup, never the same-id order — the group picks the list, so the
    // overlay can never draw an order card for a pickup drag (CONSTRAINT-25).
    expect(card).toEqual({ group: 'pickup', row: makePickup({ id: SHARED_ID }) })
  })

  it('resolves an order drag against the orders list for the same id', () => {
    const card = findActiveCard(
      startEvent(SHARED_ID, CARD_AT(MONDAY, 0, 'order')),
      [makeRow({ id: SHARED_ID })],
      [makePickup({ id: SHARED_ID })],
    )

    expect(card).toEqual({ group: 'order', row: makeRow({ id: SHARED_ID }) })
  })

  it('returns null when the id is only in the other group’s list', () => {
    // Draws nothing rather than reaching across. A found row here would mean
    // the two tables had colliding uuids, and silently drawing it would hide
    // that instead of surfacing it as an overlay that never appears.
    expect(
      findActiveCard(startEvent('order-1', CARD_AT(MONDAY, 0, 'pickup')), [makeRow()], []),
    ).toBeNull()
    expect(
      findActiveCard(startEvent('pickup-1', CARD_AT(MONDAY, 0, 'order')), [], [makePickup()]),
    ).toBeNull()
  })

  it('returns null for a payload carrying no legal group', () => {
    const noGroup = { type: 'card', dateKey: MONDAY, index: 0 }
    expect(
      findActiveCard(startEvent('order-1', noGroup), [makeRow()], [makePickup()]),
    ).toBeNull()
    expect(
      findActiveCard(startEvent('order-1', { ...noGroup, group: 'orders' }), [makeRow()], []),
    ).toBeNull()
    expect(findActiveCard(startEvent('order-1', null), [makeRow()], [])).toBeNull()
  })
})

describe('droppable id composition', () => {
  it('gives a day’s two lists ids that cannot collide', () => {
    // The orders list is the bare date key; the pickups list is composed. One
    // shared id would make a cross-group drop a matter of which list happened
    // to be nearer the finger.
    expect(pickupColumnDroppableId(MONDAY)).toBe(`pickups:${MONDAY}`)
    expect(pickupColumnDroppableId(MONDAY)).not.toBe(MONDAY)
  })

  it('gives each group its own sortable list per column', () => {
    expect(sortableListId('order', MONDAY)).toBe(`order:${MONDAY}`)
    expect(sortableListId('pickup', MONDAY)).toBe(`pickup:${MONDAY}`)
  })
})

describe('group readers', () => {
  it('reads the group off a card drag payload', () => {
    expect(readDragGroup(CARD_AT(MONDAY, 0, 'pickup'))).toBe('pickup')
  })

  it('returns null for a drag that is not a card', () => {
    expect(readDragGroup(COLUMN(MONDAY, 0))).toBeNull()
    expect(readDragGroup(null)).toBeNull()
  })

  it('reads the group off every kind of droppable', () => {
    expect(readDroppableGroup(CARD_AT(MONDAY, 0, 'pickup'))).toBe('pickup')
    expect(readDroppableGroup(COLUMN(MONDAY, 0, 'order'))).toBe('order')
    expect(readDroppableGroup({ type: 'callout', group: 'pickup' })).toBe('pickup')
  })

  it('never reaches a string method on a non-string group', () => {
    // The array-shaped payload class (T78-L01): shape-checked before any
    // membership test, so a hostile value falls through instead of throwing.
    expect(readDroppableGroup({ type: 'callout', group: ['order'] })).toBeNull()
    expect(readDroppableGroup({ type: 'column', dateKey: MONDAY, group: 7 })).toBeNull()
    expect(readDroppableGroup({ type: 'callout', group: 'orders' })).toBeNull()
  })
})

describe('groupedCollisionDetection', () => {
  /** A droppable container as the collision algorithm sees it. */
  function container(id: string, data: unknown) {
    return {
      id,
      data: { current: data },
      rect: { current: { top: 0, left: 0, right: 10, bottom: 10, width: 10, height: 10 } },
      disabled: false,
    }
  }

  function detect(activeData: unknown, containers: ReturnType<typeof container>[]) {
    return groupedCollisionDetection({
      active: { id: 'card', data: { current: activeData } },
      collisionRect: { top: 0, left: 0, right: 10, bottom: 10, width: 10, height: 10 },
      droppableRects: new Map(
        containers.map((entry) => [entry.id, entry.rect.current]),
      ),
      droppableContainers: containers,
      pointerCoordinates: { x: 5, y: 5 },
    } as never)
  }

  it('never offers the other group’s list as a collision, so no slot can open', () => {
    // The preview half of the invariant: rejecting at drop time would let the
    // pickups list part for an order card and then snap shut (CONSTRAINT-25).
    const collisions = detect(CARD_AT(MONDAY, 0, 'order'), [
      container(pickupColumnDroppableId(MONDAY), COLUMN(MONDAY, 0, 'pickup')),
      container(MONDAY, COLUMN(MONDAY, 0, 'order')),
    ])

    expect(collisions.map((collision) => collision.id)).toEqual([MONDAY])
  })

  it('offers only pickup targets while a pickup is in the air', () => {
    const collisions = detect(CARD_AT(MONDAY, 0, 'pickup'), [
      container(MONDAY, COLUMN(MONDAY, 0, 'order')),
      container(pickupColumnDroppableId(MONDAY), COLUMN(MONDAY, 0, 'pickup')),
    ])

    expect(collisions.map((collision) => collision.id)).toEqual([
      pickupColumnDroppableId(MONDAY),
    ])
  })

  it('leaves an unrecognised drag unfiltered rather than reporting a dead board', () => {
    const collisions = detect({ type: 'something-else' }, [
      container(MONDAY, COLUMN(MONDAY, 0, 'order')),
    ])

    expect(collisions.map((collision) => collision.id)).toEqual([MONDAY])
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
      await result.current.place({
        group: 'order',
        cardId: 'order-1',
        dateKey: TUESDAY,
        index: 2,
      })
    })

    // The group travels with the payload so the server can refuse a
    // pickup-shaped call outright — the mirror of `usePickupPlacement`.
    expect(mockSetProductionPlacement).toHaveBeenCalledWith('order-1', {
      group: 'order',
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
      await result.current.place({
        group: 'order',
        cardId: 'order-1',
        dateKey: TUESDAY,
        index: 0,
      })
    })

    expect(mockToast).toHaveBeenCalledWith('Cancelled orders cannot be placed.', 'error')
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})

describe('usePickupPlacement', () => {
  it('sends the pickup group with the date and sort index', async () => {
    const { result } = renderHook(() => usePickupPlacement())

    await act(async () => {
      await result.current.place({
        group: 'pickup',
        cardId: 'pickup-1',
        dateKey: TUESDAY,
        index: 2,
      })
    })

    // The group travels with the payload so the server can refuse an
    // order-shaped call outright rather than trusting the client's routing.
    expect(mockSetPickupPlacement).toHaveBeenCalledWith('pickup-1', {
      group: 'pickup',
      pickupDate: TUESDAY,
      sortIndex: 2,
    })
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled())
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('a rejected pickup placement toasts rather than moving the card', async () => {
    mockSetPickupPlacement.mockResolvedValue({ error: 'Pickup not found.' })
    const { result } = renderHook(() => usePickupPlacement())

    await act(async () => {
      await result.current.place({
        group: 'pickup',
        cardId: 'pickup-1',
        dateKey: TUESDAY,
        index: 0,
      })
    })

    expect(mockToast).toHaveBeenCalledWith('Pickup not found.', 'error')
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('clears both the date and the sort index through clearPickupPlacement', async () => {
    const { result } = renderHook(() => usePickupPlacement())

    await act(async () => {
      await result.current.unschedule('pickup-1')
    })

    expect(mockClearPickupPlacement).toHaveBeenCalledWith('pickup-1')
    expect(mockRefresh).toHaveBeenCalled()
  })
})

describe('useGroupedPlacement', () => {
  it('routes an order target to the order action and never the pickup one', async () => {
    const { result } = renderHook(() => useGroupedPlacement())

    await act(async () => {
      result.current.place({ group: 'order', cardId: 'order-1', dateKey: TUESDAY, index: 1 })
    })

    expect(mockSetProductionPlacement).toHaveBeenCalledWith('order-1', {
      group: 'order',
      productionDate: TUESDAY,
      sortIndex: 1,
    })
    expect(mockSetPickupPlacement).not.toHaveBeenCalled()
  })

  it('routes a pickup target to the pickup action and never the order one', async () => {
    const { result } = renderHook(() => useGroupedPlacement())

    await act(async () => {
      result.current.place({ group: 'pickup', cardId: 'pickup-1', dateKey: TUESDAY, index: 1 })
    })

    expect(mockSetPickupPlacement).toHaveBeenCalledWith('pickup-1', {
      group: 'pickup',
      pickupDate: TUESDAY,
      sortIndex: 1,
    })
    expect(mockSetProductionPlacement).not.toHaveBeenCalled()
  })

  it('routes each group’s unschedule to its own clear action', async () => {
    const { result } = renderHook(() => useGroupedPlacement())

    await act(async () => {
      result.current.unschedule({ group: 'pickup', cardId: 'pickup-1' })
    })
    expect(mockClearPickupPlacement).toHaveBeenCalledWith('pickup-1')
    expect(mockClearProductionPlacement).not.toHaveBeenCalled()

    await act(async () => {
      result.current.unschedule({ group: 'order', cardId: 'order-1' })
    })
    expect(mockClearProductionPlacement).toHaveBeenCalledWith('order-1')
  })
})

describe('DayColumn drag wiring', () => {
  function renderColumn(rows: CalendarOrderRow[], pickups: CalendarPickupRow[] = []) {
    return render(
      <DndContext>
        <DayColumn
          date={new Date(2026, 6, 27)}
          rows={rows}
          pickups={pickups}
          isToday={false}
          unscheduled={[]}
          unscheduledPickups={[]}
          onPick={vi.fn()}
          onPickPickup={vi.fn()}
          onSelectPickup={vi.fn()}
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

  it('renders no Sunday column to drop onto — the column is the only target', () => {
    // The strip emits Mon–Sat only (CONSTRAINT-19), so a Sunday drop target
    // cannot exist; a column's droppable id is always its own day key.
    renderColumn([makeRow()])

    expect(screen.getByTestId('day-column')).toHaveAttribute('data-date', MONDAY)
  })
})

describe('DayColumn pickup drag wiring', () => {
  const BOTH_LISTS_ON = {
    showOrders: true,
    showPickups: true,
    toggleOrders: vi.fn(),
    togglePickups: vi.fn(),
  }

  function renderBothLists(rows: CalendarOrderRow[], pickups: CalendarPickupRow[]) {
    return render(
      <DndContext>
        <PickupVisibilityProvider value={BOTH_LISTS_ON}>
          <DayColumn
            date={new Date(2026, 6, 27)}
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
      </DndContext>,
    )
  }

  it('scheduled pickup cards expose drag listeners', () => {
    renderBothLists([], [makePickup({ status: 'scheduled' })])

    const card = screen.getByTestId('pickup-card')
    expect(card.parentElement).toHaveAttribute('aria-roledescription')
    expect(card).toHaveAttribute('data-draggable', 'true')
  })

  it('completed pickup cards expose no drag listeners', () => {
    renderBothLists([], [makePickup({ status: 'completed' })])

    const card = screen.getByTestId('pickup-card')
    expect(card.parentElement).not.toHaveAttribute('aria-roledescription')
    expect(card).not.toHaveAttribute('data-draggable')
  })

  it('draws the two lists as two separate drop targets, never one merged list', () => {
    renderBothLists([makeRow()], [makePickup()])

    // Two distinct lists, so dnd-kit cannot reorder a card from one into the
    // other — one merged list is exactly the failure CONSTRAINT-25 forbids.
    const lists = screen.getAllByRole('list')
    expect(lists).toHaveLength(2)

    const pickupList = screen.getByTestId('column-pickups')
    expect(within(pickupList).getAllByTestId('pickup-card')).toHaveLength(1)
    expect(within(pickupList).queryByTestId('production-card')).not.toBeInTheDocument()
  })

  it('an empty pickups list is still a drop target', () => {
    renderBothLists([], [])

    expect(screen.getByTestId('column-pickups-empty')).toBeInTheDocument()
  })
})
