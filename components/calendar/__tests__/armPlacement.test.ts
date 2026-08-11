import { describe, it, expect } from 'vitest'
import {
  ARM_DELAY_MS,
  ARM_MOVE_TOLERANCE_PX,
  resolveTapAction,
  type ArmedCard,
} from '../armPlacement'
import { UNSCHEDULED_ORIGIN } from '../calendarDnd'
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
    // [A, armed, B, C] — tapping C (rendered index 3) must land the armed card
    // in C's slot, which is insertion index 2 once the armed card lifts out.
    const action = resolveTapAction(armedAt(MONDAY, 1), {
      type: 'card',
      group: 'order',
      cardId: 'order-c',
      dateKey: MONDAY,
      index: 3,
    })

    expect(action).toEqual({
      kind: 'place',
      target: { group: 'order', cardId: 'order-1', dateKey: MONDAY, index: 2 },
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

  it('cancels without writing when the tap resolves to the card’s own position', () => {
    // Tapping the card directly below the armed one is a visual no-op.
    const action = resolveTapAction(armedAt(MONDAY, 1), {
      type: 'card',
      group: 'order',
      cardId: 'order-b',
      dateKey: MONDAY,
      index: 2,
    })

    expect(action).toEqual({ kind: 'cancel' })
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

  it('applies the same-column index − 1 correction to pickups too', () => {
    // [A, armed, B, C] in the pickups list — tapping C (rendered index 3) must
    // resolve to insertion index 2, exactly as it does for orders.
    const action = resolveTapAction(armedPickupAt(MONDAY, 1), {
      type: 'card',
      group: 'pickup',
      cardId: 'pickup-c',
      dateKey: MONDAY,
      index: 3,
    })

    expect(action).toEqual({
      kind: 'place',
      target: { group: 'pickup', cardId: 'pickup-1', dateKey: MONDAY, index: 2 },
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

describe('arming constants', () => {
  it('arms before iPadOS’s ~500ms system long-press can compete', () => {
    expect(ARM_DELAY_MS).toBeGreaterThanOrEqual(200)
    expect(ARM_DELAY_MS).toBeLessThan(500)
  })

  it('tolerates more drift than the 8px that silently cancelled A-05 presses', () => {
    expect(ARM_MOVE_TOLERANCE_PX).toBeGreaterThan(8)
  })
})
