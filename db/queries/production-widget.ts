import { db } from '@/db'
import { DatabaseError } from '@/lib/errors'
import { buildProductionWidgetQuery, buildUnscheduledCountQuery } from './dashboard.sql'
import {
  PRODUCTION_WIDGET_ROWS_PER_DAY,
  productionWidgetDays,
  type ProductionDayGroup,
  type ProductionWidgetData,
  type ProductionWidgetRow,
} from './production-widget.constants'

export {
  PRODUCTION_WIDGET_ROWS_PER_DAY,
  productionWidgetDays,
  type ProductionDayGroup,
  type ProductionWidgetData,
  type ProductionWidgetRow,
}

// The dashboard's production widget (Feature 11). Kept out of `dashboard.ts`
// so that file stays within the 300-line service cap (CQ-02), and because this
// reads `production_date` the way the calendar does rather than the original
// dashboard's period windows — different feature, different concerns.

function groupByDay(days: string[], rows: ProductionWidgetRow[]): ProductionDayGroup[] {
  return days.map((date) => {
    const forDay = rows.filter((row) => row.production_day === date)
    return {
      date,
      rows: forDay.slice(0, PRODUCTION_WIDGET_ROWS_PER_DAY),
      total: forDay.length,
    }
  })
}

interface UnscheduledCountRow {
  count: number
}

/**
 * Loads the dashboard production widget: the next two business days with up to
 * `PRODUCTION_WIDGET_ROWS_PER_DAY` orders each, plus the count of orders that
 * have no date at all.
 *
 * A day with no orders still gets a group — the widget renders an empty state
 * for it rather than silently showing one day, so "nothing is scheduled
 * tomorrow" stays visible information.
 *
 * @param today Reference date. Injected so callers — and tests — control "now".
 * @throws {DatabaseError} when either underlying query fails.
 */
export async function getProductionWidgetData(today: Date): Promise<ProductionWidgetData> {
  const days = productionWidgetDays(today)
  try {
    const [rowsResult, countResult] = await Promise.all([
      db.execute(buildProductionWidgetQuery(days)),
      db.execute(buildUnscheduledCountQuery()),
    ])
    const rows = rowsResult as unknown as ProductionWidgetRow[]
    const unscheduledCount = (countResult as unknown as UnscheduledCountRow[])[0]?.count ?? 0
    return { groups: groupByDay(days, rows), unscheduledCount }
  } catch (cause) {
    console.error('getProductionWidgetData: query failed', {
      operation: 'getProductionWidgetData',
      days,
      cause,
    })
    throw new DatabaseError(
      'getProductionWidgetData',
      'Failed to load production widget data',
      { cause },
    )
  }
}
