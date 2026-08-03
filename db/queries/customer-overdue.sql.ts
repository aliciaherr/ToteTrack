import { sql } from 'drizzle-orm'

// Single source of truth for the overdue-customer business rule (CQ-07).
// Previously duplicated across `customers.sql.ts` (list + detail queries) and
// `dashboard.sql.ts` (Need-to-Contact query). The rule, in one place:
//
//   - A "completed" order means `status IN ('completed', 'invoiced')`.
//   - `order_stats`: completed-order count + last completed delivery date +
//     whether any order is currently scheduled.
//   - `auto_freq`: average gap in days between consecutive completed orders
//     (LAG over a window ordered by requested_delivery_date).
//   - Effective contact frequency = manual override if set, else auto average.
//   - overdue_days = (days since last completed order) - CEIL(effective freq).
//   - A customer with a scheduled order is never overdue (overdue_days NULL):
//     an order is already booked, so there is nothing to contact them about
//     (Task 74). The frequency math stays completed-only — scheduled dates
//     are promises, not delivery facts.
//
// Fragments assume the canonical aliases used at every call site:
// `c` = customers, `os` = order_stats, `af` = auto_freq.
//
// Drizzle's `sql` template parameterizes all interpolated values — no string
// concatenation crosses the boundary (SEC-03). Server-side only: client
// components must not import from this module.

/**
 * All-customers `order_stats` CTE (grouped by customer). Splice after `WITH `
 * or a comma in a CTE list.
 */
export const ORDER_STATS_CTE = sql`order_stats AS (
    SELECT
      o.customer_id,
      COUNT(*) FILTER (WHERE o.status IN ('completed', 'invoiced'))::int AS completed_order_count,
      MAX(o.requested_delivery_date) FILTER (WHERE o.status IN ('completed', 'invoiced')) AS last_completed_date,
      bool_or(o.status = 'scheduled') AS has_scheduled_order
    FROM orders o
    GROUP BY o.customer_id
  )`

/**
 * All-customers `auto_freq` CTE (grouped by customer). AVG over LAG needs at
 * least two completed orders per customer to yield a row.
 */
export const AUTO_FREQ_CTE = sql`auto_freq AS (
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
  )`

/**
 * Single-customer `order_stats` CTE (one scalar row, no grouping) for the
 * customer-detail query. `customerId` is bound as a query parameter.
 */
export const customerOrderStatsCte = (customerId: string) => sql`order_stats AS (
    SELECT
      COUNT(*) FILTER (WHERE status IN ('completed', 'invoiced'))::int AS completed_order_count,
      MAX(requested_delivery_date) FILTER (WHERE status IN ('completed', 'invoiced')) AS last_completed_date,
      bool_or(status = 'scheduled') AS has_scheduled_order
    FROM orders
    WHERE customer_id = ${customerId}
  )`

/**
 * Single-customer `auto_freq` CTE (one scalar row, no partition) for the
 * customer-detail query. `customerId` is bound as a query parameter.
 */
export const customerAutoFreqCte = (customerId: string) => sql`auto_freq AS (
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
  )`

/** Effective contact frequency: manual override wins, else the auto average. */
export const EFFECTIVE_FREQUENCY_EXPR = sql`COALESCE(c.contact_frequency_days::numeric, af.avg_freq_days)`

/**
 * Parenthesized overdue-days arithmetic:
 * (days since last completed order) - CEIL(effective frequency).
 *
 * Postgres alias rules force queries that filter on this value to repeat the
 * expression in WHERE — a SELECT alias is not referenceable there — so this
 * fragment is deliberately splice-able in both positions.
 */
export const OVERDUE_DAYS_EXPR = sql`(
        (CURRENT_DATE - os.last_completed_date)::int
        - CEIL(${EFFECTIVE_FREQUENCY_EXPR})::int
      )`

/**
 * NULL-guarded `overdue_days` select item: NULL when the customer has a
 * scheduled order (nothing to contact them about — Task 74), no completed
 * orders, or no derivable frequency; else the overdue arithmetic.
 */
export const OVERDUE_DAYS_SELECT_CASE = sql`CASE
      WHEN os.has_scheduled_order THEN NULL
      WHEN os.last_completed_date IS NULL THEN NULL
      WHEN ${EFFECTIVE_FREQUENCY_EXPR} IS NULL THEN NULL
      ELSE ${OVERDUE_DAYS_EXPR}
    END AS overdue_days`
