import { sql, type SQL } from 'drizzle-orm'
import { db } from '@/db'
import { DatabaseError, OrderNotFoundError } from '@/lib/errors'

export type PoStatus = 'scheduled' | 'completed' | 'cancelled' | 'invoiced'

// Status filter for the orders list — 'all' means no status restriction.
export type OrderListStatus = PoStatus | 'all'

export interface GetOrdersFilters {
  status?: OrderListStatus
  search?: string
}

export interface OrderTableRow {
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
  requested_delivery_date: string | null
  backhaul: boolean
}

export interface OrderDetail {
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
  // Per-combo unit prices (Feature 10). numeric(10,2) rendered as text (or
  // null where the combo's qty is 0), matching how `price` is typed. Consumed
  // by the PO detail view to show `qty / $unit` per filled cell.
  unit_price_275_recon: string | null
  unit_price_275_rebot: string | null
  unit_price_275_new: string | null
  unit_price_330_recon: string | null
  unit_price_330_rebot: string | null
  unit_price_330_new: string | null
  pickup_only: boolean
  delivery_address: string | null
  requested_delivery_date: string | null
  backhaul: boolean
  document_url: string | null
  notes: string | null
}

export interface GetOrdersResult {
  rows: OrderTableRow[]
}

// `scheduled` orders are "active" (sorted ASC by req date — earliest delivery
// first); the rest are "historical" (sorted DESC — most recent first). One
// bucket column + two per-bucket sort expressions encode the two-stage order
// in a single ORDER BY.
const ORDER_CLAUSE = sql`
  ORDER BY
    CASE WHEN o.status = 'scheduled' THEN 0 ELSE 1 END ASC,
    CASE WHEN o.status = 'scheduled' THEN o.requested_delivery_date END ASC NULLS LAST,
    CASE WHEN o.status <> 'scheduled' THEN o.requested_delivery_date END DESC NULLS LAST
`

// `'completed'` matches both `completed` and `invoiced` rows. In the v2 PO
// model, `invoiced` is a sub-state of completed (a delivered order that has
// also been billed) — the salesperson sees them as one bucket. The Invoices
// screen is the right place to look at billing-specific state.
//
// Emitted as `AND ...` — the base query carries an always-true WHERE so the
// status and search clauses can each append or omit themselves independently.
function buildStatusClause(status: OrderListStatus): SQL {
  if (status === 'all') return sql``
  if (status === 'completed') return sql`AND o.status IN ('completed', 'invoiced')`
  return sql`AND o.status = ${status}`
}

// Search clause: case-insensitive contains on PO number or customer company
// name. Skipped when there is no search term so the base query has no
// unnecessary WHERE branch.
function buildSearchClause(search: string | undefined): SQL {
  const term = search?.trim()
  if (!term) return sql``
  const pattern = `%${term}%`
  return sql`AND (o.po_number ILIKE ${pattern} OR c.company_name ILIKE ${pattern})`
}

function buildOrdersQuery(status: OrderListStatus, search: string | undefined): SQL {
  return sql`
    SELECT
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
      o.requested_delivery_date,
      o.backhaul
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE TRUE
    ${buildStatusClause(status)}
    ${buildSearchClause(search)}
    ${ORDER_CLAUSE}
  `
}

/**
 * Loads every order matching the active filter for the orders table, sorted so
 * that scheduled/pending orders appear first (ASC by requested_delivery_date)
 * and completed/cancelled/invoiced orders appear after (DESC by the same
 * column). The list is unbounded — the table scrolls rather than paginates.
 *
 * `search` is an optional case-insensitive contains match on PO number or
 * customer company name; an empty or whitespace-only term is ignored.
 *
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getOrders(filters: GetOrdersFilters = {}): Promise<GetOrdersResult> {
  const status = filters.status ?? 'all'
  const search = filters.search

  try {
    const rowsResult = await db.execute(buildOrdersQuery(status, search))
    return { rows: rowsResult as unknown as OrderTableRow[] }
  } catch (cause) {
    console.error('getOrders: query failed', {
      operation: 'getOrders',
      filters: { status, search },
      cause,
    })
    throw new DatabaseError('getOrders', 'Failed to load orders', { cause })
  }
}

// Detail-query body. Joins `customers` onto `orders` so the panel can render
// the company name alongside a link back to the customer detail view. Single
// row expected — the caller enforces not-found as an application-level error
// via `OrderNotFoundError`.
function buildOrderDetailQuery(orderId: string): SQL {
  return sql`
    SELECT
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
      o.pickup_only,
      o.delivery_address,
      o.requested_delivery_date,
      o.backhaul,
      o.document_url,
      o.notes
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ${orderId}
    LIMIT 1
  `
}

/**
 * Loads a single order with the joined customer company name for the order
 * detail panel. Returns every field the detail view needs — including the
 * optional delivery address, notes, and the current PO document path — so
 * the component can render conditionally without a second round-trip.
 *
 * @throws {OrderNotFoundError} when no row matches `orderId`.
 * @throws {DatabaseError} when the underlying SQL query fails.
 */
export async function getOrderDetail(orderId: string): Promise<OrderDetail> {
  try {
    const result = await db.execute(buildOrderDetailQuery(orderId))
    const row = (result as unknown as OrderDetail[])[0]
    if (!row) throw new OrderNotFoundError(orderId)
    return row
  } catch (cause) {
    if (cause instanceof OrderNotFoundError) throw cause
    console.error('getOrderDetail: query failed', {
      operation: 'getOrderDetail',
      orderId,
      cause,
    })
    throw new DatabaseError('getOrderDetail', 'Failed to load order detail', { cause })
  }
}
