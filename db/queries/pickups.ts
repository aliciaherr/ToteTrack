import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { computeWindowStartDate, type CustomerOrdersWindow } from '@/db/queries/customers'
import { DatabaseError, PickupNotFoundError } from '@/lib/errors'

export type PickupStatus = 'scheduled' | 'completed' | 'cancelled'

/**
 * Time window for the Pickup History panel on the customer detail view. The
 * same five options Order History offers, sharing one definition so the two
 * panels can never drift apart on what "3M" means. Only the URL param differs
 * (`?pwindow=` here, `?window=` there) so the two tab groups stay independent.
 */
export type CustomerPickupsWindow = CustomerOrdersWindow

// Status filter for the pickups list — 'all' means no status restriction.
export type PickupListStatus = PickupStatus | 'all'

export interface GetPickupsFilters {
  status?: PickupListStatus
  search?: string
}

export interface PickupTableRow {
  id: string
  customer_id: string
  customer_name: string | null
  status: PickupStatus
  qty_275: number
  qty_330: number
  pickup_date: string | null
}

export interface PickupDetail extends PickupTableRow {
  address: string | null
  notes: string | null
}

export interface GetPickupsResult {
  rows: PickupTableRow[]
}

/**
 * One row of the Pickup History panel on the customer detail view. Narrower
 * than `PickupTableRow` — the customer is already the subject of the panel, so
 * neither the id nor the name is projected.
 */
export interface CustomerPickupRow {
  id: string
  status: PickupStatus
  qty_275: number
  qty_330: number
  pickup_date: string | null
}

// Same two-stage shape as `ORDER_CLAUSE` in `db/queries/orders.ts`: `scheduled`
// pickups are "active" (sorted ASC by pickup_date — the next collection
// first); completed and cancelled ones are "historical" (DESC — most recent
// first). One bucket column plus two per-bucket sort expressions encode both
// stages in a single ORDER BY. Undated pickups sort last inside their bucket.
const PICKUP_ORDER_CLAUSE = sql`
  ORDER BY
    CASE WHEN p.status = 'scheduled' THEN 0 ELSE 1 END ASC,
    CASE WHEN p.status = 'scheduled' THEN p.pickup_date END ASC NULLS LAST,
    CASE WHEN p.status <> 'scheduled' THEN p.pickup_date END DESC NULLS LAST
`

// Emitted as `AND ...` — the base query carries an always-true WHERE so the
// status and search clauses can each append or omit themselves independently.
// Unlike orders there is no `invoiced` sub-state to fold in: a pickup is never
// billed, so `completed` means exactly `completed`.
function buildStatusClause(status: PickupListStatus): SQL {
  if (status === 'all') return sql``
  return sql`AND p.status = ${status}`
}

// Search clause: case-insensitive contains on the customer company name only.
// A pickup has no PO number or reference of its own to match against. Skipped
// when there is no search term so the base query has no unnecessary branch.
function buildSearchClause(search: string | undefined): SQL {
  const term = search?.trim()
  if (!term) return sql``
  return sql`AND c.company_name ILIKE ${`%${term}%`}`
}

function buildPickupsQuery(status: PickupListStatus, search: string | undefined): SQL {
  return sql`
    SELECT
      p.id,
      p.customer_id,
      c.company_name AS customer_name,
      p.status,
      p.qty_275,
      p.qty_330,
      p.pickup_date
    FROM pickups p
    LEFT JOIN customers c ON c.id = p.customer_id
    WHERE TRUE
    ${buildStatusClause(status)}
    ${buildSearchClause(search)}
    ${PICKUP_ORDER_CLAUSE}
  `
}

/**
 * Loads every pickup matching the active filter for the pickups table, sorted
 * so scheduled pickups appear first (ASC by `pickup_date` — the next
 * collection first) and completed/cancelled ones after (DESC by the same
 * column). The list is unbounded — the table scrolls rather than paginates.
 *
 * `search` is an optional case-insensitive contains match on the customer
 * company name; an empty or whitespace-only term is ignored.
 *
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getPickups(filters: GetPickupsFilters = {}): Promise<GetPickupsResult> {
  const status = filters.status ?? 'all'
  const search = filters.search

  try {
    const rowsResult = await db.execute(buildPickupsQuery(status, search))
    return { rows: rowsResult as unknown as PickupTableRow[] }
  } catch (cause) {
    console.error('getPickups: query failed', {
      operation: 'getPickups',
      filters: { status, search },
      cause,
    })
    throw new DatabaseError('getPickups', 'Failed to load pickups', { cause })
  }
}

// Detail-query body. Joins `customers` onto `pickups` so the panel can render
// the company name alongside a link back to the customer detail view. Single
// row expected — the caller enforces not-found as an application-level error
// via `PickupNotFoundError`.
function buildPickupDetailQuery(pickupId: string): SQL {
  return sql`
    SELECT
      p.id,
      p.customer_id,
      c.company_name AS customer_name,
      p.status,
      p.qty_275,
      p.qty_330,
      p.pickup_date,
      p.address,
      p.notes
    FROM pickups p
    LEFT JOIN customers c ON c.id = p.customer_id
    WHERE p.id = ${pickupId}
    LIMIT 1
  `
}

/**
 * Loads a single pickup with the joined customer company name for the pickup
 * detail panel. Returns every field the detail view needs — including the
 * optional address snapshot and notes — so the component renders without a
 * second round-trip.
 *
 * @throws {PickupNotFoundError} when no row matches `pickupId`.
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getPickupDetail(pickupId: string): Promise<PickupDetail> {
  try {
    const result = await db.execute(buildPickupDetailQuery(pickupId))
    const row = (result as unknown as PickupDetail[])[0]
    if (!row) throw new PickupNotFoundError(pickupId)
    return row
  } catch (cause) {
    if (cause instanceof PickupNotFoundError) throw cause
    console.error('getPickupDetail: query failed', {
      operation: 'getPickupDetail',
      pickupId,
      cause,
    })
    throw new DatabaseError('getPickupDetail', 'Failed to load pickup detail', { cause })
  }
}

// Customer-history projection. Deliberately the same shape as
// `customerOrdersQuery` in `db/queries/customers.sql.ts`: one customer, one
// lower-bound date, newest first. `pickup_date >= startDate` also excludes
// undated (unscheduled) pickups, exactly as the orders query excludes orders
// with no requested delivery date — a history panel lists what has a date on
// it. Unscheduled pickups surface on the Pickups tab and, from Task 80, in the
// calendar's unscheduled callout.
function buildCustomerPickupsQuery(customerId: string, startDate: string): SQL {
  return sql`
    SELECT
      p.id,
      p.status,
      p.qty_275,
      p.qty_330,
      p.pickup_date
    FROM pickups p
    WHERE p.customer_id = ${customerId}
      AND p.pickup_date >= ${startDate}
    ORDER BY p.pickup_date DESC NULLS LAST
  `
}

/**
 * Loads pickups for a single customer, filtered to a time window relative to
 * today, for the Pickup History panel. Sorted by `pickup_date` DESC. Returns
 * `[]` when the customer has no dated pickups inside the window.
 *
 * Every status is included — a cancelled pickup is still history, and the row
 * carries its own status badge, mirroring `getCustomerOrders`.
 *
 * @param customerId The customer whose pickups to load.
 * @param window Time window; resolved to a lower-bound date against today.
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getCustomerPickups(
  customerId: string,
  window: CustomerPickupsWindow,
): Promise<CustomerPickupRow[]> {
  const startDate = computeWindowStartDate(window, new Date())
  try {
    const result = await db.execute(buildCustomerPickupsQuery(customerId, startDate))
    return result as unknown as CustomerPickupRow[]
  } catch (cause) {
    console.error('getCustomerPickups: query failed', {
      operation: 'getCustomerPickups',
      customerId,
      window,
      cause,
    })
    throw new DatabaseError('getCustomerPickups', 'Failed to load customer pickups', { cause })
  }
}
