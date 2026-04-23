'use client'

import Link from 'next/link'
import type { LeadFollowUpRow } from '@/db/queries/dashboard'

interface LeadsFollowUpWidgetProps {
  rows: LeadFollowUpRow[]
}

function OverdueBadge({ days }: { days: number }) {
  const label = days === 0 ? 'Due today' : `${days} day${days === 1 ? '' : 's'} overdue`
  const tone =
    days === 0
      ? 'bg-amber-100 text-amber-800'
      : 'bg-destructive/10 text-destructive'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium transition-colors duration-200 ease-in-out ${tone}`}>
      {label}
    </span>
  )
}

function LeadRowLink({ row }: { row: LeadFollowUpRow }) {
  return (
    <li>
      <Link
        href={`/leads?id=${row.id}`}
        className="flex items-center gap-3 px-4 py-3 min-h-[44px] hover:bg-muted transition-colors"
      >
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="text-sm font-medium text-foreground truncate">{row.name}</div>
          {row.company && (
            <div className="text-xs text-muted-foreground truncate">{row.company}</div>
          )}
        </div>
        <OverdueBadge days={row.overdue_days} />
      </Link>
    </li>
  )
}

/**
 * Dashboard widget listing leads whose next follow-up date has arrived or
 * passed. Converted leads never appear (the query filters them out — see
 * `db/queries/dashboard.sql.ts`). Rows show the lead name, company, and an
 * overdue badge; same-day rows surface "Due today" in an amber tone instead
 * of a red-orange overdue count. Clicking a row deep-links to
 * `/leads?id=[id]`; the footer link routes to `/leads` for the full list.
 */
export default function LeadsFollowUpWidget({ rows }: LeadsFollowUpWidgetProps) {
  return (
    <section
      aria-label="Leads to follow up on"
      className="rounded-xl bg-card border border-border flex flex-col"
    >
      <header className="px-4 py-2.5 border-b border-border bg-muted/50">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Leads Follow-Up
        </h2>
      </header>
      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground p-8 text-center">
          No leads to follow up on.
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-border" role="list">
          {rows.map((row) => (
            <LeadRowLink key={row.id} row={row} />
          ))}
        </ul>
      )}
      <footer className="px-4 py-3 border-t border-border">
        <Link
          href="/leads"
          className="text-sm font-medium text-primary hover:underline"
        >
          View all
        </Link>
      </footer>
    </section>
  )
}
