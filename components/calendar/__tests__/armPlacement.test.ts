import { describe, it, expect } from 'vitest'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  ARM_DELAY_MS,
  ARM_MOVE_TOLERANCE_PX,
  resolveTapAction,
  type ArmedCard,
  type TapAction,
} from '../armPlacement'
import {
  resolveDropTarget,
  UNSCHEDULED_ORIGIN,
  type CardDragData,
  type ColumnDropData,
  type DropTarget,
} from '../calendarDnd'
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
    production_date: null,
    requested_delivery_date: '2026-07-31',
    production_sort_index: null,
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

describe('resolveTapAction — card taps', () => {
  it('places at the tapped card’s position in another column', () => {
    const action = resolveTapAction(armedAt(MONDAY, 0), {
      type: 'card',
      group: 'order',
      cardId: 'order-2',
      dateKey: TUESDAY,
      index: 2,
    })

    expect(action).toEqual({
      kind: 'place',
      target: { group: 'order', cardId: 'order-1', dateKey: TUESDAY, index: 2 },
    })
  })

  it('takes the tapped card’s place when moving down within a column', () => {
    // [A, armed, B, C] — tapping C (rendered index 3) lands the armed card in
    // C's slot: index 3, verbatim. The old `-1` correction landed it in B's slot
    // instead, one short of where the salesperson aimed (Task 91).
    const action = resolveTapAction(armedAt(MONDAY, 1), {
      type: 'card',
      group: 'order',
      cardId: 'order-c',
      dateKey: MONDAY,
      index: 3,
    })

    expect(action).toEqual({
      kind: 'place',
      target: { group: 'order', cardId: 'order-1', dateKey: MONDAY, index: 3 },
    })
  })

  it('uses the tapped index verbatim when moving up within a column', () => {
    const action = resolveTapAction(armedAt(MONDAY, 3), {
      type: 'card',
      group: 'order',
      cardId: 'order-a',
      dateKey: MONDAY,
      index: 1,
    })

    expect(action).toEqual({
      kind: 'place',
      target: { group: 'order', cardId: 'order-1', dateKey: MONDAY, index: 1 },
    })
  })

  it('swaps with the neighbour directly below rather than cancelling', () => {
    // [A, armed, B] — tapping B is a real one-slot move down, not a no-op. It
    // read as a no-op only because the `-1` correction turned index 2 back into
    // the armed card's own index 1 and the resolver cancelled on the collision.
    const action = resolveTapAction(armedAt(MONDAY, 1), {
      type: 'card',
      group: 'order',
      cardId: 'order-b',
      dateKey: MONDAY,
      index: 2,
    })

    expect(action).toEqual({
      kind: 'place',
      target: { group: 'order', cardId: 'order-1', dateKey: MONDAY, index: 2 },
    })
  })

  it('swaps with the neighbour directly above', () => {
    const action = resolveTapAction(armedAt(MONDAY, 2), {
      type: 'card',
      group: 'order',
      cardId: 'order-b',
      dateKey: MONDAY,
      index: 1,
    })

    expect(action).toEqual({
      kind: 'place',
      target: { group: 'order', cardId: 'order-1', dateKey: MONDAY, index: 1 },
    })
  })

  it('places at the top of its own column when the first card is tapped', () => {
    const action = resolveTapAction(armedAt(MONDAY, 4), {
      type: 'card',
      group: 'order',
      cardId: 'order-a',
      dateKey: MONDAY,
      index: 0,
    })

    expect(action).toEqual({
      kind: 'place',
      target: { group: 'order', cardId: 'order-1', dateKey: MONDAY, index: 0 },
    })
  })

  it('cancels when the armed card itself is tapped', () => {
    const action = resolveTapAction(armedAt(MONDAY, 1), {
      type: 'card',
      group: 'order',
      cardId: 'order-1',
      dateKey: MONDAY,
      index: 1,
    })

    expect(action).toEqual({ kind: 'cancel' })
  })

  it('treats a tap on a dropdown card as a tap on the callout', () => {
    const action = resolveTapAction(armedAt(MONDAY, 0), {
      type: 'card',
      group: 'order',
      cardId: 'order-9',
      dateKey: UNSCHEDULED_ORIGIN,
      index: 0,
    })

    expect(action).toEqual({
      kind: 'unschedule',
      target: { group: 'order', cardId: 'order-1' },
    })
  })
})

describe('resolveTapAction — column and callout taps', () => {
  it('appends to another column at its card count', () => {
    const action = resolveTapAction(armedAt(MONDAY, 0), {
      type: 'column',
      group: 'order',
      dateKey: TUESDAY,
      cardCount: 3,
    })

    expect(action).toEqual({
      kind: 'place',
      target: { group: 'order', cardId: 'order-1', dateKey: TUESDAY, index: 3 },
    })
  })

  it('moves to last place within its own column', () => {
    // [armed, B, C] → tap empty space → [B, C, armed]: insertion index 2.
    const action = resolveTapAction(armedAt(MONDAY, 0), {
      type: 'column',
      group: 'order',
      dateKey: MONDAY,
      cardCount: 3,
    })

    expect(action).toEqual({
      kind: 'place',
      target: { group: 'order', cardId: 'order-1', dateKey: MONDAY, index: 2 },
    })
  })

  it('cancels without writing when the card is already last in its column', () => {
    const action = resolveTapAction(armedAt(MONDAY, 2), {
      type: 'column',
      group: 'order',
      dateKey: MONDAY,
      cardCount: 3,
    })

    expect(action).toEqual({ kind: 'cancel' })
  })

  it('unschedules a placed card tapped onto the callout', () => {
    const action = resolveTapAction(armedAt(MONDAY, 0), { type: 'callout', group: 'order' })

    expect(action).toEqual({
      kind: 'unschedule',
      target: { group: 'order', cardId: 'order-1' },
    })
  })

  it('cancels without writing when an unscheduled card is tapped onto the callout', () => {
    const action = resolveTapAction(armedAt(UNSCHEDULED_ORIGIN, 0), {
      type: 'callout',
      group: 'order',
    })

    expect(action).toEqual({ kind: 'cancel' })
  })
})

describe('resolveTapAction — the group rule (CONSTRAINT-25)', () => {
  it('an armed pickup ignores an order column tap', () => {
    const action = resolveTapAction(armedPickupAt(MONDAY, 0), {
      type: 'column',
      group: 'order',
      dateKey: TUESDAY,
      cardCount: 3,
    })

    expect(action).toEqual({ kind: 'cancel' })
  })

  it('an armed order ignores a pickup column tap', () => {
    const action = resolveTapAction(armedAt(MONDAY, 0), {
      type: 'column',
      group: 'pickup',
      dateKey: TUESDAY,
      cardCount: 3,
    })

    expect(action).toEqual({ kind: 'cancel' })
  })

  it('an armed pickup ignores a tap on an order card', () => {
    const action = resolveTapAction(armedPickupAt(MONDAY, 0), {
      type: 'card',
      group: 'order',
      cardId: 'order-2',
      dateKey: TUESDAY,
      index: 1,
    })

    expect(action).toEqual({ kind: 'cancel' })
  })

  it('an armed pickup ignores the orders callout', () => {
    const action = resolveTapAction(armedPickupAt(MONDAY, 0), {
      type: 'callout',
      group: 'order',
    })

    expect(action).toEqual({ kind: 'cancel' })
  })

  it('places a pickup on its own group’s column, carrying the pickup group through', () => {
    const action = resolveTapAction(armedPickupAt(MONDAY, 0), {
      type: 'column',
      group: 'pickup',
      dateKey: TUESDAY,
      cardCount: 2,
    })

    expect(action).toEqual({
      kind: 'place',
      target: { group: 'pickup', cardId: 'pickup-1', dateKey: TUESDAY, index: 2 },
    })
  })

  it('takes the tapped card’s position in the pickups list too', () => {
    // [A, armed, B, C] in the pickups list — tapping C (rendered index 3)
    // resolves to insertion index 3, exactly as it does for orders. The two
    // lists must never grow separate index rules (CONSTRAINT-25).
    const action = resolveTapAction(armedPickupAt(MONDAY, 1), {
      type: 'card',
      group: 'pickup',
      cardId: 'pickup-c',
      dateKey: MONDAY,
      index: 3,
    })

    expect(action).toEqual({
      kind: 'place',
      target: { group: 'pickup', cardId: 'pickup-1', dateKey: MONDAY, index: 3 },
    })
  })

  it('unschedules an armed pickup tapped onto the pickups callout', () => {
    const action = resolveTapAction(armedPickupAt(MONDAY, 0), {
      type: 'callout',
      group: 'pickup',
    })

    expect(action).toEqual({
      kind: 'unschedule',
      target: { group: 'pickup', cardId: 'pickup-1' },
    })
  })
})

/**
 * The guard that replaces CONSTRAINT-29 (Task 91).
 *
 * Touch and drag are two gestures for one operation, so for the same logical
 * move they must hand the server the same insertion index. This suite runs each
 * move through both resolvers and compares. It is deliberately not written as
 * "expect index N" — an expectation would have to be updated in lockstep with a
 * regression, whereas a cross-check fails the moment the two paths disagree.
 *
 * **Scope is both target kinds** (widened in Task 94). Card targets came first,
 * because that is where the original asymmetry lived. Column targets — a drop or
 * tap on a list's empty space, the statement "put this last" — were left out
 * while only the touch path discounted the moved card from its own column's
 * rendered count; drag read `cardCount` verbatim and so fired a no-op write when
 * the already-last card was released below the cards. `resolveDropTarget` now
 * makes the same correction, so the comparison covers every target kind a card
 * can be released or tapped onto, and CONSTRAINT-29 is retired universally.
 */
describe('touch/drag parity — one insertion index, two gestures', () => {
  /** Minimal `DragEndEvent` — only the fields `resolveDropTarget` reads. */
  function dragEvent(
    cardId: string,
    origin: CardDragData,
    over: CardDragData | ColumnDropData,
  ): DragEndEvent {
    return {
      active: { id: cardId, data: { current: origin } },
      over: { id: over.dateKey, data: { current: over } },
    } as unknown as DragEndEvent
  }

  /**
   * The two resolvers say "nothing to write" in their own vocabulary — `cancel`
   * for a tap, `null` for a drop. Normalising to the drag path's shape is what
   * lets a no-op be compared as strictly as a placement.
   */
  function tapPlacement(action: TapAction): DropTarget | null {
    return action.kind === 'place' ? action.target : null
  }

  const moves: Array<[string, string, number, string, number]> = [
    ['same day, downward', MONDAY, 1, MONDAY, 3],
    ['same day, upward', MONDAY, 3, MONDAY, 1],
    ['same day, swap with the card below', MONDAY, 1, MONDAY, 2],
    ['same day, swap with the card above', MONDAY, 2, MONDAY, 1],
    ['same day, to the top', MONDAY, 4, MONDAY, 0],
    ['across days, into the middle', MONDAY, 0, TUESDAY, 2],
    ['across days, to the top', MONDAY, 2, TUESDAY, 0],
  ]

  it.each(moves)('card target — %s', (_name, fromDay, fromIndex, toDay, toIndex) => {
    const tapped = resolveTapAction(armedAt(fromDay, fromIndex), {
      type: 'card',
      group: 'order',
      cardId: 'order-target',
      dateKey: toDay,
      index: toIndex,
    })

    const dropped = resolveDropTarget(
      dragEvent(
        'order-1',
        { type: 'card', group: 'order', dateKey: fromDay, index: fromIndex },
        { type: 'card', group: 'order', dateKey: toDay, index: toIndex },
      ),
    )

    expect(tapped).toEqual({ kind: 'place', target: dropped })
  })

  // The last column is the rendered card count of the target list, and the
  // boolean is whether the move is a real one. It is carried per case so a
  // both-sides-null agreement can never pass as a placement, or the reverse —
  // the cross-check alone would be satisfied by two resolvers that both did
  // nothing.
  const columnMoves: Array<[string, string, number, string, number, boolean]> = [
    ['same day, first of three goes last', MONDAY, 0, MONDAY, 3, true],
    ['same day, middle of three goes last', MONDAY, 1, MONDAY, 3, true],
    ['same day, already last — nothing to write', MONDAY, 2, MONDAY, 3, false],
    ['same day, alone in the column — nothing to write', MONDAY, 0, MONDAY, 1, false],
    ['across days, onto a populated column', MONDAY, 0, TUESDAY, 3, true],
    ['across days, onto an empty column', MONDAY, 1, TUESDAY, 0, true],
  ]

  it.each(columnMoves)(
    'column target — %s',
    (_name, fromDay, fromIndex, toDay, cardCount, writes) => {
      const tapped = resolveTapAction(armedAt(fromDay, fromIndex), {
        type: 'column',
        group: 'order',
        dateKey: toDay,
        cardCount,
      })

      const dropped = resolveDropTarget(
        dragEvent(
          'order-1',
          { type: 'card', group: 'order', dateKey: fromDay, index: fromIndex },
          { type: 'column', group: 'order', dateKey: toDay, cardCount },
        ),
      )

      expect(tapPlacement(tapped)).toEqual(dropped)
      expect(dropped !== null).toBe(writes)
    },
  )
})

describe('arming constants', () => {
  it('arms before iPadOS’s ~500ms system long-press can compete', () => {
    expect(ARM_DELAY_MS).toBeGreaterThanOrEqual(200)
    expect(ARM_DELAY_MS).toBeLessThan(500)
  })

  it('tolerates more drift than the 8px that silently cancelled A-05 presses', () => {
    expect(ARM_MOVE_TOLERANCE_PX).toBeGreaterThan(8)
  })
})
