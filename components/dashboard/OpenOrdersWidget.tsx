'use client'

import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import BackhaulTag from '@/components/shared/BackhaulTag'
import { sumPoSize, formatPoTotal } from '@/components/shared/qtyGridValues'
import type { OpenOrderRow } from '@/db/queries/dashboard'

interface OpenOrdersWidgetProps {
  rows: OpenOrderRow[]
}

function formatDeliveryDate(isoDate: string | null): string {
  if (!isoDate) return '—'
  return format(parseISO(isoDate), 'MMM d')
}

function OpenOrderRowLink({ row }: { row: OpenOrderRow }) {
  const total275 = sumPoSize(row, '275')
  const total330 = sumPoSize(row, '330')
  return (
    <li>
      <Link
        href={`/orders?id=${row.id}`}
        className="flex items-center gap-3 px-4 py-3 min-h-[44px] hover:bg-muted transition-colors"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">
              {row.po_number}
            </span>
            {row.backhaul && <BackhaulTag />}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
            <span className="truncate">{row.customer_name ?? 'Unknown customer'}</span>
            <span className="shrink-0 tabular-nums">
              275: {formatPoTotal(total275)} · 330: {formatPoTotal(total330)}
            </span>
          </div>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatDeliveryDate(row.requested_delivery_date)}
        </span>
      </Link>
    </li>
  )
}

/**
 * Dashboard widget listing the top open (`status='scheduled'`) orders.
 * Backhaul orders are pinned to the top server-side; the BackhaulTag
 * surfaces the pin reason. Each row also shows the per-size totals
 * (275 / 330) so the salesperson can scan volume without opening the
 * order. Clicking a row deep-links to `/orders?id=[id]`; the footer
 * link routes to `/orders?status=scheduled`.
 */
export default function OpenOrdersWidget({ rows }: OpenOrdersWidgetProps) {
  return (
    <section
      aria-label="Open orders"
      className="rounded-xl bg-card border border-border flex flex-col"
    >
      <header className="px-4 py-2.5 border-b border-border bg-muted/50">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Open Orders
        </h2>
      </header>
      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-8 text-center">
          No open orders.
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-border" role="list">
          {rows.map((row) => (
            <OpenOrderRowLink key={row.id} row={row} />
          ))}
        </ul>
      )}
      <footer className="px-4 py-3 border-t border-border">
        <Link
          href="/orders?status=scheduled"
          className="text-sm font-medium text-primary hover:underline"
        >
          View all
        </Link>
      </footer>
    </section>
  )
}
