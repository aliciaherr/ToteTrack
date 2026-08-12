import { format } from 'date-fns'
import { getCalendarOrders, getUnscheduledOrders } from '@/db/queries/calendar'
import { getCalendarPickups, getUnscheduledPickups } from '@/db/queries/pickups.calendar'
import { getActiveCustomersForSelect } from '@/db/queries/customers'
import { buildCalendarRange, parseCalendarWeek } from '@/lib/calendar-range'
import { DB_DATE_FORMAT } from '@/lib/dates'
import CalendarLayout from '@/components/calendar/CalendarLayout'
import PageTransition from '@/components/shell/PageTransition'

interface CalendarPageProps {
  searchParams: Promise<{
    // `string[]` because Next hands back an array for a repeated
    // `?week=a&week=b`. Typed honestly here so the boundary parser has to deal
    // with it rather than a `.trim()` throwing at request time (SEC-02).
    week?: string | string[]
  }>
}

/**
 * Production calendar route. Reads an optional `?week=yyyy-MM-dd` anchor,
 * validates it at the boundary, resolves it to the Monday of that business
 * week, then fetches the placed and unscheduled POs **and pickups** for a
 * buffered range around it, plus the customer list the per-day "Add Purchase
 * Order" form needs. All five fetches run in parallel — each is independent, so
 * awaiting them in sequence would add four round-trips to every render.
 *
 * The only query param this route reads is `week`, and the only value that
 * reaches a query is the `yyyy-MM-dd` range `buildCalendarRange` derives from
 * an already-parsed `Date` — nothing raw from `searchParams` is ever bound
 * (SEC-02).
 *
 * Data is fetched here and passed down as props — nothing on this route fetches
 * from the client. The auth guard and `dynamic = 'force-dynamic'` are inherited
 * from `app/(app)/layout.tsx` and deliberately not redeclared.
 */
export default async function CalendarPage(props: CalendarPageProps) {
  const searchParams = await props.searchParams
  const weekStart = parseCalendarWeek(searchParams.week, new Date())
  const range = buildCalendarRange(weekStart)

  const [rows, unscheduled, pickups, unscheduledPickups, customers] = await Promise.all([
    getCalendarOrders(range),
    getUnscheduledOrders(),
    getCalendarPickups(range),
    getUnscheduledPickups(),
    getActiveCustomersForSelect(),
  ])

  return (
    <PageTransition>
      <CalendarLayout
        rows={rows}
        unscheduled={unscheduled}
        pickups={pickups}
        unscheduledPickups={unscheduledPickups}
        weekStart={format(weekStart, DB_DATE_FORMAT)}
        customers={customers}
      />
    </PageTransition>
  )
}
