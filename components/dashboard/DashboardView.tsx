'use client'

import { useTransition } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import HeroCards from './HeroCards'
import NeedToContactWidget from './NeedToContactWidget'
import OpenOrdersWidget from './OpenOrdersWidget'
import LeadsFollowUpWidget from './LeadsFollowUpWidget'
import ProductionWidget from './ProductionWidget'
import RevenueChart from './RevenueChart'
import QuickAddFab from './QuickAddFab'
import type { ProductionWidgetData } from '@/db/queries/production-widget.constants'
import type {
  DashboardPeriod,
  DashboardStats,
  RevenueTrendRow,
  LeadFollowUpRow,
  NeedToContactRow,
  OpenOrderRow,
} from '@/db/queries/dashboard'

interface DashboardViewProps {
  stats: DashboardStats
  needToContact: NeedToContactRow[]
  openOrders: OpenOrderRow[]
  leadsFollowUp: LeadFollowUpRow[]
  revenueTrend: RevenueTrendRow[]
  production: ProductionWidgetData
}

const PERIOD_OPTIONS: Array<{ value: DashboardPeriod; label: string }> = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

function PeriodPill({
  option,
  isActive,
  isPending,
  shouldReduceMotion,
  onSelect,
}: {
  option: { value: DashboardPeriod; label: string }
  isActive: boolean
  isPending: boolean
  shouldReduceMotion: boolean
  onSelect: (period: DashboardPeriod) => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={() => onSelect(option.value)}
      disabled={isPending}
      className={`relative min-h-[44px] px-4 text-sm font-medium rounded-full transition-colors ${
        isActive ? 'text-primary-foreground' : 'text-secondary hover:text-foreground'
      }`}
    >
      {isActive && (
        <motion.span
          layoutId="dashboard-period-pill"
          className="absolute inset-0 rounded-full bg-primary"
          transition={
            shouldReduceMotion
              ? { duration: 0 }
              : { duration: 0.15, ease: 'easeInOut' as const }
          }
        />
      )}
      <span className="relative z-10">{option.label}</span>
    </button>
  )
}

function PeriodToggle({
  period,
  onSelect,
  isPending,
}: {
  period: DashboardPeriod
  onSelect: (next: DashboardPeriod) => void
  isPending: boolean
}) {
  const shouldReduceMotion = Boolean(useReducedMotion())
  return (
    <div
      role="tablist"
      aria-label="Dashboard period"
      className="inline-flex items-center gap-1 rounded-full bg-muted p-1"
    >
      {PERIOD_OPTIONS.map((option) => (
        <PeriodPill
          key={option.value}
          option={option}
          isActive={option.value === period}
          isPending={isPending}
          shouldReduceMotion={shouldReduceMotion}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

/**
 * Client-side dashboard shell. Owns the Monthly/Yearly period toggle, which
 * updates the `?period=` search param via `router.push`; the server component
 * at `app/(app)/dashboard/page.tsx` re-fetches `getDashboardStats` for the
 * new period and re-hydrates props. Follows the URL-driven state pattern
 * already established by OrderLayout / LeadLayout / InvoiceLedger.
 */
export default function DashboardView({
  stats,
  needToContact,
  openOrders,
  leadsFollowUp,
  revenueTrend,
  production,
}: DashboardViewProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  function handlePeriodSelect(next: DashboardPeriod) {
    if (next === stats.period) return
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'monthly') params.delete('period')
    else params.set('period', next)
    const qs = params.toString()
    const url = qs ? `${pathname}?${qs}` : pathname
    startTransition(() => router.push(url))
  }

  return (
    <div className="pl-20 pr-6 py-6 space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Command Overview
          </h1>
          <p className="text-sm text-muted-foreground">Real-time logistics matrix.</p>
        </div>
        <PeriodToggle period={stats.period} onSelect={handlePeriodSelect} isPending={isPending} />
      </header>
      <HeroCards stats={stats} />
      <RevenueChart data={revenueTrend} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <NeedToContactWidget rows={needToContact} />
        <ProductionWidget
          groups={production.groups}
          unscheduledCount={production.unscheduledCount}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <OpenOrdersWidget rows={openOrders} />
        <LeadsFollowUpWidget rows={leadsFollowUp} />
      </div>
      <QuickAddFab />
    </div>
  )
}
