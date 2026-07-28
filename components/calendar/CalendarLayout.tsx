'use client'

import { useCallback, useMemo, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import CalendarDndContext from './CalendarDndContext'
import NewOrderDrawer from './NewOrderDrawer'
import ProductionCardDialog from './ProductionCardDialog'
import UnscheduledCallout from './UnscheduledCallout'
import WeekStrip from './WeekStrip'
import { CardSelectionProvider } from './cardSelection'
import { NewOrderDayProvider } from './newOrderDay'
import { useWeekScroll } from './calendarScroll'
import { useProductionPlacement } from './useProductionPlacement'
import { buildWeekGroups, groupRowsByDay } from './calendarWeeks'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CustomerSelectOption } from '@/db/queries/customers'

interface CalendarLayoutProps {
  rows: CalendarOrderRow[]
  unscheduled: CalendarOrderRow[]
  /** Anchor week's Monday as `yyyy-MM-dd`, from `parseCalendarWeek`. */
  weekStart: string
  /** Active customers for the new-PO form's dropdown. */
  customers: CustomerSelectOption[]
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
  const { place, unschedule, setSameDay, setBackhaul } = useProductionPlacement()
  const [selectedId, setSelectedId] = useState<string | null>(null)

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

  // The popup holds an id, not a row object, and re-reads the row from props
  // every render. A popup mutation revalidates and refreshes, so pinning the
  // object would leave a pill showing the value it had before the click
  // (CONSTRAINT-02). A card that leaves the calendar takes its popup with it.
  const selectedRow = useMemo(
    () => draggableRows.find((row) => row.id === selectedId) ?? null,
    [draggableRows, selectedId],
  )
  const selectRow = useCallback((row: CalendarOrderRow) => setSelectedId(row.id), [])
  const closeDialog = useCallback(() => setSelectedId(null), [])

  return {
    place,
    unschedule,
    setSameDay,
    setBackhaul,
    selectedRow,
    selectRow,
    handlePick,
    draggableRows,
    closeDialog,
  }
}

/**
 * Which day column's `+ Add order → Add Purchase Order` is currently open, as a
 * `yyyy-MM-dd` key — and null when the drawer is shut. Its own hook rather than
 * another return value on `useCalendarActions` because it owns no mutation: the
 * write is `createOrder`, inside the form.
 */
function useNewOrderDay() {
  const [newOrderDay, setNewOrderDay] = useState<string | null>(null)
  const closeNewOrder = useCallback(() => setNewOrderDay(null), [])
  return { newOrderDay, setNewOrderDay, closeNewOrder }
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
 * @param customers Active customers for the new-PO form's dropdown.
 */
export default function CalendarLayout({
  rows,
  unscheduled,
  weekStart,
  customers,
}: CalendarLayoutProps) {
  const shouldReduceMotion = Boolean(useReducedMotion())
  const { stripRef, todayKey, goToCurrentWeek } = useWeekScroll(weekStart, shouldReduceMotion)
  const weeks = useMemo(() => buildWeekGroups(weekStart), [weekStart])
  const rowsByDay = useMemo(() => groupRowsByDay(rows), [rows])
  const {
    place,
    unschedule,
    setSameDay,
    setBackhaul,
    selectedRow,
    selectRow,
    handlePick,
    draggableRows,
    closeDialog,
  } = useCalendarActions(rows, unscheduled, rowsByDay)
  const { newOrderDay, setNewOrderDay, closeNewOrder } = useNewOrderDay()

  return (
    // 0.75rem is the `pt-3` AppShell puts above every authenticated route;
    // subtracting it is what makes the screen exactly one viewport tall so the
    // page itself never scrolls (CONSTRAINT-19). Same idiom as OrderLayout.
    <div className="h-[calc(100vh-0.75rem)] overflow-hidden flex flex-col bg-app-bg">
      <CalendarDndContext rows={draggableRows} onPlace={place} onUnschedule={unschedule}>
        <CardSelectionProvider value={selectRow}>
          <NewOrderDayProvider value={setNewOrderDay}>
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
          </NewOrderDayProvider>
        </CardSelectionProvider>
      </CalendarDndContext>

      <ProductionCardDialog
        open={selectedRow !== null}
        row={selectedRow}
        onClose={closeDialog}
        onToggleBackhaul={setBackhaul}
        onToggleSameDay={setSameDay}
        onRemove={unschedule}
      />

      <NewOrderDrawer
        productionDate={newOrderDay}
        customers={customers}
        onClose={closeNewOrder}
      />
    </div>
  )
}
