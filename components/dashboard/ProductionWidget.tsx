'use client'

import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import BackhaulTag from '@/components/shared/BackhaulTag'
import SameDayTag from '@/components/shared/SameDayTag'
import {
  ACTIVE_SURFACE_CLASS,
  BUILT_SURFACE_CLASS,
  isBuiltStatus,
} from '@/components/calendar/productionCardStatus'
import type {
  ProductionDayGroup,
  ProductionWidgetRow,
} from '@/db/queries/production-widget.constants'

interface ProductionWidgetProps {
  groups: ProductionDayGroup[]
  unscheduledCount: number
}

/**
 * The day's heading: always the real weekday and date, never `Today` or
 * `Tomorrow`.
 *
 * Relative labels were removed deliberately. They only hold for one of the two
 * columns and only on some days — on a Friday the second column is Monday, and
 * over a weekend neither column is today or tomorrow — so the label had to
 * switch formats depending on when you looked at it. A date that always reads
 * the same way is quicker to scan than one that sometimes doesn't.
 */
export function formatDayLabel(isoDate: string): string {
  // `parseISO`, never `new Date(string)` — the latter reads a date-only string
  // as UTC midnight and prints the previous day in a negative-offset timezone.
  return format(parseISO(isoDate), 'EEE, MMM d')
}

/**
 * One order in a day column.
 *
 * Built orders (completed / invoiced) carry the calendar card's dimmed
 * treatment verbatim — same constant, imported rather than copied, so the
 * dashboard and the calendar can never disagree about which orders are still
 * live. The row stays a full-size link either way: a built order is still worth
 * opening, it is just no longer work to be done.
 */
function ProductionRowLink({ row }: { row: ProductionWidgetRow }) {
  const surface = isBuiltStatus(row.status) ? BUILT_SURFACE_CLASS : ACTIVE_SURFACE_CLASS

  return (
    <li>
      <Link
        href={`/orders?id=${row.id}`}
        className={`flex flex-col justify-center gap-0.5 px-3 py-2 min-h-[44px] hover:bg-muted transition-colors ${surface}`}
      >
        <span className="h-5 flex items-center text-sm font-medium text-foreground truncate">
          {row.po_number}
        </span>
        {/* Tags sit after the customer name, mirroring how Open Orders places
            them after the PO number. Long names truncate — accepted.

            `h-5` is load-bearing: `BackhaulTag` and `SameDayTag` are 20px tall
            against a 16px `text-xs` line, so without a fixed height a tagged row
            grew ~4px and stopped lining up with the row beside it in the other
            day's column. Pinning both lines to 20px makes every row identical
            whether it carries tags or not. */}
        <span className="h-5 flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
          <span className="truncate">{row.customer_name ?? 'Unknown customer'}</span>
          {row.backhaul && <BackhaulTag />}
          {row.same_day_delivery && <SameDayTag />}
        </span>
      </Link>
    </li>
  )
}

/**
 * One day, as a column. A miniature of a calendar day column rather than a
 * section of a list — which is the whole point of the side-by-side layout: the
 * two days are parallel, not sequential.
 */
function ProductionDayColumn({ group }: { group: ProductionDayGroup }) {
  const hiddenCount = group.total - group.rows.length

  return (
    <div data-testid="production-day" data-date={group.date} className="flex flex-col min-w-0">
      <h3 className="px-3 py-1.5 border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">
        {formatDayLabel(group.date)}
      </h3>

      {group.rows.length === 0 ? (
        <p className="flex-1 flex items-center justify-center px-3 py-6 text-center text-xs text-muted-foreground">
          Nothing scheduled.
        </p>
      ) : (
        <ul className="flex-1 divide-y divide-border" role="list">
          {group.rows.map((row) => (
            <ProductionRowLink key={row.id} row={row} />
          ))}
        </ul>
      )}

      {hiddenCount > 0 && (
        <p className="px-3 py-1.5 text-xs text-muted-foreground shrink-0">+ {hiddenCount} more</p>
      )}
    </div>
  )
}

function UnscheduledPill({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center rounded-full bg-red-100 text-red-800 px-2 py-0.5 text-xs font-medium">
      {count} unscheduled
    </span>
  )
}

/**
 * Dashboard widget showing what is being built over the next two business days,
 * as two side-by-side columns of up to `PRODUCTION_WIDGET_ROWS_PER_DAY` orders.
 *
 * Business days, not calendar days: on a Friday this shows Friday and Monday,
 * and over a weekend it shows Monday and Tuesday. Nothing is ever built on a
 * Saturday (CONSTRAINT-19), so a "next 2 days" window that included one would
 * show an empty column half the week.
 *
 * The outer height is set by the dashboard grid, which stretches row items to
 * match — so this sits flush with the widget beside it regardless of how many
 * rows each column happens to hold.
 *
 * The footer carries the unscheduled count because this widget is the only
 * place on the dashboard where an order with no production date would otherwise
 * be invisible.
 *
 * @param groups One entry per business day, already capped and counted.
 * @param unscheduledCount Orders with no production date.
 */
export default function ProductionWidget({ groups, unscheduledCount }: ProductionWidgetProps) {
  return (
    <section
      aria-label="Production schedule"
      className="rounded-xl bg-card border border-border flex flex-col overflow-hidden"
    >
      <header className="px-4 py-2.5 border-b border-border bg-muted/50 shrink-0">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Production
        </h2>
      </header>

      <div className="flex-1 grid grid-cols-2 divide-x divide-border">
        {groups.map((group) => (
          <ProductionDayColumn key={group.date} group={group} />
        ))}
      </div>

      <footer className="px-4 py-3 border-t border-border shrink-0 flex items-center justify-between gap-3">
        {unscheduledCount > 0 ? (
          <UnscheduledPill count={unscheduledCount} />
        ) : (
          <span className="text-xs text-muted-foreground">All orders dated</span>
        )}
        <Link href="/calendar" className="text-sm font-medium text-primary hover:underline">
          View calendar
        </Link>
      </footer>
    </section>
  )
}
