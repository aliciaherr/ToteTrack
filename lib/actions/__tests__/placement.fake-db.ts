/**
 * In-memory stand-in for one placement table (`orders` or `pickups`), shared by
 * `placement.renumber.test.ts`, `calendar.test.ts` and `pickups.calendar.test.ts`.
 *
 * Renumbering is about what the *whole column* looks like afterwards, which a
 * queued-return mock cannot express: the helper reads the column, decides an
 * order, writes it back, and then reads it again for the origin day. This fake
 * applies the writes, so a test can assert the resulting sequence rather than
 * the statements that produced it.
 *
 * Not itself a test file — vitest only collects `*.test.ts`.
 */

import { expect } from 'vitest'

/** One row of the faked table, reduced to the four columns placement touches. */
export interface FakeRow {
  id: string
  /** Day column — `production_date` / `pickup_date`. Null means unscheduled. */
  dateKey: string | null
  /** Sort index column. Null models a row that has never been renumbered. */
  sortIndex: number | null
  /** Tiebreak column — `po_number` / `created_at`, compared as a string. */
  tiebreak: string
}

/** Drizzle `.set()` property names for the two columns placement writes. */
export interface FakeTableColumns {
  readonly dateKey: string
  readonly sortIndex: string
}

export interface FakeTable {
  /** Rows on `dateKey`, in the order the calendar read query would return them. */
  column(dateKey: string): FakeRow[]
  /** Sort indices on `dateKey`, in that same displayed order. */
  indices(dateKey: string): (number | null)[]
  /** Ids on `dateKey`, in that same displayed order. */
  ids(dateKey: string): string[]
  row(id: string): FakeRow | undefined
  /** Every payload handed to `.set()`, so a test can assert what was *not* written. */
  payloads(): Record<string, unknown>[]
  /**
   * Makes the `ordinal`-th update statement (1-based) throw, to exercise the
   * rollback path. Failing a *later* write is what proves the rollback: the
   * writes before it already landed and must be undone.
   */
  failWriteAt(ordinal: number, message: string): void
  /**
   * `db.transaction` stand-in. Restores the pre-call snapshot when the callback
   * throws, which is the property the real transaction gives us and the only
   * one the rollback test is about.
   */
  transaction<T>(run: (tx: never) => Promise<T>): Promise<T>
}

/**
 * The value a drizzle `eq(column, value)` was built with. Drizzle stores it as a
 * `Param` chunk whose `value` is the bound string; the surrounding
 * `StringChunk`s hold arrays, so a string test picks out the parameter alone.
 */
function eqValue(condition: unknown): string | null {
  const chunks = (condition as { queryChunks?: { value?: unknown }[] } | null)?.queryChunks ?? []
  const param = chunks.find((chunk) => typeof chunk?.value === 'string')
  return param === undefined ? null : String(param.value)
}

/** `sort index ASC NULLS LAST, tiebreak ASC` — the calendar's read ordering. */
function byDisplayOrder(left: FakeRow, right: FakeRow): number {
  const leftIndex = left.sortIndex ?? Number.POSITIVE_INFINITY
  const rightIndex = right.sortIndex ?? Number.POSITIVE_INFINITY
  if (leftIndex !== rightIndex) return leftIndex - rightIndex
  return left.tiebreak.localeCompare(right.tiebreak)
}

/** Mutable state behind one fake table. `rows` is replaced wholesale on rollback. */
interface FakeState {
  rows: FakeRow[]
  payloads: Record<string, unknown>[]
  writeCount: number
  failure: { ordinal: number; message: string } | null
}

/** Rows on one day, in the order the calendar read query would return them. */
function columnOf(state: FakeState, dateKey: string): FakeRow[] {
  return state.rows.filter((row) => row.dateKey === dateKey).sort(byDisplayOrder)
}

/** The `tx.select(...)` half of the drizzle chain the renumberer calls. */
function buildSelect(state: FakeState) {
  return () => ({
    from: () => ({
      where: (condition: unknown) => {
        const value = eqValue(condition)
        return {
          // `readDateKey` — one row, matched on its id.
          limit: () =>
            Promise.resolve(
              state.rows.filter((row) => row.id === value).map((row) => ({ dateKey: row.dateKey })),
            ),
          // `readColumn` — a whole day, matched on the day column.
          orderBy: () =>
            Promise.resolve(
              value === null ? [] : columnOf(state, value).map((row) => ({ id: row.id })),
            ),
        }
      },
    }),
  })
}

/** The `tx.update(...)` half, which applies the payload to the backing row. */
function buildUpdate(state: FakeState, columns: FakeTableColumns) {
  return () => ({
    set: (payload: Record<string, unknown>) => ({
      where: (condition: unknown) => {
        state.writeCount += 1
        if (state.failure !== null && state.failure.ordinal === state.writeCount) {
          return Promise.reject(new Error(state.failure.message))
        }
        const id = eqValue(condition)
        const target = state.rows.find((row) => row.id === id)
        if (target === undefined) {
          return Promise.reject(new Error(`fake table: no row with id ${id}`))
        }
        state.payloads.push(payload)
        if (columns.dateKey in payload) target.dateKey = payload[columns.dateKey] as string | null
        if (columns.sortIndex in payload) {
          target.sortIndex = payload[columns.sortIndex] as number | null
        }
        return Promise.resolve(undefined)
      },
    }),
  })
}

/** Builds a fake table over a copy of `rows`, leaving the caller's array alone. */
export function createFakeTable(columns: FakeTableColumns, rows: FakeRow[]): FakeTable {
  const state: FakeState = {
    rows: rows.map((row) => ({ ...row })),
    payloads: [],
    writeCount: 0,
    failure: null,
  }
  const tx = { select: buildSelect(state), update: buildUpdate(state, columns) }

  return {
    column: (dateKey) => columnOf(state, dateKey),
    indices: (dateKey) => columnOf(state, dateKey).map((row) => row.sortIndex),
    ids: (dateKey) => columnOf(state, dateKey).map((row) => row.id),
    row: (id) => state.rows.find((candidate) => candidate.id === id),
    payloads: () => state.payloads,
    failWriteAt: (ordinal, message) => {
      state.failure = { ordinal, message }
    },
    transaction: async (run) => {
      const snapshot = state.rows.map((row) => ({ ...row }))
      try {
        return await run(tx as never)
      } catch (cause) {
        state.rows = snapshot
        throw cause
      }
    },
  }
}

/** Asserts a column is a dense `0..n-1` with no nulls and no duplicates. */
export function expectDenseSequence(indices: (number | null)[]): void {
  // The expected sequence is derived from the actual array's own length, so an
  // empty column would satisfy it unconditionally. A caller reaching here with
  // nothing to check has almost certainly asserted on the wrong day.
  expect(indices.length).toBeGreaterThan(0)
  expect(indices).toEqual(indices.map((_value, position) => position))
}
