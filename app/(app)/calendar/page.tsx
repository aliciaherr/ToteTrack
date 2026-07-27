import { format } from 'date-fns'
import { getCalendarOrders, getUnscheduledOrders } from '@/db/queries/calendar'
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
 * unscheduled POs for a buffered range around it. Both fetches run in parallel.
 *
 * Data is fetched here and passed down as props — nothing on this route fetches
 * from the client. The auth guard and `dynamic = 'force-dynamic'` are inherited
 * from `app/(app)/layout.tsx` and deliberately not redeclared.
 */
export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const weekStart = parseCalendarWeek(searchParams.week, new Date())

  const [rows, unscheduled] = await Promise.all([
    getCalendarOrders(buildCalendarRange(weekStart)),
    getUnscheduledOrders(),
  ])

  return (
    <PageTransition>
      <CalendarLayout
        rows={rows}
        unscheduled={unscheduled}
        weekStart={format(weekStart, DB_DATE_FORMAT)}
      />
    </PageTransition>
  )
}
