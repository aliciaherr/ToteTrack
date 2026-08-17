import { describe, it, expect, beforeEach } from 'vitest'

import { orders, pickups } from '@/db/schema'
import {
  clearAndRenumber,
  placeAndRenumber,
  renumberColumn,
  type PlacementTable,
  type Tx,
} from '../placement.renumber'
import { createFakeTable, expectDenseSequence, type FakeTable } from './placement.fake-db'

// The real configs, copied from `calendar.ts` / `pickups.calendar.ts`. Copied
// rather than imported because both live in `'use server'` modules, which may
// only export async functions.
const ORDERS: PlacementTable = {
  label: 'orders',
  table: orders,
  idColumn: orders.id,
  dateColumn: orders.production_date,
  sortIndexColumn: orders.production_sort_index,
  tiebreakColumn: orders.po_number,
  updatedAtColumn: orders.updated_at,
}

const PICKUPS: PlacementTable = {
  label: 'pickups',
  table: pickups,
  idColumn: pickups.id,
  dateColumn: pickups.pickup_date,
  sortIndexColumn: pickups.sort_index,
  tiebreakColumn: pickups.created_at,
  updatedAtColumn: pickups.updated_at,
}

/**
 * A config crossing the two tables — the shape CONSTRAINT-25 forbids. Drizzle's
 * `.set()` is keyed by property name, so a foreign column would otherwise
 * resolve to a key `orders` does not have and the write would be dropped in
 * silence instead of failing.
 */
const MISWIRED_ORDERS: PlacementTable = { ...ORDERS, sortIndexColumn: pickups.sort_index }

const ORDER_COLUMNS = { dateKey: 'production_date', sortIndex: 'production_sort_index' }
const PICKUP_COLUMNS = { dateKey: 'pickup_date', sortIndex: 'sort_index' }

// The columns the *order* half owns. No pickup write may ever name one.
const ORDER_ONLY_COLUMNS = ['production_date', 'production_sort_index']
// Everything a pickup placement is allowed to write: its day, its position in
// that day, and the stamp on the one row that actually moved.
const PICKUP_WRITABLE_COLUMNS = ['pickup_date', 'sort_index', 'updated_at']

const MONDAY = '2026-07-27'
const TUESDAY = '2026-07-28'

/**
 * One below the first position. Negative offsets are relative-to-the-end in
 * `Array.splice`, so -1 is the value that tells the lower clamp apart from a
 * raw splice: clamped the card lands first, unclamped it would land
 * second-to-last. A larger negative such as -5 splices to 0 on its own and
 * would pass whether or not the clamp exists.
 */
const BEFORE_FIRST_POSITION = -1

/** Runs `work` against the fake table's transaction handle. */
function inTransaction(table: FakeTable, work: (tx: Tx) => Promise<void>): Promise<void> {
  return table.transaction((tx) => work(tx as unknown as Tx))
}

describe('renumberColumn', () => {
  it('renumbers an all-NULL column to 0..n-1 in the order already displayed', async () => {
    // The order the salesperson is looking at is the tiebreak order — PO-001
    // first — because every index is NULL. Renumbering must not move anything.
    const table = createFakeTable(ORDER_COLUMNS, [
      { id: 'order-c', dateKey: MONDAY, sortIndex: null, tiebreak: 'PO-003' },
      { id: 'order-a', dateKey: MONDAY, sortIndex: null, tiebreak: 'PO-001' },
      { id: 'order-b', dateKey: MONDAY, sortIndex: null, tiebreak: 'PO-002' },
    ])

    await inTransaction(table, (tx) => renumberColumn(tx, ORDERS, MONDAY))

    expect(table.ids(MONDAY)).toEqual(['order-a', 'order-b', 'order-c'])
    expectDenseSequence(table.indices(MONDAY))
  })

  it('renumbers a column holding duplicate indices to 0..n-1', async () => {
    const table = createFakeTable(ORDER_COLUMNS, [
      { id: 'order-a', dateKey: MONDAY, sortIndex: 1, tiebreak: 'PO-001' },
      { id: 'order-b', dateKey: MONDAY, sortIndex: 1, tiebreak: 'PO-002' },
      { id: 'order-c', dateKey: MONDAY, sortIndex: 0, tiebreak: 'PO-003' },
    ])

    await inTransaction(table, (tx) => renumberColumn(tx, ORDERS, MONDAY))

    // The duplicate pair is broken by the tiebreak, exactly as the read query
    // would have broken it on screen.
    expect(table.ids(MONDAY)).toEqual(['order-c', 'order-a', 'order-b'])
    expectDenseSequence(table.indices(MONDAY))
  })

  it('leaves every other day alone', async () => {
    const table = createFakeTable(ORDER_COLUMNS, [
      { id: 'order-a', dateKey: MONDAY, sortIndex: null, tiebreak: 'PO-001' },
      { id: 'order-b', dateKey: TUESDAY, sortIndex: null, tiebreak: 'PO-002' },
    ])

    await inTransaction(table, (tx) => renumberColumn(tx, ORDERS, MONDAY))

    expect(table.row('order-b')?.sortIndex).toBeNull()
  })
})

describe('placeAndRenumber', () => {
  /** Four cards on one Monday, already dense, so a move is unambiguous. */
  function mondayColumn(): FakeTable {
    return createFakeTable(ORDER_COLUMNS, [
      { id: 'order-a', dateKey: MONDAY, sortIndex: 0, tiebreak: 'PO-001' },
      { id: 'order-b', dateKey: MONDAY, sortIndex: 1, tiebreak: 'PO-002' },
      { id: 'order-c', dateKey: MONDAY, sortIndex: 2, tiebreak: 'PO-003' },
      { id: 'order-d', dateKey: MONDAY, sortIndex: 3, tiebreak: 'PO-004' },
    ])
  }

  it('splices the card in at the post-removal index the client sent', async () => {
    const table = mondayColumn()

    await inTransaction(table, (tx) => placeAndRenumber(tx, ORDERS, 'order-a', MONDAY, 2))

    expect(table.ids(MONDAY)).toEqual(['order-b', 'order-c', 'order-a', 'order-d'])
    expectDenseSequence(table.indices(MONDAY))
  })

  it('clamps an index past the end of the column to last place', async () => {
    const table = mondayColumn()

    await inTransaction(table, (tx) => placeAndRenumber(tx, ORDERS, 'order-a', MONDAY, 99))

    expect(table.ids(MONDAY)).toEqual(['order-b', 'order-c', 'order-d', 'order-a'])
    expectDenseSequence(table.indices(MONDAY))
  })

  it('clamps an index below the front of the column to first place', async () => {
    const table = mondayColumn()

    await inTransaction(table, (tx) =>
      placeAndRenumber(tx, ORDERS, 'order-c', MONDAY, BEFORE_FIRST_POSITION),
    )

    expect(table.ids(MONDAY)).toEqual(['order-c', 'order-a', 'order-b', 'order-d'])
    expectDenseSequence(table.indices(MONDAY))
  })

  it('renumbers the origin column too when the card changes day', async () => {
    const table = createFakeTable(ORDER_COLUMNS, [
      { id: 'order-a', dateKey: MONDAY, sortIndex: 0, tiebreak: 'PO-001' },
      { id: 'order-b', dateKey: MONDAY, sortIndex: 1, tiebreak: 'PO-002' },
      { id: 'order-c', dateKey: MONDAY, sortIndex: 2, tiebreak: 'PO-003' },
      { id: 'order-x', dateKey: TUESDAY, sortIndex: null, tiebreak: 'PO-010' },
      { id: 'order-y', dateKey: TUESDAY, sortIndex: null, tiebreak: 'PO-011' },
    ])

    await inTransaction(table, (tx) => placeAndRenumber(tx, ORDERS, 'order-a', TUESDAY, 1))

    expect(table.ids(TUESDAY)).toEqual(['order-x', 'order-a', 'order-y'])
    expectDenseSequence(table.indices(TUESDAY))
    // The gap the card left behind closes.
    expect(table.ids(MONDAY)).toEqual(['order-b', 'order-c'])
    expectDenseSequence(table.indices(MONDAY))
  })

  it('places a previously unscheduled card without touching any other day', async () => {
    const table = createFakeTable(ORDER_COLUMNS, [
      { id: 'order-a', dateKey: null, sortIndex: null, tiebreak: 'PO-001' },
      { id: 'order-x', dateKey: TUESDAY, sortIndex: 7, tiebreak: 'PO-010' },
    ])

    await inTransaction(table, (tx) => placeAndRenumber(tx, ORDERS, 'order-a', MONDAY, 0))

    expect(table.ids(MONDAY)).toEqual(['order-a'])
    expect(table.row('order-a')?.sortIndex).toBe(0)
    // Tuesday was neither the origin nor the destination, so its stale index
    // stays exactly as it was — renumbering is scoped to the columns that moved.
    expect(table.row('order-x')?.sortIndex).toBe(7)
  })

  it('never names an order column when it is driven by the pickup config', async () => {
    // A pickup placement drives a config naming `pickups` and only `pickups`, so
    // no statement it issues can reach an order sharing the day (CONSTRAINT-25).
    // The observable form of that is the payloads themselves — asserting instead
    // on a second, unwired fake table would be true by construction.
    const pickupTable = createFakeTable(PICKUP_COLUMNS, [
      { id: 'pickup-a', dateKey: MONDAY, sortIndex: null, tiebreak: '2026-01-01' },
      { id: 'pickup-b', dateKey: MONDAY, sortIndex: null, tiebreak: '2026-01-02' },
    ])

    await inTransaction(pickupTable, (tx) => placeAndRenumber(tx, PICKUPS, 'pickup-b', MONDAY, 0))

    expect(pickupTable.ids(MONDAY)).toEqual(['pickup-b', 'pickup-a'])
    expectDenseSequence(pickupTable.indices(MONDAY))
    // Non-empty, so the loops below cannot pass by having nothing to check.
    expect(pickupTable.payloads().length).toBeGreaterThan(0)
    for (const payload of pickupTable.payloads()) {
      for (const column of ORDER_ONLY_COLUMNS) {
        expect(payload).not.toHaveProperty(column)
      }
      for (const key of Object.keys(payload)) {
        expect(PICKUP_WRITABLE_COLUMNS).toContain(key)
      }
    }
  })
})

describe('a config naming a column from the other table', () => {
  it('fails loudly rather than writing a key the table does not have', async () => {
    const table = createFakeTable(ORDER_COLUMNS, [
      { id: 'order-a', dateKey: MONDAY, sortIndex: null, tiebreak: 'PO-001' },
      { id: 'order-b', dateKey: MONDAY, sortIndex: null, tiebreak: 'PO-002' },
    ])

    await expect(
      inTransaction(table, (tx) => renumberColumn(tx, MISWIRED_ORDERS, MONDAY)),
    ).rejects.toThrow(/does not belong to orders/)
    // The refusal happens before any statement lands, so the column is untouched.
    expect(table.indices(MONDAY)).toEqual([null, null])
  })
})

describe('clearAndRenumber', () => {
  let table: FakeTable

  beforeEach(() => {
    table = createFakeTable(ORDER_COLUMNS, [
      { id: 'order-a', dateKey: MONDAY, sortIndex: 0, tiebreak: 'PO-001' },
      { id: 'order-b', dateKey: MONDAY, sortIndex: 1, tiebreak: 'PO-002' },
      { id: 'order-c', dateKey: MONDAY, sortIndex: 2, tiebreak: 'PO-003' },
    ])
  })

  it('nulls both columns and closes the gap on the day it left', async () => {
    await inTransaction(table, (tx) => clearAndRenumber(tx, ORDERS, 'order-b'))

    expect(table.row('order-b')).toMatchObject({ dateKey: null, sortIndex: null })
    expect(table.ids(MONDAY)).toEqual(['order-a', 'order-c'])
    expectDenseSequence(table.indices(MONDAY))
  })

  it('is a no-op renumber for a card that was already unscheduled', async () => {
    const unscheduled = createFakeTable(ORDER_COLUMNS, [
      { id: 'order-a', dateKey: null, sortIndex: null, tiebreak: 'PO-001' },
    ])

    await inTransaction(unscheduled, (tx) => clearAndRenumber(tx, ORDERS, 'order-a'))

    expect(unscheduled.row('order-a')).toMatchObject({ dateKey: null, sortIndex: null })
  })
})
