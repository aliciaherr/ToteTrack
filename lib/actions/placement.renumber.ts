/**
 * Dense renumbering of a calendar day column, shared by the order and the
 * pickup placement actions.
 *
 * Storing only the dragged row's sort index is not enough. The calendar reads
 * `... sort index ASC NULLS LAST, tiebreak ASC`, so a single row holding `1`
 * among `NULL` siblings sorts *above* all of them and the card jumps to the top
 * of the day whatever position it was released at. The fix is to rewrite the
 * whole column to a dense `0..n-1` sequence on every placement, which also
 * self-heals the legacy `NULL`s without a migration.
 *
 * **No `'use server'` — deliberately, and it must stay that way (SEC-08).**
 * The directive is what turns an exported async function into a publicly
 * callable endpoint, and every export here is an unguarded helper: none calls
 * `assertAuthenticated()` or checks a status, because those guards live once at
 * the real entry points in `calendar.ts` and `pickups.calendar.ts`. With the
 * directive on, `placeAndRenumber` would be an unauthenticated "move any row to
 * any day" endpoint. Same pattern as `leads.convert.ts` and `orders.internal.ts`.
 */

import { asc, eq, getTableColumns } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import type { db } from '@/db'

/**
 * Transaction handle, inferred from `db.transaction`'s callback signature —
 * the same alias `leads.convert.ts` uses.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Lowest position in a column. Named because it is the lower clamp bound, not
// an incidental zero: a client asking for a negative index lands first, never
// off the front of the list.
const FIRST_POSITION = 0

/**
 * Everything the renumberer needs to know about one placement table.
 *
 * Exactly two instances exist — orders and pickups — and they can never be
 * crossed (CONSTRAINT-25). Each names its own table and its own columns, so a
 * renumber driven by the order config cannot read or write a pickup row, and
 * the two lists sharing a day never renumber each other.
 */
export interface PlacementTable {
  /** Table name, used only in failure messages. Never interpolated into SQL. */
  readonly label: string
  readonly table: PgTable
  readonly idColumn: PgColumn
  /** The day a card sits in — `production_date` or `pickup_date`. */
  readonly dateColumn: PgColumn
  /** Intra-day position — `production_sort_index` or `sort_index`. */
  readonly sortIndexColumn: PgColumn
  /**
   * Final ordering key, matching the read query's last `ORDER BY` term —
   * `po_number` for orders, `created_at` for pickups. It decides the order an
   * all-`NULL` column renumbers into, so it must stay identical to the query's
   * or the first placement of the day would visibly reshuffle the column.
   */
  readonly tiebreakColumn: PgColumn
  /**
   * Stamped on the row the user actually moved. Renumbered siblings are left
   * alone: their data did not change, their neighbour moved, and bumping ten
   * timestamps because one card was dragged would make `updated_at` useless.
   */
  readonly updatedAtColumn: PgColumn
}

/**
 * Drizzle's `.set()` is keyed by TypeScript property name, which is not
 * guaranteed to equal the database column name a `PgColumn` carries. Resolving
 * the key from the table keeps the config to plain column references and fails
 * loudly rather than writing a silently-dropped key.
 */
function updateKey(config: PlacementTable, column: PgColumn): string {
  const entry = Object.entries(getTableColumns(config.table)).find(
    ([, candidate]) => candidate === column,
  )
  if (!entry) {
    throw new Error(
      `placement.renumber: column "${column.name}" does not belong to ${config.label}`,
    )
  }
  return entry[0]
}

/**
 * Ids on `dateKey`, ordered by exactly the expression the calendar read query
 * uses. Postgres already sorts `NULL`s last on an `ASC` ordering, which is what
 * the query spells out as `ASC NULLS LAST` — so a column that has never been
 * renumbered comes back in the order the salesperson is looking at right now,
 * and renumbering it is invisible to them.
 */
async function readColumn(
  tx: Tx,
  config: PlacementTable,
  dateKey: string,
): Promise<string[]> {
  const rows = await tx
    .select({ id: config.idColumn })
    .from(config.table)
    .where(eq(config.dateColumn, dateKey))
    .orderBy(asc(config.sortIndexColumn), asc(config.tiebreakColumn))

  return rows.map((row) => String(row.id))
}

/** The day one row currently sits in, or null when it is unplaced or unknown. */
async function readDateKey(
  tx: Tx,
  config: PlacementTable,
  id: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ dateKey: config.dateColumn })
    .from(config.table)
    .where(eq(config.idColumn, id))
    .limit(1)

  return row?.dateKey == null ? null : String(row.dateKey)
}

/** Writes `ids` back as a dense `0..n-1` sequence, in the order given. */
async function writeSequence(
  tx: Tx,
  config: PlacementTable,
  ids: readonly string[],
): Promise<void> {
  const sortIndexKey = updateKey(config, config.sortIndexColumn)

  for (const [position, id] of ids.entries()) {
    // Sequential rather than `Promise.all`: these statements share one
    // transaction, and a pooled connection runs one statement at a time.
    await tx
      .update(config.table)
      .set({ [sortIndexKey]: position })
      .where(eq(config.idColumn, id))
  }
}

/** Moves one row onto `dateKey` — or off the calendar when null — and stamps it. */
async function writePlacement(
  tx: Tx,
  config: PlacementTable,
  id: string,
  dateKey: string | null,
): Promise<void> {
  await tx
    .update(config.table)
    .set({
      [updateKey(config, config.dateColumn)]: dateKey,
      // Cleared rather than kept: `writeSequence` assigns the real index below,
      // and a stale index here would order the row against its new siblings.
      [updateKey(config, config.sortIndexColumn)]: null,
      [updateKey(config, config.updatedAtColumn)]: new Date(),
    })
    .where(eq(config.idColumn, id))
}

/**
 * Rewrites every row sharing `dateKey` to a dense `0..n-1` sequence, preserving
 * the order the calendar currently displays them in.
 *
 * @param tx Open transaction — never call this outside one, or a failure
 * halfway through leaves the column half-renumbered.
 * @param config The table being renumbered. Orders and pickups never share one.
 * @param dateKey Day column to renumber, `yyyy-MM-dd`.
 * @throws Uncaught, deliberately. `updateKey` throws when `config` names a
 * column its own table does not own, and driver errors propagate as-is —
 * throwing is what rolls the caller's transaction back and reaches its
 * `console.error` + `GENERIC_FAILURE_MESSAGE` handler. Swallowing either here
 * would leave the column half-renumbered and the action reporting success.
 */
export async function renumberColumn(
  tx: Tx,
  config: PlacementTable,
  dateKey: string,
): Promise<void> {
  await writeSequence(tx, config, await readColumn(tx, config, dateKey))
}

/**
 * Moves one row to `dateKey`, splices it in at `sortIndex`, and renumbers every
 * column the move touched.
 *
 * `sortIndex` is a *post-removal* insertion index — the position in the
 * destination list with the moved card already lifted out, which is what both
 * the drag path (`calendarDnd.resolveDropTarget`) and the touch path
 * (`armPlacement.resolveTapAction`) send. It is clamped to `[0, siblings]`, so a
 * stale client index lands the card at whichever end it overshot instead of
 * failing the write.
 *
 * On a cross-day move the origin column is renumbered too, closing the gap the
 * card left behind.
 *
 * @param tx Open transaction — the move and both renumbers must land together.
 * @param config The table being written. Orders and pickups never share one.
 * @param id Row to move. Its existence and its right to move are the caller's
 * guards, not this helper's.
 * @param dateKey Destination day, `yyyy-MM-dd`.
 * @param sortIndex Desired post-removal position in the destination column.
 * @throws Same contract as {@link renumberColumn} — a mis-wired `config` throws
 * from `updateKey`, any driver error propagates, and neither is caught, so a
 * failure between the placement write and either renumber rolls `tx` back
 * whole rather than leaving the card moved but the columns unsequenced. A
 * clamped `sortIndex` is not an error: too high lands the card last, negative
 * lands it first.
 */
export async function placeAndRenumber(
  tx: Tx,
  config: PlacementTable,
  id: string,
  dateKey: string,
  sortIndex: number,
): Promise<void> {
  const originDateKey = await readDateKey(tx, config, id)

  await writePlacement(tx, config, id, dateKey)

  const siblings = (await readColumn(tx, config, dateKey)).filter((row) => row !== id)
  const position = Math.min(Math.max(sortIndex, FIRST_POSITION), siblings.length)
  siblings.splice(position, 0, id)
  await writeSequence(tx, config, siblings)

  if (originDateKey !== null && originDateKey !== dateKey) {
    await renumberColumn(tx, config, originDateKey)
  }
}

/**
 * Takes one row off the calendar — nulling its day and its index — then closes
 * the gap by renumbering the column it left.
 *
 * @param tx Open transaction — the clear and the renumber must land together.
 * @param config The table being written. Orders and pickups never share one.
 * @param id Row to unplace. Already-unplaced rows are a no-op renumber.
 * @throws Same contract as {@link renumberColumn} — a mis-wired `config` throws
 * from `updateKey`, any driver error propagates, and neither is caught, so the
 * clear can never land without the renumber that closes the gap behind it; `tx`
 * takes both back and the caller returns `GENERIC_FAILURE_MESSAGE`.
 */
export async function clearAndRenumber(
  tx: Tx,
  config: PlacementTable,
  id: string,
): Promise<void> {
  const originDateKey = await readDateKey(tx, config, id)

  await writePlacement(tx, config, id, null)

  if (originDateKey !== null) {
    await renumberColumn(tx, config, originDateKey)
  }
}
