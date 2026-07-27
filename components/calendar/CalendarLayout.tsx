'use client'

import { useCallback, useMemo, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import CalendarDndContext from './CalendarDndContext'
import ProductionCardDialog from './ProductionCardDialog'
import UnscheduledCallout from './UnscheduledCallout'
import WeekStrip from './WeekStrip'
import { CardSelectionProvider } from './cardSelection'
import { useWeekScroll } from './calendarScroll'
import { useProductionPlacement } from './useProductionPlacement'
import { buildWeekGroups, groupRowsByDay } from './calendarWeeks'
import type { CalendarOrderRow } from '@/db/queries/calendar'

interface CalendarLayoutProps {
  rows: CalendarOrderRow[]
  unscheduled: CalendarOrderRow[]
  /** Anchor week's Monday as `yyyy-MM-dd`, from `parseCalendarWeek`. */
  weekStart: string
}

function CalendarHeader({
  unscheduled,
  onCurrentWeek,
}: {
  unscheduled: CalendarOrderRow[]
  onCurrentWeek: () => void
}) {
  return (
    <div className="pl-20 pr-4 pt-4 pb-3 border-b border-border bg-card shrink-0 flex items-center justify-between gap-3">
      <h1 className="text-lg font-semibold text-foreground">Production Calendar</h1>
      <div className="flex items-center gap-3">
        <UnscheduledCallout rows={unscheduled} />
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

/**
 * The mutations the screen can trigger, plus the popup's selection state.
 *
 * Grouped here so `CalendarLayout` stays a composition root: it wires children
 * together and owns nothing else.
 */
function useCalendarActions(
  rows: CalendarOrderRow[],
  unscheduled: CalendarOrderRow[],
  rowsByDay: Map<string, CalendarOrderRow[]>,
) {
  const { place, unschedule, setSameDay } = useProductionPlacement()
  const [selectedRow, setSelectedRow] = useState<CalendarOrderRow | null>(null)

  // Picking an order from a day's `+ Add order` list places it at the end of
  // that column — there is no released position to honour, unlike a drag.
  const handlePick = useCallback(
    (orderId: string, dateKey: string) => {
      const index = rowsByDay.get(dateKey)?.length ?? 0
      void place({ orderId, dateKey, index })
    },
    [place, rowsByDay],
  )

  // Every draggable card on screen, so the drag overlay can resolve one lifted
  // out of the unscheduled dropdown as well as one lifted from a column.
  const draggableRows = useMemo(() => [...rows, ...unscheduled], [rows, unscheduled])
  const closeDialog = useCallback(() => setSelectedRow(null), [])

  return {
    place,
    unschedule,
    setSameDay,
    selectedRow,
    setSelectedRow,
    handlePick,
    draggableRows,
    closeDialog,
  }
}

/**
 * The production calendar screen.
 *
 * Exactly one viewport tall and never scrolling as a page (CONSTRAINT-19):
 * `overflow-hidden` on the root, and only the week strip (horizontally) and
 * individual day columns (vertically) scroll. Column height therefore falls out
 * of the viewport through a `flex` / `min-h-0` chain rather than any pixel
 * value, which is what lets the card-scaling system in `globals.css` decide how
 * many cards fit instead of a hardcoded height deciding it.
 *
 * @param rows Placed orders for the fetched range, each carrying its `production_date`.
 * @param unscheduled Orders with no production date — the callout and every `+ Add order` list.
 * @param weekStart Anchor week's Monday as `yyyy-MM-dd`.
 */
export default function CalendarLayout({ rows, unscheduled, weekStart }: CalendarLayoutProps) {
  const shouldReduceMotion = Boolean(useReducedMotion())
  const { stripRef, todayKey, goToCurrentWeek } = useWeekScroll(weekStart, shouldReduceMotion)
  const weeks = useMemo(() => buildWeekGroups(weekStart), [weekStart])
  const rowsByDay = useMemo(() => groupRowsByDay(rows), [rows])
  const {
    place,
    unschedule,
    setSameDay,
    selectedRow,
    setSelectedRow,
    handlePick,
    draggableRows,
    closeDialog,
  } = useCalendarActions(rows, unscheduled, rowsByDay)

  return (
    // 0.75rem is the `pt-3` AppShell puts above every authenticated route;
    // subtracting it is what makes the screen exactly one viewport tall so the
    // page itself never scrolls (CONSTRAINT-19). Same idiom as OrderLayout.
    <div className="h-[calc(100vh-0.75rem)] overflow-hidden flex flex-col bg-app-bg">
      <CalendarDndContext rows={draggableRows} onPlace={place} onUnschedule={unschedule}>
        <CardSelectionProvider value={setSelectedRow}>
          <CalendarHeader unscheduled={unscheduled} onCurrentWeek={goToCurrentWeek} />
          <div
            ref={stripRef}
            data-testid="week-strip-scroll"
            className="calendar-scroll calendar-scroll-strip flex-1 min-h-0 overflow-x-auto overflow-y-hidden pt-3"
          >
            <WeekStrip
              weeks={weeks}
              rowsByDay={rowsByDay}
              todayKey={todayKey}
              unscheduled={unscheduled}
              onPick={handlePick}
            />
          </div>
        </CardSelectionProvider>
      </CalendarDndContext>

      <ProductionCardDialog
        open={selectedRow !== null}
        row={selectedRow}
        onClose={closeDialog}
        onToggleSameDay={setSameDay}
        onRemove={unschedule}
      />
    </div>
  )
}
