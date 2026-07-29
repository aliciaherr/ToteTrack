import PageTransition from '@/components/shell/PageTransition'
import DashboardView from '@/components/dashboard/DashboardView'
import {
  getDashboardStats,
  getRevenueTrendData,
  getLeadsFollowUp,
  getNeedToContactList,
  getOpenOrdersForDashboard,
  type DashboardPeriod,
} from '@/db/queries/dashboard'
import { getProductionWidgetData } from '@/db/queries/production-widget'

function parsePeriod(raw: string | string[] | undefined): DashboardPeriod {
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === 'yearly' ? 'yearly' : 'monthly'
}

interface DashboardPageProps {
  searchParams: { period?: string | string[] }
}

/**
 * Server component for /dashboard. Reads the `?period=` query param,
 * fetches the period-scoped stats and dashboard widget data server-side
 * in parallel, and passes them down to the client dashboard shell. Auth
 * is already enforced by `app/(app)/layout.tsx`.
 */
export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const period = parsePeriod(searchParams.period)
  const [stats, needToContact, openOrders, leadsFollowUp, revenueTrend, production] =
    await Promise.all([
      getDashboardStats(period),
      getNeedToContactList(),
      getOpenOrdersForDashboard(),
      getLeadsFollowUp(),
      getRevenueTrendData(),
      getProductionWidgetData(new Date()),
    ])
  return (
    <PageTransition>
      <DashboardView
        stats={stats}
        needToContact={needToContact}
        openOrders={openOrders}
        leadsFollowUp={leadsFollowUp}
        revenueTrend={revenueTrend}
        production={production}
      />
    </PageTransition>
  )
}
