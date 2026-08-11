'use client'

import { Fragment } from 'react'
import { format } from 'date-fns'
import DayColumn from './DayColumn'
import { DB_DATE_FORMAT } from '@/lib/dates'
import type { WeekGroup } from './calendarWeeks'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

interface WeekStripProps {
  weeks: WeekGroup[]
  rowsByDay: Map<string, CalendarOrderRow[]>
  /** Pickups bucketed by `yyyy-MM-dd`, the second list in each column. */
  pickupsByDay: Map<string, CalendarPickupRow[]>
  /** `yyyy-MM-dd` for the viewer's local today, or null before hydration. */
  todayKey: string | null
  /** Orders with no production date — every column's `+ Add` lists this set. */
  unscheduled: CalendarOrderRow[]
  /** Pickups with no date — the other list every column's `+ Add` shows. */
  unscheduledPickups: CalendarPickupRow[]
  onPick: (orderId: string, dateKey: string) => void
  /** Places the chosen undated pickup on a day. */
  onPickPickup: (pickupId: string, dateKey: string) => void
  /** Opens a pickup's popup. */
  onSelectPickup: (pickup: CalendarPickupRow) => void
}

/** Everything one week's five columns need, forwarded verbatim from the strip. */
type WeekColumnsProps = Omit<WeekStripProps, 'weeks'> & { week: WeekGroup }

const NO_ROWS: CalendarOrderRow[] = []
const NO_PICKUPS: CalendarPickupRow[] = []

/**
 * The 2px rule marking a Fri│Mon boundary. The strip scrolls continuously
 * rather than snapping week to week, so without a hard divider the eye reads
 * ten columns as one long fortnight and loses the week as a unit of planning.
 */
function WeekDivider() {
  return <div aria-hidden="true" className="w-0.5 shrink-0 bg-border mx-2 my-1 rounded-full" />
}

function WeekColumns({
  week,
  rowsByDay,
  pickupsByDay,
  todayKey,
  unscheduled,
  unscheduledPickups,
  onPick,
  onPickPickup,
  onSelectPickup,
}: WeekColumnsProps) {
  return (
    <div className="flex gap-2 flex-1 min-h-0">
      {week.days.map((day) => {
        const dayKey = format(day, DB_DATE_FORMAT)
        return (
          <DayColumn
            key={dayKey}
            date={day}
            rows={rowsByDay.get(dayKey) ?? NO_ROWS}
            pickups={pickupsByDay.get(dayKey) ?? NO_PICKUPS}
            isToday={dayKey === todayKey}
            unscheduled={unscheduled}
            unscheduledPickups={unscheduledPickups}
            onPick={onPick}
            onPickPickup={onPickPickup}
            onSelectPickup={onSelectPickup}
          />
        )
      })}
    </div>
  )
}

/**
 * The horizontally scrolling run of week groups.
 *
 * Each week carries its own range label above its own five columns, so a
 * partially scrolled strip still tells you which week you are looking at —
 * a single header pinned above the whole strip would go stale the moment the
 * viewer scrolls past its week.
 *
 * Renders Mon–Fri only. There are no weekend columns anywhere in this product
 * (CONSTRAINT-19); `businessWeekDays` guarantees the five dates it hands over.
 *
 * @param weeks Week groups from `buildWeekGroups`, in chronological order.
 * @param rowsByDay Order cards bucketed by `yyyy-MM-dd`, from `groupRowsByDay`.
 * @param pickupsByDay Pickup cards bucketed the same way, from `groupPickupsByDay`.
 * @param todayKey The viewer's local today, or null before it is known.
 * @param unscheduled Forwarded to every column's `+ Add` order list.
 * @param unscheduledPickups Forwarded to every column's `+ Add` pickup list.
 * @param onPick Forwarded to each column's footer action.
 * @param onPickPickup Forwarded alongside it, for the pickup half of the menu.
 * @param onSelectPickup Forwarded to each column's pickup list.
 */
export default function WeekStrip({
  weeks,
  rowsByDay,
  pickupsByDay,
  todayKey,
  unscheduled,
  unscheduledPickups,
  onPick,
  onPickPickup,
  onSelectPickup,
}: WeekStripProps) {
  return (
    <div className="flex h-full pl-20 pr-4 pb-3">
      {weeks.map((week, index) => (
        <Fragment key={week.key}>
          {index > 0 && <WeekDivider />}
          <section
            data-testid="week-group"
            data-week={week.key}
            aria-label={`Week of ${week.label}`}
            className="flex flex-col h-full shrink-0"
          >
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 pb-2 shrink-0">
              {week.label}
            </h2>
            <WeekColumns
              week={week}
              rowsByDay={rowsByDay}
              pickupsByDay={pickupsByDay}
              todayKey={todayKey}
              unscheduled={unscheduled}
              unscheduledPickups={unscheduledPickups}
              onPick={onPick}
              onPickPickup={onPickPickup}
              onSelectPickup={onSelectPickup}
            />
          </section>
        </Fragment>
      ))}
    </div>
  )
}
