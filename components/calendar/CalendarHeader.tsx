'use client'

import { Button } from '@/components/ui/button'
import { PillToggle } from './ProductionCardDialogControls'
import UnscheduledCallout from './UnscheduledCallout'
import UnscheduledPickupsCallout from './UnscheduledPickupsCallout'
import { useCalendarVisibility } from './pickupVisibility'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

// The calendar's header bar, split out of `CalendarLayout` when Task 80 added
// the two group toggles and the second callout — the same reason `DayColumn`
// has a `*Parts` sibling. `CalendarLayout` stays a composition root.

/**
 * The two group toggles: Orders and Pickups, independent of each other.
 *
 * `PillToggle` unforked from the card popup, so a toggle here reads and behaves
 * exactly like the popup's flag pills — `role="switch"`, a state dot as well as
 * a fill so the on/off reading never rests on colour, and a 44px target.
 *
 * Neither is ever disabled, including when turning the last one off: both off
 * is a legal state that draws an explicit message in every column, not a blank
 * grid (CONSTRAINT-25).
 */
function VisibilityToggles() {
  const { showOrders, showPickups, toggleOrders, togglePickups } = useCalendarVisibility()

  return (
    <div role="group" aria-label="Card groups" className="flex items-center gap-2">
      <PillToggle label="Orders" checked={showOrders} disabled={false} onChange={toggleOrders} />
      <PillToggle
        label="Pickups"
        checked={showPickups}
        disabled={false}
        onChange={togglePickups}
      />
    </div>
  )
}

/**
 * The calendar's title bar: the two visibility toggles, the unscheduled
 * callouts for whichever groups are on, and the Current week action.
 *
 * The pickups callout is gated on the pickups toggle rather than always shown.
 * With pickups off the calendar is the production board it has always been, and
 * a count of collections the viewer has just hidden is noise on a header that
 * has no horizontal room to spare at iPad landscape width.
 *
 * @param unscheduled Orders with no production date.
 * @param unscheduledPickups Pickups with no date.
 * @param onCurrentWeek Scrolls the strip back to the week containing today.
 * @param onSelectPickup Opens the popup for a pickup in the callout.
 */
export default function CalendarHeader({
  unscheduled,
  unscheduledPickups,
  onCurrentWeek,
  onSelectPickup,
}: {
  unscheduled: CalendarOrderRow[]
  unscheduledPickups: CalendarPickupRow[]
  onCurrentWeek: () => void
  onSelectPickup: (pickup: CalendarPickupRow) => void
}) {
  const { showOrders, showPickups } = useCalendarVisibility()

  return (
    <div className="pl-20 pr-4 pt-4 pb-3 border-b border-border bg-card shrink-0 flex items-center justify-between gap-3">
      <h1 className="text-lg font-semibold text-foreground">Production Calendar</h1>
      <div className="flex items-center gap-3">
        <VisibilityToggles />
        {showOrders && <UnscheduledCallout rows={unscheduled} />}
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
