'use client'

import { useMemo } from 'react'
import CalendarHeader from './CalendarHeader'
import WeekStrip from './WeekStrip'
import { useWeekScroll } from './calendarScroll'
import { buildWeekGroups } from './calendarWeeks'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

interface CalendarBoardProps {
  /** Orders bucketed by day, from `groupRowsByDay`. */
  rowsByDay: Map<string, CalendarOrderRow[]>
  /** Pickups bucketed by day, from `groupPickupsByDay`. */
  pickupsByDay: Map<string, CalendarPickupRow[]>
  /** Orders with no production date. */
  unscheduled: CalendarOrderRow[]
  /** Pickups with no date. */
  unscheduledPickups: CalendarPickupRow[]
  /** Anchor week's Monday as `yyyy-MM-dd`. */
  weekStart: string
  shouldReduceMotion: boolean
  onPick: (orderId: string, dateKey: string) => void
  /** Places the chosen undated pickup on a day. */
  onPickPickup: (pickupId: string, dateKey: string) => void
  onSelectPickup: (pickup: CalendarPickupRow) => void
}

/**
 * The board itself: the header bar above the horizontally scrolling week strip.
 *
 * Split out of `CalendarLayout` when Task 80 added the second group, so that
 * component stays inside the 80-line JSX allowance (CONSTRAINT-14) and reads as
 * what it is — a composition root wiring providers, the board and the overlays.
 *
 * It owns the week-scroll hook because nothing outside the board consumes it:
 * `stripRef`, `todayKey` and `goToCurrentWeek` are read here and by the header
 * this renders, and nowhere else. Both day-bucket maps arrive already built —
 * `CalendarLayout` needs them too, to size a `+ Add` placement against the
 * right list, and one shared bucketing is what keeps the two agreeing.
 *
 * Every context it needs — arm mode, card selection, group visibility, the
 * new-card day — is provided above it by `CalendarLayout`, not passed through.
 */
export default function CalendarBoard({
  rowsByDay,
  pickupsByDay,
  unscheduled,
  unscheduledPickups,
  weekStart,
  shouldReduceMotion,
  onPick,
  onPickPickup,
  onSelectPickup,
}: CalendarBoardProps) {
  const { stripRef, todayKey, goToCurrentWeek } = useWeekScroll(weekStart, shouldReduceMotion)
  const weeks = useMemo(() => buildWeekGroups(weekStart), [weekStart])

  return (
    <>
      <CalendarHeader
        unscheduled={unscheduled}
        unscheduledPickups={unscheduledPickups}
        onCurrentWeek={goToCurrentWeek}
        onSelectPickup={onSelectPickup}
      />
      <div
        ref={stripRef}
        data-testid="week-strip-scroll"
        className="calendar-scroll calendar-scroll-strip flex-1 min-h-0 overflow-x-auto overflow-y-hidden pt-3"
      >
        <WeekStrip
          weeks={weeks}
          rowsByDay={rowsByDay}
          pickupsByDay={pickupsByDay}
          todayKey={todayKey}
          unscheduled={unscheduled}
          unscheduledPickups={unscheduledPickups}
          onPick={onPick}
          onPickPickup={onPickPickup}
          onSelectPickup={onSelectPickup}
        />
      </div>
    </>
  )
}
