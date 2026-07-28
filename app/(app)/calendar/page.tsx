import { format } from 'date-fns'
import { getCalendarOrders, getUnscheduledOrders } from '@/db/queries/calendar'
import { getActiveCustomersForSelect } from '@/db/queries/customers'
import { buildCalendarRange, parseCalendarWeek } from '@/lib/calendar-range'
import { DB_DATE_FORMAT } from '@/lib/dates'
import CalendarLayout from '@/components/calendar/CalendarLayout'
import PageTransition from '@/components/shell/PageTransition'

interface CalendarPageProps {
  searchParams: {
    week?: string
  }
}

/**
 * Production calendar route. Reads an optional `?week=yyyy-MM-dd` anchor,
 * resolves it to the Monday of that business week, then fetches the placed and
 * unscheduled POs for a buffered range around it, plus the customer list the
 * per-day "Add Purchase Order" form needs. All three fetches run in parallel —
 * the customer list is small and independent, so awaiting it in sequence would
 * add a round-trip to every calendar render for a drawer that is usually shut.
 *
 * Data is fetched here and passed down as props — nothing on this route fetches
 * from the client. The auth guard and `dynamic = 'force-dynamic'` are inherited
 * from `app/(app)/layout.tsx` and deliberately not redeclared.
 */
export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const weekStart = parseCalendarWeek(searchParams.week, new Date())

  const [rows, unscheduled, customers] = await Promise.all([
    getCalendarOrders(buildCalendarRange(weekStart)),
    getUnscheduledOrders(),
    getActiveCustomersForSelect(),
  ])

  return (
    <PageTransition>
      <CalendarLayout
        rows={rows}
        unscheduled={unscheduled}
        weekStart={format(weekStart, DB_DATE_FORMAT)}
        customers={customers}
      />
    </PageTransition>
  )
}
