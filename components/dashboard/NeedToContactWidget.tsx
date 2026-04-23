'use client'

import Link from 'next/link'
import type { NeedToContactRow } from '@/db/queries/dashboard'

interface NeedToContactWidgetProps {
  rows: NeedToContactRow[]
}

function OverdueBadge({ days }: { days: number }) {
  return (
    <span className="inline-flex items-center rounded-full bg-destructive/10 text-destructive px-2 py-0.5 text-xs font-medium transition-colors duration-200 ease-in-out">
      {days} day{days === 1 ? '' : 's'} overdue
    </span>
  )
}

function NeedToContactRowLink({ row }: { row: NeedToContactRow }) {
  return (
    <li>
      <Link
        href={`/customers?id=${row.id}`}
        className="flex items-center gap-3 px-4 py-3 min-h-[44px] hover:bg-muted transition-colors"
      >
        <span className="flex-1 truncate text-sm font-medium text-foreground">
          {row.company_name}
        </span>
        <OverdueBadge days={row.overdue_days} />
      </Link>
    </li>
  )
}

/**
 * Dashboard widget listing the top overdue customers. Shows up to 5 rows
 * (limit set by the caller). Clicking a row deep-links to
 * `/customers?id=[id]`; the "View all" footer link routes to
 * `/customers?sort=need_to_contact` so the full sorted list can be
 * reviewed. Renders an empty state when the server returned zero rows.
 */
export default function NeedToContactWidget({ rows }: NeedToContactWidgetProps) {
  return (
    <section
      aria-label="Customers who need contact"
      className="rounded-xl bg-card border border-border flex flex-col"
    >
      <header className="px-4 py-2.5 border-b border-border bg-muted/50">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Need to Contact
        </h2>
      </header>
      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-8 text-center">
          No customers need contact right now.
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-border" role="list">
          {rows.map((row) => (
            <NeedToContactRowLink key={row.id} row={row} />
          ))}
        </ul>
      )}
      <footer className="px-4 py-3 border-t border-border">
        <Link
          href="/customers?sort=need_to_contact"
          className="text-sm font-medium text-primary hover:underline"
        >
          View all
        </Link>
      </footer>
    </section>
  )
}
