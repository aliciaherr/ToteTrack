import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { DatabaseError, InvalidDateError } from '@/lib/errors'
import { parseDbDate } from '@/lib/dates'
import type { PoStatus } from './orders'
import { CALENDAR_WEEKS_BUFFER, UNSCHEDULED_DROPDOWN_VISIBLE } from './calendar.constants'

export { CALENDAR_WEEKS_BUFFER, UNSCHEDULED_DROPDOWN_VISIBLE }

export interface CalendarOrderRow {
  id: string
  po_number: string
  customer_id: string
  customer_name: string | null
  status: PoStatus
  qty_275_recon: number
  qty_275_rebot: number
  qty_275_new: number
  qty_330_recon: number
  qty_330_rebot: number
  qty_330_new: number
  price: string
  // Per-combo unit prices (Feature 10). numeric(10,2) rendered as text, null
  // where the combo was never priced. The card popup renders `qty / $unit`
  // cells from these; cards themselves never show prices (CONSTRAINT-19).
  unit_price_275_recon: string | null
  unit_price_275_rebot: string | null
  unit_price_275_new: string | null
  unit_price_330_recon: string | null
  unit_price_330_rebot: string | null
  unit_price_330_new: string | null
  backhaul: boolean
  // Fetched for the card popup only — cards themselves never show notes. Added
  // in Feature 11 Task 58; it is the one long-text column on the row, so if the
  // calendar payload ever needs trimming this is the first thing to move behind
  // a per-order fetch.
  notes: string | null
  same_day_delivery: boolean
  production_date: string | null
  requested_delivery_date: string | null
  production_sort_index: number | null
}

export interface CalendarRange {
  from: string
  to: string
}

// Shared projection for both calendar queries so a card rendered from the
// unscheduled dropdown and the same card rendered in a day column carry
// identical fields. `numeric` columns are cast to text to match how `price` is
// typed everywhere else in this project.
const CALENDAR_SELECT_LIST = sql`
  o.id,
  o.po_number,
  o.customer_id,
  c.company_name AS customer_name,
  o.status,
  o.qty_275_recon,
  o.qty_275_rebot,
  o.qty_275_new,
  o.qty_330_recon,
  o.qty_330_rebot,
  o.qty_330_new,
  o.price::text AS price,
  o.unit_price_275_recon::text AS unit_price_275_recon,
  o.unit_price_275_rebot::text AS unit_price_275_rebot,
  o.unit_price_275_new::text AS unit_price_275_new,
  o.unit_price_330_recon::text AS unit_price_330_recon,
  o.unit_price_330_rebot::text AS unit_price_330_rebot,
  o.unit_price_330_new::text AS unit_price_330_new,
  o.backhaul,
  o.notes,
  o.same_day_delivery,
  o.production_date,
  o.requested_delivery_date,
  o.production_sort_index
`

// `cancelled` is the only status the calendar hides. `completed` and
// `invoiced` stay visible (rendered dimmed and non-draggable) so a finished
// build does not vanish from the week it happened in.
const NOT_CANCELLED = sql`o.status <> 'cancelled'`

function buildCalendarRangeQuery(from: string, to: string): SQL {
  return sql`
    SELECT
      ${CALENDAR_SELECT_LIST}
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE ${NOT_CANCELLED}
      AND o.production_date >= ${from}
      AND o.production_date <= ${to}
    ORDER BY
      o.production_date ASC,
      o.production_sort_index ASC NULLS LAST,
      o.po_number ASC
  `
}

function buildUnscheduledQuery(): SQL {
  return sql`
    SELECT
      ${CALENDAR_SELECT_LIST}
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE ${NOT_CANCELLED}
      AND o.production_date IS NULL
    ORDER BY o.po_number ASC
  `
}

/**
 * Loads every non-cancelled order whose `production_date` falls inside
 * `[from, to]`, ordered by column, then intra-day sequence, then PO number.
 *
 * A card's column **is** its `production_date` — there is no derivation. An
 * order with no production date is unscheduled and belongs to
 * `getUnscheduledOrders`, whatever its delivery date says. Between the two, no
 * active order can be invisible.
 *
 * The filter is a bare column comparison rather than an expression, so
 * `orders_production_date_idx` can actually serve it. The previous
 * `COALESCE(...)` form was not sargable and forced a sequential scan (FI-02).
 *
 * @throws {InvalidDateError} when `from` or `to` is not a `DB_DATE_FORMAT`
 * string, or when the range is inverted — either would silently return an
 * empty week rather than failing.
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getCalendarOrders(input: CalendarRange): Promise<CalendarOrderRow[]> {
  const from = parseDbDate('getCalendarOrders', input.from)
  const to = parseDbDate('getCalendarOrders', input.to)
  if (from > to) {
    throw new InvalidDateError(
      'getCalendarOrders',
      `${input.from}..${input.to}`,
      'range start is after range end',
    )
  }

  try {
    const result = await db.execute(buildCalendarRangeQuery(input.from, input.to))
    return result as unknown as CalendarOrderRow[]
  } catch (cause) {
    console.error('getCalendarOrders: query failed', {
      operation: 'getCalendarOrders',
      range: { from: input.from, to: input.to },
      cause,
    })
    throw new DatabaseError('getCalendarOrders', 'Failed to load calendar orders', { cause })
  }
}

/**
 * Loads every non-cancelled order with no `production_date`, ordered by PO
 * number — regardless of whether it has a requested delivery date.
 *
 * This is the exact complement of `getCalendarOrders`' filter: an active order
 * is in one set or the other, never both and never neither. It drives the
 * top-right unscheduled callout, its dropdown, and every per-day `+` list.
 *
 * A delivery date does not put an order on the calendar. Production scheduling
 * is its own decision, so an order sits here until someone gives it a build day
 * — which is what makes `clearProductionPlacement` genuinely unschedule rather
 * than bounce a card to a derived day (CONSTRAINT-19).
 *
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getUnscheduledOrders(): Promise<CalendarOrderRow[]> {
  try {
    const result = await db.execute(buildUnscheduledQuery())
    return result as unknown as CalendarOrderRow[]
  } catch (cause) {
    console.error('getUnscheduledOrders: query failed', {
      operation: 'getUnscheduledOrders',
      cause,
    })
    throw new DatabaseError('getUnscheduledOrders', 'Failed to load unscheduled orders', { cause })
  }
}
