'use client'

import { Fragment } from 'react'
import { format } from 'date-fns'
import DayColumn from './DayColumn'
import { DB_DATE_FORMAT } from '@/lib/dates'
import type { WeekGroup } from './calendarWeeks'
import type { CalendarOrderRow } from '@/db/queries/calendar'

interface WeekStripProps {
  weeks: WeekGroup[]
  rowsByDay: Map<string, CalendarOrderRow[]>
  /** `yyyy-MM-dd` for the viewer's local today, or null before hydration. */
  todayKey: string | null
  /** Orders with no production date — every column's `+ Add order` shows this set. */
  unscheduled: CalendarOrderRow[]
  onPick: (orderId: string, dateKey: string) => void
}

const NO_ROWS: CalendarOrderRow[] = []

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
  todayKey,
  unscheduled,
  onPick,
}: {
  week: WeekGroup
  rowsByDay: Map<string, CalendarOrderRow[]>
  todayKey: string | null
  unscheduled: CalendarOrderRow[]
  onPick: (orderId: string, dateKey: string) => void
}) {
  return (
    <div className="flex gap-2 flex-1 min-h-0">
      {week.days.map((day) => {
        const dayKey = format(day, DB_DATE_FORMAT)
        return (
          <DayColumn
            key={dayKey}
            date={day}
            rows={rowsByDay.get(dayKey) ?? NO_ROWS}
            isToday={dayKey === todayKey}
            unscheduled={unscheduled}
            onPick={onPick}
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
 * @param rowsByDay Cards bucketed by `yyyy-MM-dd`, from `groupRowsByDay`.
 * @param todayKey The viewer's local today, or null before it is known.
 * @param unscheduled Forwarded to every column's `+ Add order` list.
 * @param onPick Forwarded to each column's footer action.
 */
export default function WeekStrip({
  weeks,
  rowsByDay,
  todayKey,
  unscheduled,
  onPick,
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
              todayKey={todayKey}
              unscheduled={unscheduled}
              onPick={onPick}
            />
          </section>
        </Fragment>
      ))}
    </div>
  )
}
