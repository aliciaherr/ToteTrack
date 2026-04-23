import { sql } from 'drizzle-orm'

// Raw SQL constants for the customers query module. Extracted so
// `customers.ts` stays under the 300-line service-file cap (CQ-02).
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
  WITH order_stats AS (
    SELECT
      o.customer_id,
      COUNT(*) FILTER (WHERE o.status IN ('completed', 'invoiced'))::int AS completed_order_count,
      MAX(o.requested_delivery_date) FILTER (WHERE o.status IN ('completed', 'invoiced')) AS last_completed_date
    FROM orders o
    GROUP BY o.customer_id
  ),
  auto_freq AS (
    SELECT
      customer_id,
      AVG(interval_days)::numeric AS avg_freq_days
    FROM (
      SELECT
        customer_id,
        requested_delivery_date - LAG(requested_delivery_date) OVER (
          PARTITION BY customer_id ORDER BY requested_delivery_date
        ) AS interval_days
      FROM orders
      WHERE status IN ('completed', 'invoiced')
    ) intervals
    WHERE interval_days IS NOT NULL
    GROUP BY customer_id
  ),
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
    CASE
      WHEN os.last_completed_date IS NULL THEN NULL
      WHEN COALESCE(c.contact_frequency_days::numeric, af.avg_freq_days) IS NULL THEN NULL
      ELSE (
        (CURRENT_DATE - os.last_completed_date)::int
        - CEIL(COALESCE(c.contact_frequency_days::numeric, af.avg_freq_days))::int
      )
    END AS overdue_days
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
  WITH order_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE status IN ('completed', 'invoiced'))::int AS completed_order_count,
      MAX(requested_delivery_date) FILTER (WHERE status IN ('completed', 'invoiced')) AS last_completed_date
    FROM orders
    WHERE customer_id = ${customerId}
  ),
  auto_freq AS (
    SELECT AVG(interval_days)::numeric AS avg_freq_days
    FROM (
      SELECT
        requested_delivery_date - LAG(requested_delivery_date) OVER (
          ORDER BY requested_delivery_date
        ) AS interval_days
      FROM orders
      WHERE status IN ('completed', 'invoiced') AND customer_id = ${customerId}
    ) intervals
    WHERE interval_days IS NOT NULL
  )
  SELECT
    c.id,
    c.company_name,
    c.status,
    c.contact_frequency_days,
    c.default_delivery_address,
    c.notes,
    COALESCE(os.completed_order_count, 0)::int AS completed_order_count,
    os.last_completed_date,
    CEIL(af.avg_freq_days)::int AS auto_calculated_frequency_days,
    CASE
      WHEN os.last_completed_date IS NULL THEN NULL
      WHEN COALESCE(c.contact_frequency_days::numeric, af.avg_freq_days) IS NULL THEN NULL
      ELSE (
        (CURRENT_DATE - os.last_completed_date)::int
        - CEIL(COALESCE(c.contact_frequency_days::numeric, af.avg_freq_days))::int
      )
    END AS overdue_days
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
 * Per-(size, type) average order quantity for a single customer's completed
 * orders. One row per (container_size, container_type) combination that has
 * at least one matching completed order. The caller fills in missing
 * combinations with zeroes. Scope is narrow enough that a single GROUP BY
 * aggregate is the entire query.
 */
export const customerVolumeAveragesQuery = (customerId: string) => sql`
  SELECT
    container_size,
    container_type,
    AVG(quantity)::numeric AS avg_quantity
  FROM orders
  WHERE customer_id = ${customerId} AND status IN ('completed', 'invoiced')
  GROUP BY container_size, container_type
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
    container_size,
    container_type,
    quantity,
    price,
    requested_delivery_date
  FROM orders
  WHERE customer_id = ${customerId}
    AND requested_delivery_date >= ${startDate}
  ORDER BY requested_delivery_date DESC NULLS LAST
`
