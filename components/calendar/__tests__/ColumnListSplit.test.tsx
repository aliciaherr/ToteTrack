import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { DndContext } from '@dnd-kit/core'
import DayColumn from '../DayColumn'
import { COLUMN_LIST_FLEX } from '../DayColumnParts'
import { PickupVisibilityProvider } from '../pickupVisibility'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

// jsdom has no layout engine, so the bug this file guards — a column holding a
// pickup gave its pickups list ~24px less height than a column whose pickups
// list was empty — cannot be caught by measuring. It can be caught one step
// upstream, at the class contract that decides the split: both branches of both
// lists must declare the *same* explicit flex basis, and none of them may carry
// `flex-1`. `flex-1` is `flex: 1 1 0%`, and with a zero basis and
// `box-sizing: border-box` each region's base size becomes its own padding —
// the `p-8` empty state then outweighs the `p-2` populated list and skews the
// split. Asserting the classes is the honest jsdom-sized version of the check.

const TUESDAY = new Date(2026, 6, 28)

const BOTH_LISTS_ON = {
  showOrders: true,
  showPickups: true,
  toggleOrders: vi.fn(),
  togglePickups: vi.fn(),
}

function makeRow(): CalendarOrderRow {
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
    production_date: '2026-07-28',
    requested_delivery_date: '2026-07-31',
    production_sort_index: 0,
    contacts: [],
  }
}

function makePickup(): CalendarPickupRow {
  return {
    id: 'pickup-1',
    customer_id: '33333333-3333-3333-3333-333333333333',
    customer_name: 'Northside Bottling',
    status: 'scheduled',
    qty_275: 12,
    qty_330: 4,
    pickup_date: '2026-07-28',
    sort_index: 0,
    address: null,
    notes: null,
    contacts: [],
  }
}

/** The two list regions of a column with both toggles on, in DOM order. */
function renderRegions(rows: CalendarOrderRow[], pickups: CalendarPickupRow[]): HTMLElement[] {
  render(
    <DndContext>
      <PickupVisibilityProvider value={BOTH_LISTS_ON}>
        <DayColumn
          date={TUESDAY}
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

  // header, body, footer — the body holds one region per visible list.
  const body = screen.getByTestId('day-column').children[1]
  return Array.from(body.children) as HTMLElement[]
}

/** The sizing classes only, so `p-2` vs `p-8` and the divider drop out. */
function flexClasses(element: HTMLElement): string[] {
  const sizing = new Set(['grow', 'shrink', 'flex-1'])
  return element.className
    .split(/\s+/)
    .filter((token) => sizing.has(token) || token.startsWith('basis-') || token === 'min-h-0')
    .sort()
}

describe('day column list split', () => {
  const cases: Array<[string, CalendarOrderRow[], CalendarPickupRow[]]> = [
    ['both lists populated', [makeRow()], [makePickup()]],
    ['orders populated, pickups empty', [makeRow()], []],
    ['orders empty, pickups populated', [], [makePickup()]],
    ['both lists empty', [], []],
  ]

  it.each(cases)('gives both regions the same flex sizing — %s', (_name, rows, pickups) => {
    const [orders, pickupsRegion] = renderRegions(rows, pickups)

    expect(flexClasses(orders)).toEqual(flexClasses(pickupsRegion))
  })

  it.each(cases)('declares an explicit half basis on both regions — %s', (_name, rows, pickups) => {
    const regions = renderRegions(rows, pickups)

    expect(regions).toHaveLength(2)
    for (const region of regions) {
      expect(region.className).toContain('basis-1/2')
      expect(region.className).toContain('min-h-0')
    }
  })

  it.each(cases)('never falls back to flex-1 on either region — %s', (_name, rows, pickups) => {
    // `flex-1` would reset the basis to 0 and hand the split back to padding,
    // which is exactly how the columns drifted apart.
    for (const region of renderRegions(rows, pickups)) {
      expect(region.className.split(/\s+/)).not.toContain('flex-1')
    }
  })

  it('is the sizing the shared constant declares, so the two lists cannot drift', () => {
    expect(COLUMN_LIST_FLEX.split(' ').sort()).toEqual(['basis-1/2', 'grow', 'min-h-0', 'shrink'])
    expect(COLUMN_LIST_FLEX).not.toContain('flex-1')
  })
})
