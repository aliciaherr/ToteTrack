'use client'

import { useCallback, useMemo, useState } from 'react'
import { DEFAULT_CALENDAR_VISIBILITY, type CalendarVisibility } from './pickupVisibility'
import type { GroupedPlacement } from './usePickupPlacement'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

// `CalendarLayout`'s state hooks, split out to keep that file within the
// 200-line component cap (CQ-02) when Task 68 added arm-mode wiring. Same
// sibling-hooks idiom as `productionCardDialogHooks.ts`.

/**
 * The order half of the screen: the popup's selection state and the one
 * placement gesture the day menu owns.
 *
 * Grouped here so `CalendarLayout` stays a composition root: it wires children
 * together and owns nothing else.
 *
 * @param rows Placed orders for the fetched range.
 * @param unscheduled Orders with no production date.
 * @param rowsByDay Orders bucketed by day — the pick handler needs each column's length.
 * @param placement The screen's single `useGroupedPlacement` instance.
 */
export function useCalendarActions(
  rows: CalendarOrderRow[],
  unscheduled: CalendarOrderRow[],
  rowsByDay: Map<string, CalendarOrderRow[]>,
  placement: GroupedPlacement,
) {
  const { placeOrder } = placement
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Picking an order from a day's `+ Add` list places it at the end of that
  // column — there is no released position to honour, unlike a drag. The
  // explicit `group: 'order'` is what routes it to the orders table; the count
  // is that column's **orders** list only, never the two lists combined
  // (CONSTRAINT-25).
  const handlePick = useCallback(
    (orderId: string, dateKey: string) => {
      const index = rowsByDay.get(dateKey)?.length ?? 0
      void placeOrder({ group: 'order', cardId: orderId, dateKey, index })
    },
    [placeOrder, rowsByDay],
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

  return { selectedRow, selectRow, handlePick, draggableRows, closeDialog }
}

/**
 * The two header toggles, held in plain component state.
 *
 * Deliberately not persisted anywhere — every visit opens orders-on /
 * pickups-off (CONSTRAINT-25). Mounting the calendar *is* the reset, so there
 * is no reset code to get wrong.
 */
export function useCalendarVisibilityState(): CalendarVisibility {
  const [showOrders, setShowOrders] = useState<boolean>(DEFAULT_CALENDAR_VISIBILITY.showOrders)
  const [showPickups, setShowPickups] = useState<boolean>(DEFAULT_CALENDAR_VISIBILITY.showPickups)

  const toggleOrders = useCallback(() => setShowOrders((current) => !current), [])
  const togglePickups = useCallback(() => setShowPickups((current) => !current), [])

  return useMemo(
    () => ({ showOrders, showPickups, toggleOrders, togglePickups }),
    [showOrders, showPickups, toggleOrders, togglePickups],
  )
}

/**
 * The pickup half of the screen: which pickup's popup is open, the day-menu
 * placement gesture, and the one popup mutation that is not a status change.
 *
 * Like the order popup, this holds an **id** and re-derives the row from props
 * on every render, so a status write that revalidates and refreshes can never
 * leave a stale snapshot on screen, and a pickup that leaves the calendar
 * (cancelled) takes its popup with it (CONSTRAINT-02).
 *
 * `removeFromCalendar` is now `clearPickupPlacement`, which nulls `pickup_date`
 * **and** `sort_index` in one statement. It supersedes Task 80's shortcut of
 * resending the whole editable row through `updatePickup` (INFO-05) — that path
 * was last-write-wins against a concurrent Pickups-tab edit and left a stale
 * index pointing at a column the pickup no longer sat in, which the pickup
 * would then inherit the next time it was placed.
 *
 * @param pickups Placed pickups for the fetched range.
 * @param unscheduledPickups Pickups with no date — the callout's set.
 * @param pickupsByDay Pickups bucketed by day — the pick handler needs each column's length.
 * @param placement The screen's single `useGroupedPlacement` instance.
 */
export function usePickupCalendarActions(
  pickups: CalendarPickupRow[],
  unscheduledPickups: CalendarPickupRow[],
  pickupsByDay: Map<string, CalendarPickupRow[]>,
  placement: GroupedPlacement,
) {
  const { placePickup, unschedulePickup } = placement
  const [selectedPickupId, setSelectedPickupId] = useState<string | null>(null)

  // Every draggable pickup on screen, so the drag overlay can resolve one
  // lifted out of the undated callout as well as one lifted from a column.
  const allPickups = useMemo(
    () => [...pickups, ...unscheduledPickups],
    [pickups, unscheduledPickups],
  )
  const selectedPickup = useMemo(
    () => allPickups.find((pickup) => pickup.id === selectedPickupId) ?? null,
    [allPickups, selectedPickupId],
  )

  const selectPickup = useCallback((pickup: CalendarPickupRow) => {
    setSelectedPickupId(pickup.id)
  }, [])
  const closePickupDialog = useCallback(() => setSelectedPickupId(null), [])

  // The pickups list's counterpart to `handlePick`, and deliberately its mirror
  // image: append to the end of **this group's** list on that day.
  const handlePickPickup = useCallback(
    (pickupId: string, dateKey: string) => {
      const index = pickupsByDay.get(dateKey)?.length ?? 0
      void placePickup({ group: 'pickup', cardId: pickupId, dateKey, index })
    },
    [placePickup, pickupsByDay],
  )

  return {
    allPickups,
    selectedPickup,
    selectPickup,
    closePickupDialog,
    handlePickPickup,
    removeFromCalendar: unschedulePickup,
  }
}

/**
 * Which day column's `+ Add → Add Purchase Order` / `Add Pickup` is currently
 * open, as a `yyyy-MM-dd` key — and null when that drawer is shut. Its own hook
 * rather than another return value on `useCalendarActions` because it owns no
 * mutation: the writes are `createOrder` and `createPickup`, inside the forms.
 *
 * Two independent days rather than one plus a kind, so the two drawers cannot
 * both believe they are open, and closing one cannot clear the other.
 */
export function useNewCardDay() {
  const [newOrderDay, setNewOrderDay] = useState<string | null>(null)
  const [newPickupDay, setNewPickupDay] = useState<string | null>(null)

  const closeNewOrder = useCallback(() => setNewOrderDay(null), [])
  const closeNewPickup = useCallback(() => setNewPickupDay(null), [])

  const starters = useMemo(
    () => ({ startNewOrder: setNewOrderDay, startNewPickup: setNewPickupDay }),
    [],
  )

  return { newOrderDay, newPickupDay, starters, closeNewOrder, closeNewPickup }
}
