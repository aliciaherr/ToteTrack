import { format } from 'date-fns'
import { DB_DATE_FORMAT, isBusinessDay, nextBusinessDay } from '@/lib/dates'
// Type-only, and it must stay that way: `db/queries/orders` value-imports the
// postgres-js driver, and this file is consumed by client components.
import type { PoStatus } from '@/db/queries/orders'

/**
 * Pure types, constants and date maths for the dashboard production widget —
 * no DB imports, safe to consume from client components and from tests.
 * Same split, and for the same reason, as `calendar.constants.ts`:
 * `production-widget.ts` imports `@/db` (postgres-js, Node-only), and anything
 * value-importing from there drags the driver in with it.
 */

export interface ProductionWidgetRow {
  id: string
  po_number: string
  customer_name: string | null
  /** Drives the built/active dimming. Never `cancelled` — the query excludes it. */
  status: PoStatus
  backhaul: boolean
  same_day_delivery: boolean
  production_day: string
}

export interface ProductionDayGroup {
  /** The business day, `yyyy-MM-dd`. */
  date: string
  /** At most `PRODUCTION_WIDGET_ROWS_PER_DAY` rows, in calendar order. */
  rows: ProductionWidgetRow[]
  /** Every row on that day, including the ones not listed. */
  total: number
}

export interface ProductionWidgetData {
  groups: ProductionDayGroup[]
  unscheduledCount: number
}

/**
 * Rows listed per day before the remainder collapses to `+ N more`.
 *
 * Four, matching the number of cards a calendar day column is built to show —
 * the widget previews the same unit of work rather than an arbitrary slice.
 * Two days at four rows is the eight-order snapshot the dashboard is for.
 */
export const PRODUCTION_WIDGET_ROWS_PER_DAY = 4

/** Business days the widget covers. Today (if a weekday) plus the next one. */
const PRODUCTION_WIDGET_DAYS = 2

/**
 * The business days the widget shows, starting from `today`.
 *
 * `nextBusinessDay` is strictly *after* its argument and never returns it, so
 * today has to be handled separately — otherwise a Tuesday would show
 * Wednesday and Thursday rather than Tuesday and Wednesday. On a Saturday or
 * Sunday there is no "today" to show and the window starts at Monday.
 */
export function productionWidgetDays(today: Date): string[] {
  const first = isBusinessDay(today) ? today : nextBusinessDay(today)
  const days = [first]
  while (days.length < PRODUCTION_WIDGET_DAYS) {
    days.push(nextBusinessDay(days[days.length - 1]))
  }
  return days.map((day) => format(day, DB_DATE_FORMAT))
}
