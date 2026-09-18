'use client'

import { Button } from '@/components/ui/button'
import CalendarSearch from './CalendarSearch'
import CalendarViewCycle from './CalendarViewCycle'
import UnscheduledCallout from './UnscheduledCallout'
import UnscheduledPickupsCallout from './UnscheduledPickupsCallout'
import { useCalendarVisibility } from './pickupVisibility'
import type { CalendarSearch as CalendarSearchState } from './useCalendarSearch'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

// The calendar's header bar, split out of `CalendarLayout` when Task 80 added
// the group toggles and the second callout — the same reason `DayColumn` has a
// `*Parts` sibling. `CalendarLayout` stays a composition root.

/**
 * The calendar's title bar: order search, the view cycle, the unscheduled
 * callouts for whichever groups are on, and the Current week action.
 *
 * The pickups callout is gated on the pickups toggle rather than always shown.
 * With pickups off the calendar is the production board it has always been, and
 * a count of collections the viewer has just hidden is noise on a header that
 * has no horizontal room to spare at iPad landscape width.
 *
 * Search sits leftmost, before the view cycle, because it is the one control
 * that can change what the other two are describing — it may switch the view
 * and open the orders callout on its way to a card.
 *
 * @param unscheduled Orders with no production date.
 * @param unscheduledPickups Pickups with no date.
 * @param search The screen's search state, from `useCalendarSearch`.
 * @param onCurrentWeek Scrolls the strip back to the week containing today.
 * @param onSelectPickup Opens the popup for a pickup in the callout.
 */
export default function CalendarHeader({
  unscheduled,
  unscheduledPickups,
  search,
  onCurrentWeek,
  onSelectPickup,
}: {
  unscheduled: CalendarOrderRow[]
  unscheduledPickups: CalendarPickupRow[]
  search: CalendarSearchState
  onCurrentWeek: () => void
  onSelectPickup: (pickup: CalendarPickupRow) => void
}) {
  const { showPickups } = useCalendarVisibility()

  return (
    <div className="pl-20 pr-4 pt-4 pb-3 border-b border-border bg-card shrink-0 flex items-center justify-between gap-3">
      <h1 className="text-lg font-semibold text-foreground">Production Calendar</h1>
      <div className="flex items-center gap-3">
        <CalendarSearch search={search} />
        <CalendarViewCycle />
        <UnscheduledCallout rows={unscheduled} openSignal={search.undatedSignal} />
        {showPickups && (
          <UnscheduledPickupsCallout pickups={unscheduledPickups} onSelect={onSelectPickup} />
        )}
        <Button
          type="button"
          variant="outline"
          onClick={onCurrentWeek}
          className="min-h-[44px]"
          aria-label="Scroll to the current week"
        >
          Current week
        </Button>
      </div>
    </div>
  )
}
