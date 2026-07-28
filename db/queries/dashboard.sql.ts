import { sql } from 'drizzle-orm'

// Raw SQL builders for the dashboard query module. Extracted so
// `dashboard.ts` stays under the 300-line service-file cap (CQ-02).
// Drizzle's `sql` template parameterises every interpolated value — no
// string concatenation crosses the boundary, so these fragments are safe
// from injection (SEC-02).

/**
 * Sum of `invoices.total_amount` for invoices whose `billing_month` falls
 * within `[startDate, endDate]` inclusive. `COALESCE(..., 0)` guarantees a
 * numeric result when the window contains no invoices.
 */
export function invoicedSumQuery(startDate: string, endDate: string) {
  return sql`
    SELECT COALESCE(SUM(total_amount), 0)::text AS total
    FROM invoices
    WHERE billing_month >= ${startDate}
      AND billing_month <= ${endDate}
  `
}

/**
 * Hero-card counts for the PURCHASE ORDERS card:
 *  - `open_count`: live count of `status = 'scheduled'` orders (in-flight, not
 *    yet completed). All-time, not period-filtered — reflects the current
 *    pipeline regardless of the Monthly/Yearly toggle.
 *  - `completed_in_period_count`: count of orders that landed (completed or
 *    invoiced — both mean delivered) with `requested_delivery_date` in the
 *    selected period.
 */
export function buildPoHeroCountsQuery(startDate: string, endDate: string) {
  return sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'scheduled')::int AS open_count,
      COUNT(*) FILTER (
        WHERE status IN ('completed', 'invoiced')
          AND requested_delivery_date >= ${startDate}
          AND requested_delivery_date <= ${endDate}
      )::int AS completed_in_period_count
    FROM orders
  `
}

/**
 * SQL for the Need-to-Contact list. Joins two CTEs onto `customers`:
 *  - `order_stats`: completed-order count + last completed date per customer
 *  - `auto_freq`: average days between consecutive completed orders
 *
 * Effective frequency = `COALESCE(manual_override, auto_freq)`. A customer
 * qualifies when active AND either (a) manual override is set OR (b) they
 * have ≥ 2 completed orders (auto-freq AVG over LAG() needs two rows).
 * Outer filter: `overdue_days > 0`. Sort: `overdue_days DESC`.
 */
export function buildNeedToContactQuery(limit: number) {
  return sql`
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
    )
    SELECT
      c.id,
      c.company_name,
      (
        (CURRENT_DATE - os.last_completed_date)::int
        - CEIL(COALESCE(c.contact_frequency_days::numeric, af.avg_freq_days))::int
      ) AS overdue_days
    FROM customers c
    LEFT JOIN order_stats os ON os.customer_id = c.id
    LEFT JOIN auto_freq af ON af.customer_id = c.id
    WHERE c.status = 'active'
      AND os.last_completed_date IS NOT NULL
      AND COALESCE(c.contact_frequency_days::numeric, af.avg_freq_days) IS NOT NULL
      AND (
        (CURRENT_DATE - os.last_completed_date)::int
        - CEIL(COALESCE(c.contact_frequency_days::numeric, af.avg_freq_days))::int
      ) > 0
    ORDER BY overdue_days DESC, c.company_name ASC
    LIMIT ${limit}
  `
}

/**
 * SQL for the Open Orders widget — orders in the `scheduled` state (the new
 * single in-flight state after the v2 PO model dropped `pending`).
 * `backhaul DESC` pins backhaul=true rows first (boolean sort order: false
 * < true in ASC, so DESC lifts true to the top). Ties break by earliest
 * requested delivery date, then by PO number for a stable sort.
 */
export function buildOpenOrdersQuery(limit: number) {
  return sql`
    SELECT
      o.id,
      o.po_number,
      c.company_name AS customer_name,
      o.qty_275_recon,
      o.qty_275_rebot,
      o.qty_275_new,
      o.qty_330_recon,
      o.qty_330_rebot,
      o.qty_330_new,
      o.requested_delivery_date,
      o.backhaul
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.status = 'scheduled'
    ORDER BY o.backhaul DESC, o.requested_delivery_date ASC NULLS LAST, o.po_number ASC
    LIMIT ${limit}
  `
}

/**
 * SQL for the Leads Follow-Up widget. Includes only leads whose
 * `next_follow_up_date` is today or past. Converted leads are excluded
 * (plan.md Task 20 hides them from every filter). The server computes
 * `overdue_days` once so the widget doesn't reimplement date math.
 */
export function buildLeadsFollowUpQuery(limit: number) {
  return sql`
    SELECT
      id,
      name,
      company,
      next_follow_up_date,
      (CURRENT_DATE - next_follow_up_date)::int AS overdue_days
    FROM leads
    WHERE status <> 'converted'
      AND next_follow_up_date IS NOT NULL
      AND next_follow_up_date <= CURRENT_DATE
    ORDER BY next_follow_up_date ASC, name ASC
    LIMIT ${limit}
  `
}

/**
 * SQL for the invoice trend chart. Rolls up to one row per `billing_month`
 * (SUM(total_amount)), sorted ASC. Both draft and paid invoices are
 * included — the trend shows total invoiced revenue generated each month,
 * not cash collected. The caller reshapes into the 4 chart modes
 * client-side.
 */
export const INVOICE_TREND_QUERY = sql`
  SELECT
    billing_month,
    SUM(total_amount)::text AS total_amount
  FROM invoices
  GROUP BY billing_month
  ORDER BY billing_month ASC
`

/**
 * Rows for the production widget: every non-cancelled order whose calendar
 * column falls on one of `days`.
 *
 * Reads `production_date` directly, exactly as the calendar does — a card's day
 * *is* that column, with no derivation anywhere (CONSTRAINT-19). The widget and
 * the calendar therefore cannot disagree about which day an order falls on.
 *
 * Ordered by day, then by the same intra-day sequence the calendar column uses
 * — explicit `production_sort_index` first, unplaced rows after, `po_number` as
 * the stable tiebreak — so the widget's top 3 are the calendar's top 3.
 *
 * `o.status` is selected so the widget can dim already-built rows exactly as the
 * calendar dims their cards; without it the two surfaces disagree about which
 * orders are still live.
 *
 * @param days Business days as `yyyy-MM-dd`. Never empty; callers pass exactly two.
 */
export function buildProductionWidgetQuery(days: string[]) {
  const dayList = sql.join(
    days.map((day) => sql`${day}::date`),
    sql`, `,
  )
  return sql`
    SELECT
      o.id,
      o.po_number,
      c.company_name AS customer_name,
      o.status,
      o.backhaul,
      o.same_day_delivery,
      o.production_date::text AS production_day
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.status <> 'cancelled'
      AND o.production_date IN (${dayList})
    ORDER BY
      production_day ASC,
      o.production_sort_index ASC NULLS LAST,
      o.po_number ASC
  `
}

/**
 * Count of orders with no production date — the same set `getUnscheduledOrders`
 * returns, counted rather than fetched. The widget shows only the number and
 * links to `/calendar` for the list.
 */
export function buildUnscheduledCountQuery() {
  return sql`
    SELECT COUNT(*)::int AS count
    FROM orders o
    WHERE o.status <> 'cancelled'
      AND o.production_date IS NULL
  `
}
