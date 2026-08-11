import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { DatabaseError, InvalidDateError } from '@/lib/errors'
import { parseDbDate } from '@/lib/dates'
import type { CalendarContact, CalendarRange } from './calendar'
import type { PickupStatus } from './pickups'

// The calendar's pickup reader. A deliberate sibling of `calendar.ts` rather
// than more of `pickups.ts`: the calendar needs the embedded contacts
// aggregate and the day-column ordering, and the Pickups tab needs neither
// (CONSTRAINT-25 — pickups are a separate entity, and the calendar hosts two
// independent lists over two independent queries).

export interface CalendarPickupRow {
  id: string
  customer_id: string
  customer_name: string | null
  status: PickupStatus
  qty_275: number
  qty_330: number
  pickup_date: string | null
  sort_index: number | null
  // Fetched for the card popup only — cards themselves show neither, the same
  // rule the order card follows for its notes.
  address: string | null
  notes: string | null
  // Embedded on the row for the popup's Contact menu, exactly as
  // `CalendarOrderRow.contacts` is: this app has no client-side data-fetching
  // pattern, so a per-popup fetch would be the first one in the codebase.
  contacts: CalendarContact[]
}

// Shared projection for both queries so a pickup rendered in the unscheduled
// callout and the same pickup rendered in a day column carry identical fields.
// Mirrors `CALENDAR_SELECT_LIST` in `calendar.ts`, including the contacts
// aggregate — a pickup's Contact menu must offer the same people the order
// popup does, and one shared shape is what stops the two drifting.
const PICKUP_CALENDAR_SELECT_LIST = sql`
  p.id,
  p.customer_id,
  c.company_name AS customer_name,
  p.status,
  p.qty_275,
  p.qty_330,
  p.pickup_date,
  p.sort_index,
  p.address,
  p.notes,
  COALESCE((
    SELECT json_agg(
             json_build_object('id', cc.id, 'name', cc.name, 'email', cc.email, 'phone', cc.phone)
             ORDER BY cc.is_primary DESC, cc.created_at ASC
           )
    FROM customer_contacts cc
    WHERE cc.customer_id = p.customer_id
  ), '[]'::json) AS contacts
`

// `cancelled` is the only status the calendar hides — a cancelled collection is
// off the board. `completed` stays visible (greyed and locked) so a collection
// that happened does not vanish from the week it happened in, matching how the
// order query treats `completed`/`invoiced`.
const NOT_CANCELLED = sql`p.status <> 'cancelled'`

// Intra-day sequence, then oldest-created as a stable final tiebreak. A pickup
// has no PO number to fall back on, and without a deterministic last key two
// pickups sharing a null `sort_index` could swap places between renders.
const PICKUP_COLUMN_ORDER = sql`
  ORDER BY
    p.pickup_date ASC,
    p.sort_index ASC NULLS LAST,
    p.created_at ASC
`

function buildPickupRangeQuery(from: string, to: string): SQL {
  return sql`
    SELECT
      ${PICKUP_CALENDAR_SELECT_LIST}
    FROM pickups p
    LEFT JOIN customers c ON c.id = p.customer_id
    WHERE ${NOT_CANCELLED}
      AND p.pickup_date >= ${from}
      AND p.pickup_date <= ${to}
    ${PICKUP_COLUMN_ORDER}
  `
}

function buildUnscheduledPickupsQuery(): SQL {
  return sql`
    SELECT
      ${PICKUP_CALENDAR_SELECT_LIST}
    FROM pickups p
    LEFT JOIN customers c ON c.id = p.customer_id
    WHERE ${NOT_CANCELLED}
      AND p.pickup_date IS NULL
    ORDER BY p.created_at ASC
  `
}

/**
 * Loads every non-cancelled pickup whose `pickup_date` falls inside
 * `[from, to]`, ordered by column, then intra-day sequence, then age.
 *
 * A pickup's column **is** its `pickup_date` (CONSTRAINT-25) — there is no
 * derivation and no second date to fall back on, unlike an order's delivery
 * promise. A pickup with no date is unscheduled and belongs to
 * `getUnscheduledPickups`. Between the two, no active pickup can be invisible.
 *
 * The filter is a bare column comparison so `pickups_pickup_date_idx` can
 * serve it, for the same reason `getCalendarOrders` avoids an expression.
 *
 * @param input Inclusive `yyyy-MM-dd` range, from `buildCalendarRange`.
 * @throws {InvalidDateError} when either bound is not a `DB_DATE_FORMAT`
 * string, or the range is inverted — either would silently return an empty
 * week rather than failing.
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getCalendarPickups(input: CalendarRange): Promise<CalendarPickupRow[]> {
  const from = parseDbDate('getCalendarPickups', input.from)
  const to = parseDbDate('getCalendarPickups', input.to)
  if (from > to) {
    throw new InvalidDateError(
      'getCalendarPickups',
      `${input.from}..${input.to}`,
      'range start is after range end',
    )
  }

  try {
    const result = await db.execute(buildPickupRangeQuery(input.from, input.to))
    return result as unknown as CalendarPickupRow[]
  } catch (cause) {
    console.error('getCalendarPickups: query failed', {
      operation: 'getCalendarPickups',
      range: { from: input.from, to: input.to },
      cause,
    })
    throw new DatabaseError('getCalendarPickups', 'Failed to load calendar pickups', { cause })
  }
}

/**
 * Loads every non-cancelled pickup with no `pickup_date`, oldest first — the
 * exact complement of `getCalendarPickups`' filter, so an active pickup is in
 * one set or the other, never both and never neither.
 *
 * Oldest-first rather than by name: an undated pickup is a collection nobody
 * has scheduled yet, and the one that has been waiting longest is the one to
 * deal with first.
 *
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getUnscheduledPickups(): Promise<CalendarPickupRow[]> {
  try {
    const result = await db.execute(buildUnscheduledPickupsQuery())
    return result as unknown as CalendarPickupRow[]
  } catch (cause) {
    console.error('getUnscheduledPickups: query failed', {
      operation: 'getUnscheduledPickups',
      cause,
    })
    throw new DatabaseError('getUnscheduledPickups', 'Failed to load unscheduled pickups', {
      cause,
    })
  }
}
