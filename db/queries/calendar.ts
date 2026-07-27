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
  same_day_delivery: boolean
  production_date: string | null
  requested_delivery_date: string | null
  production_sort_index: number | null
  // The resolved calendar column, computed by EFFECTIVE_PRODUCTION_DATE below.
  // Returned rather than recomputed client-side so the column a card filters
  // into and the column it renders into can never disagree. Null only on the
  // unscheduled rows returned by `getUnscheduledOrders`.
  effective_production_date: string | null
}

export interface CalendarRange {
  from: string
  to: string
}

/**
 * The COALESCE rule from CONSTRAINT-19, in SQL. Must stay behaviourally
 * identical to `effectiveProductionDate` in `lib/dates.ts` — that helper is the
 * client-side twin of this expression, and the two disagreeing would place a
 * card in one column and filter it into another.
 *
 * An explicit `production_date` wins. Otherwise the card falls back to the
 * business day before the requested delivery date, using ISO day-of-week
 * (1 = Monday … 7 = Sunday):
 *   - Monday (1) → minus 3 days → the prior Friday
 *   - Sunday (7) → minus 2 days → the prior Friday
 *   - every other day → minus 1 day, which is always a weekday
 * Weekends only; there is no holiday calendar and none is planned.
 *
 * `date - integer` yields a date in Postgres (an INTERVAL would widen it to a
 * timestamp). When both columns are NULL the whole expression is NULL, so
 * unscheduled orders fall out of any range comparison — which is what makes
 * them exclusively `getUnscheduledOrders`' business.
 */
const EFFECTIVE_PRODUCTION_DATE = sql`
  COALESCE(
    o.production_date,
    CASE EXTRACT(ISODOW FROM o.requested_delivery_date)::int
      WHEN 1 THEN o.requested_delivery_date - 3
      WHEN 7 THEN o.requested_delivery_date - 2
      ELSE o.requested_delivery_date - 1
    END
  )
`

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
  o.same_day_delivery,
  o.production_date,
  o.requested_delivery_date,
  o.production_sort_index,
  ${EFFECTIVE_PRODUCTION_DATE}::text AS effective_production_date
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
      AND ${EFFECTIVE_PRODUCTION_DATE} >= ${from}
      AND ${EFFECTIVE_PRODUCTION_DATE} <= ${to}
    ORDER BY
      ${EFFECTIVE_PRODUCTION_DATE} ASC,
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
      AND o.requested_delivery_date IS NULL
    ORDER BY o.po_number ASC
  `
}

/**
 * Loads every non-cancelled order whose effective production date falls inside
 * `[from, to]`, ordered by column, then intra-day sequence, then PO number.
 *
 * Orders with no production date and no requested delivery date have a NULL
 * effective date and are therefore never returned here — they belong to
 * `getUnscheduledOrders`. Between the two, no active order can be invisible.
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
 * Loads every non-cancelled order that has neither a production date nor a
 * requested delivery date, ordered by PO number.
 *
 * This is the exact complement of `getCalendarOrders`' date filter: an active
 * order is in one set or the other, never both and never neither. It drives the
 * top-right unscheduled callout, its dropdown, and every per-day `+` list.
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
