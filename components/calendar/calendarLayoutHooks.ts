'use client'

import { useCallback, useMemo, useState } from 'react'
import { useProductionPlacement } from './useProductionPlacement'
import type { CalendarOrderRow } from '@/db/queries/calendar'

// `CalendarLayout`'s state hooks, split out to keep that file within the
// 200-line component cap (CQ-02) when Task 68 added arm-mode wiring. Same
// sibling-hooks idiom as `productionCardDialogHooks.ts`.

/**
 * The mutations the screen can trigger, plus the popup's selection state.
 *
 * Grouped here so `CalendarLayout` stays a composition root: it wires children
 * together and owns nothing else.
 */
export function useCalendarActions(
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
export function useNewOrderDay() {
  const [newOrderDay, setNewOrderDay] = useState<string | null>(null)
  const closeNewOrder = useCallback(() => setNewOrderDay(null), [])
  return { newOrderDay, setNewOrderDay, closeNewOrder }
}
