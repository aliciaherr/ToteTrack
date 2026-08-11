'use client'

import { useCallback, useMemo } from 'react'
import { clearPickupPlacement, setPickupPlacement } from '@/lib/actions/pickups.calendar'
import { useCalendarMutation, useProductionPlacement } from './useProductionPlacement'
import type { DropTarget, UnscheduleTarget } from './calendarDnd'

/**
 * The two pickup placement mutations, wrapped for the client: place a card on a
 * day, and clear its date.
 *
 * A parallel hook rather than two more members of `useProductionPlacement`,
 * mirroring the two server modules and the two tables (CONSTRAINT-25). It
 * shares `useCalendarMutation`, so a failed pickup write toasts and logs
 * exactly like a failed order write instead of growing a second error
 * convention.
 */
export function usePickupPlacement() {
  const { run } = useCalendarMutation()

  const place = useCallback(
    ({ cardId, dateKey, index }: DropTarget) =>
      run(() =>
        // `group` travels with the payload so the server can reject an
        // order-shaped call outright, rather than relying on the client having
        // routed correctly.
        setPickupPlacement(cardId, { group: 'pickup', pickupDate: dateKey, sortIndex: index }),
      ),
    [run],
  )

  /**
   * Clears a pickup's date. The card leaves the calendar and appears in the
   * undated callout. Clears `sort_index` too, so a pickup placed again later
   * cannot inherit a position from the column it used to sit in.
   */
  const unschedule = useCallback(
    (pickupId: string) => run(() => clearPickupPlacement(pickupId)),
    [run],
  )

  return { place, unschedule }
}

/**
 * The one place a calendar gesture chooses which table it writes to.
 *
 * Drag and armed-tap both resolve to a target carrying its own `group`
 * (CONSTRAINT-25), so every caller above this — `CalendarDndContext`,
 * `useArmModeState`, the day columns — stays group-agnostic and cannot route a
 * pickup into an order mutation by omission. The switch exists exactly once,
 * here, where it is visible.
 *
 * The order half also returns the popup's two flag setters, which have no
 * pickup counterpart: a pickup carries neither backhaul nor same-day delivery.
 */
export function useGroupedPlacement() {
  const orders = useProductionPlacement()
  const pickups = usePickupPlacement()

  const place = useCallback(
    (target: DropTarget) => {
      if (target.group === 'pickup') {
        void pickups.place(target)
        return
      }
      void orders.place(target)
    },
    [orders, pickups],
  )

  const unschedule = useCallback(
    (target: UnscheduleTarget) => {
      if (target.group === 'pickup') {
        void pickups.unschedule(target.cardId)
        return
      }
      void orders.unschedule(target.cardId)
    },
    [orders, pickups],
  )

  return useMemo(
    () => ({
      place,
      unschedule,
      placeOrder: orders.place,
      unscheduleOrder: orders.unschedule,
      placePickup: pickups.place,
      unschedulePickup: pickups.unschedule,
      setSameDay: orders.setSameDay,
      setBackhaul: orders.setBackhaul,
    }),
    [place, unschedule, orders, pickups],
  )
}

/**
 * Every calendar mutation the screen can fire, from one `useGroupedPlacement`
 * instance. Threaded through `CalendarLayout` rather than re-derived per hook,
 * so both groups share a single `useCalendarMutation` and cannot grow two
 * error, toast or refresh conventions.
 */
export type GroupedPlacement = ReturnType<typeof useGroupedPlacement>
