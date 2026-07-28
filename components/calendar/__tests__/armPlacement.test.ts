import { describe, it, expect } from 'vitest'
import {
  ARM_DELAY_MS,
  ARM_MOVE_TOLERANCE_PX,
  resolveTapAction,
  type ArmedCard,
} from '../armPlacement'
import { UNSCHEDULED_ORIGIN } from '../calendarDnd'
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
    production_date: null,
    requested_delivery_date: '2026-07-31',
    production_sort_index: null,
    ...overrides,
  }
}

function armedAt(dateKey: string, index: number): ArmedCard {
  return { row: makeRow(), dateKey, index }
}

describe('resolveTapAction — card taps', () => {
  it('places at the tapped card’s position in another column', () => {
    const action = resolveTapAction(armedAt(MONDAY, 0), {
      type: 'card',
      orderId: 'order-2',
      dateKey: TUESDAY,
      index: 2,
    })

    expect(action).toEqual({
      kind: 'place',
      target: { orderId: 'order-1', dateKey: TUESDAY, index: 2 },
    })
  })

  it('takes the tapped card’s place when moving down within a column', () => {
    // [A, armed, B, C] — tapping C (rendered index 3) must land the armed card
    // in C's slot, which is insertion index 2 once the armed card lifts out.
    const action = resolveTapAction(armedAt(MONDAY, 1), {
      type: 'card',
      orderId: 'order-c',
      dateKey: MONDAY,
      index: 3,
    })

    expect(action).toEqual({
      kind: 'place',
      target: { orderId: 'order-1', dateKey: MONDAY, index: 2 },
    })
  })

  it('uses the tapped index verbatim when moving up within a column', () => {
    const action = resolveTapAction(armedAt(MONDAY, 3), {
      type: 'card',
      orderId: 'order-a',
      dateKey: MONDAY,
      index: 1,
    })

    expect(action).toEqual({
      kind: 'place',
      target: { orderId: 'order-1', dateKey: MONDAY, index: 1 },
    })
  })

  it('cancels without writing when the tap resolves to the card’s own position', () => {
    // Tapping the card directly below the armed one is a visual no-op.
    const action = resolveTapAction(armedAt(MONDAY, 1), {
      type: 'card',
      orderId: 'order-b',
      dateKey: MONDAY,
      index: 2,
    })

    expect(action).toEqual({ kind: 'cancel' })
  })

  it('cancels when the armed card itself is tapped', () => {
    const action = resolveTapAction(armedAt(MONDAY, 1), {
      type: 'card',
      orderId: 'order-1',
      dateKey: MONDAY,
      index: 1,
    })

    expect(action).toEqual({ kind: 'cancel' })
  })

  it('treats a tap on a dropdown card as a tap on the callout', () => {
    const action = resolveTapAction(armedAt(MONDAY, 0), {
      type: 'card',
      orderId: 'order-9',
      dateKey: UNSCHEDULED_ORIGIN,
      index: 0,
    })

    expect(action).toEqual({ kind: 'unschedule', orderId: 'order-1' })
  })
})

describe('resolveTapAction — column and callout taps', () => {
  it('appends to another column at its card count', () => {
    const action = resolveTapAction(armedAt(MONDAY, 0), {
      type: 'column',
      dateKey: TUESDAY,
      cardCount: 3,
    })

    expect(action).toEqual({
      kind: 'place',
      target: { orderId: 'order-1', dateKey: TUESDAY, index: 3 },
    })
  })

  it('moves to last place within its own column', () => {
    // [armed, B, C] → tap empty space → [B, C, armed]: insertion index 2.
    const action = resolveTapAction(armedAt(MONDAY, 0), {
      type: 'column',
      dateKey: MONDAY,
      cardCount: 3,
    })

    expect(action).toEqual({
      kind: 'place',
      target: { orderId: 'order-1', dateKey: MONDAY, index: 2 },
    })
  })

  it('cancels without writing when the card is already last in its column', () => {
    const action = resolveTapAction(armedAt(MONDAY, 2), {
      type: 'column',
      dateKey: MONDAY,
      cardCount: 3,
    })

    expect(action).toEqual({ kind: 'cancel' })
  })

  it('unschedules a placed card tapped onto the callout', () => {
    const action = resolveTapAction(armedAt(MONDAY, 0), { type: 'callout' })

    expect(action).toEqual({ kind: 'unschedule', orderId: 'order-1' })
  })

  it('cancels without writing when an unscheduled card is tapped onto the callout', () => {
    const action = resolveTapAction(armedAt(UNSCHEDULED_ORIGIN, 0), { type: 'callout' })

    expect(action).toEqual({ kind: 'cancel' })
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
