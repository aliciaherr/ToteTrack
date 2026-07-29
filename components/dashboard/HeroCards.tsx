'use client'

import type { DashboardStats } from '@/db/queries/dashboard'
import { formatCurrency } from '@/lib/format-currency'

interface HeroCardsProps {
  stats: DashboardStats
}

function formatDelta(deltaPercent: number | null): string {
  if (deltaPercent === null) return '—'
  const rounded = Math.round(deltaPercent * 10) / 10
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${rounded}%`
}

function deltaClasses(deltaPercent: number | null): string {
  if (deltaPercent === null || deltaPercent === 0) {
    return 'bg-muted text-muted-foreground'
  }
  if (deltaPercent > 0) return 'bg-emerald-100 text-emerald-800'
  return 'bg-destructive/10 text-destructive'
}

function deltaArrow(deltaPercent: number | null): string {
  if (deltaPercent === null || deltaPercent === 0) return ''
  return deltaPercent > 0 ? '▲' : '▼'
}

function periodLabel(period: DashboardStats['period']): string {
  return period === 'yearly' ? 'vs last year' : 'vs last month'
}

function TotalRevenueCard({ stats }: { stats: DashboardStats }) {
  return (
    <section
      aria-label="Total revenue"
      className="flex-1 rounded-xl bg-[#F0F4F8] p-5 space-y-3"
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        Total Revenue
      </div>
      <div className="text-3xl font-semibold text-foreground tabular-nums">
        {formatCurrency(stats.totalRevenue)}
      </div>
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors duration-200 ease-in-out ${deltaClasses(stats.deltaPercent)}`}
        >
          <span aria-hidden="true">{deltaArrow(stats.deltaPercent)}</span>
          {formatDelta(stats.deltaPercent)}
        </span>
        <span className="text-xs text-muted-foreground">{periodLabel(stats.period)}</span>
      </div>
    </section>
  )
}

function periodCompletedLabel(period: DashboardStats['period']): string {
  return period === 'yearly' ? 'completed this year' : 'completed this month'
}

function PurchaseOrdersCard({ stats }: { stats: DashboardStats }) {
  return (
    <section
      aria-label="Purchase orders"
      className="flex-1 rounded-xl bg-[#F0F4F8] p-5 space-y-3"
    >
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        Purchase Orders
      </div>
      <div className="flex items-end gap-3">
        <span className="text-3xl font-semibold text-foreground tabular-nums">
          {stats.openCount}
        </span>
        <span className="text-sm text-muted-foreground pb-1">open</span>
      </div>
      <div className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground tabular-nums">{stats.completedInPeriodCount}</span>
        {' '}{periodCompletedLabel(stats.period)}
      </div>
    </section>
  )
}

/**
 * Two side-by-side hero cards at the top of the dashboard.
 * `TotalRevenueCard` is period-aware (current vs prior period delta) and
 * shows booked revenue — summed order prices for non-cancelled orders.
 * `PurchaseOrdersCard` shows the live `openCount` (always current) and the
 * period-scoped `completedInPeriodCount`.
 */
export default function HeroCards({ stats }: HeroCardsProps) {
  return (
    <div className="flex flex-col md:flex-row gap-4">
      <TotalRevenueCard stats={stats} />
      <PurchaseOrdersCard stats={stats} />
    </div>
  )
}
