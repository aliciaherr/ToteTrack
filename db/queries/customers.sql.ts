import { sql } from 'drizzle-orm'
import {
  ORDER_STATS_CTE,
  AUTO_FREQ_CTE,
  customerOrderStatsCte,
  customerAutoFreqCte,
  OVERDUE_DAYS_SELECT_CASE,
} from './customer-overdue.sql'

// Raw SQL constants for the customers query module. Extracted so
// `customers.ts` stays under the 300-line service-file cap (CQ-02).
// The overdue-customer rule (order_stats / auto_freq / overdue_days) lives in
// `customer-overdue.sql.ts` and is composed here (CQ-07).
// Drizzle's `sql` template parameterizes all interpolated values — no string
// concatenation crosses the boundary, so these fragments are safe from
// injection (SEC-02).

/**
 * List-query body. Joins three CTEs onto `customers`:
 *  - `order_stats`: completed-order count + last completed date per customer
 *  - `auto_freq`: average days between consecutive completed orders
 *  - `primary_contact`: one contact per customer (is_primary DESC, created_at ASC)
 *
 * The caller appends WHERE + ORDER BY. Kept as a template fragment rather
 * than a function so the query planner can cache identical shapes across
 * requests.
 */
export const CUSTOMER_LIST_QUERY_BODY = sql`
  WITH ${ORDER_STATS_CTE},
  ${AUTO_FREQ_CTE},
  primary_contact AS (
    SELECT DISTINCT ON (customer_id)
      customer_id,
      name,
      role
    FROM customer_contacts
    ORDER BY customer_id, is_primary DESC, created_at ASC
  )
  SELECT
    c.id,
    c.company_name,
    c.status,
    pc.name AS primary_contact_name,
    pc.role AS primary_contact_role,
    os.last_completed_date,
    COALESCE(os.completed_order_count, 0)::int AS completed_order_count,
    ${OVERDUE_DAYS_SELECT_CASE}
  FROM customers c
  LEFT JOIN order_stats os ON os.customer_id = c.id
  LEFT JOIN auto_freq af ON af.customer_id = c.id
  LEFT JOIN primary_contact pc ON pc.customer_id = c.id
`

/**
 * Detail-query body. Same stats shape as the list query but scoped to one
 * customer so the CTEs don't have to partition across the whole table.
 */
export const customerDetailQuery = (customerId: string) => sql`
  WITH ${customerOrderStatsCte(customerId)},
  ${customerAutoFreqCte(customerId)}
  SELECT
    c.id,
    c.company_name,
    c.status,
    c.contact_frequency_days,
    c.notes,
    COALESCE(os.completed_order_count, 0)::int AS completed_order_count,
    os.last_completed_date,
    CEIL(af.avg_freq_days)::int AS auto_calculated_frequency_days,
    ${OVERDUE_DAYS_SELECT_CASE}
  FROM customers c
  CROSS JOIN order_stats os
  CROSS JOIN auto_freq af
  WHERE c.id = ${customerId}
  LIMIT 1
`

/** Contacts for a single customer, primary-first then oldest-created. */
export const customerContactsQuery = (customerId: string) => sql`
  SELECT id, name, role, email, phone, is_primary
  FROM customer_contacts
  WHERE customer_id = ${customerId}
  ORDER BY is_primary DESC, created_at ASC
`

/**
 * Saved delivery addresses for a single customer, most-recently-used first
 * (`last_used_at DESC NULLS LAST`, ties broken newest-created first) — the
 * same MRU ordering the order form's address picker uses in
 * `getActiveCustomersForSelect`.
 */
export const customerAddressesQuery = (customerId: string) => sql`
  SELECT id, address
  FROM customer_addresses
  WHERE customer_id = ${customerId}
  ORDER BY last_used_at DESC NULLS LAST, created_at DESC
`

/**
 * Per-combo average order quantity for a single customer's completed/invoiced
 * orders. Returns ONE row with 6 average columns — one per (size × type)
 * combo. Each AVG uses a FILTER clause so the denominator is "POs that had a
 * non-zero quantity for this combo," not "all POs." Combos with no matching
 * POs return NULL, which the assembler treats as 0.
 */
export const customerVolumeAveragesQuery = (customerId: string) => sql`
  SELECT
    (AVG(qty_275_recon) FILTER (WHERE qty_275_recon > 0))::text AS avg_275_recon,
    (AVG(qty_275_rebot) FILTER (WHERE qty_275_rebot > 0))::text AS avg_275_rebot,
    (AVG(qty_275_new) FILTER (WHERE qty_275_new > 0))::text AS avg_275_new,
    (AVG(qty_330_recon) FILTER (WHERE qty_330_recon > 0))::text AS avg_330_recon,
    (AVG(qty_330_rebot) FILTER (WHERE qty_330_rebot > 0))::text AS avg_330_rebot,
    (AVG(qty_330_new) FILTER (WHERE qty_330_new > 0))::text AS avg_330_new
  FROM orders
  WHERE customer_id = ${customerId} AND status IN ('completed', 'invoiced')
`

/**
 * Orders for a single customer within a time window. The caller is
 * responsible for computing `startDate` via `computeWindowStartDate`.
 */
export const customerOrdersQuery = (customerId: string, startDate: string) => sql`
  SELECT
    id,
    po_number,
    status,
    qty_275_recon,
    qty_275_rebot,
    qty_275_new,
    qty_330_recon,
    qty_330_rebot,
    qty_330_new,
    price::text AS price,
    requested_delivery_date,
    backhaul
  FROM orders
  WHERE customer_id = ${customerId}
    AND requested_delivery_date >= ${startDate}
  ORDER BY requested_delivery_date DESC NULLS LAST
`
