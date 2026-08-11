'use client'

import { useMemo } from 'react'
import { useReducedMotion } from 'framer-motion'
import CalendarBoard from './CalendarBoard'
import CalendarDndContext from './CalendarDndContext'
import CalendarOverlays from './CalendarOverlays'
import { ArmModeProvider, useArmModeState } from './armMode'
import { CardSelectionProvider } from './cardSelection'
import { NewOrderDayProvider } from './newOrderDay'
import { PickupVisibilityProvider } from './pickupVisibility'
import {
  useCalendarActions,
  useCalendarVisibilityState,
  useNewCardDay,
  usePickupCalendarActions,
} from './calendarLayoutHooks'
import { useGroupedPlacement } from './usePickupPlacement'
import { groupPickupsByDay, groupRowsByDay } from './calendarWeeks'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'
import type { CustomerSelectOption } from '@/db/queries/customers'

interface CalendarLayoutProps {
  rows: CalendarOrderRow[]
  unscheduled: CalendarOrderRow[]
  /** Placed pickups for the fetched range — the second list in each column. */
  pickups: CalendarPickupRow[]
  /** Pickups with no date, for the header's undated callout. */
  unscheduledPickups: CalendarPickupRow[]
  /** Anchor week's Monday as `yyyy-MM-dd`, from `parseCalendarWeek`. */
  weekStart: string
  /** Active customers for the new-PO form's dropdown. */
  customers: CustomerSelectOption[]
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
 * The root `onClick` is Task 68's cancel-anywhere: a tap that no placement
 * target claimed bubbles here and disarms. Placement taps disarm before their
 * click finishes bubbling, so by the time such a click arrives `cancel` is a
 * no-op — nothing needs `stopPropagation`, and scrolling never produces a
 * click at all, which is what keeps the armed state alive across a scroll to
 * a distant week.
 *
 * The screen hosts **two** independent card groups (CONSTRAINT-25): orders and
 * pickups, each with its own query, its own per-day ordering, its own popup and
 * its own header toggle. Nothing crosses between them.
 *
 * The root height is `calc(100svh-0.75rem)`: 0.75rem is the `pt-3` AppShell puts
 * above every authenticated route, and subtracting it is what makes the screen
 * exactly one viewport tall. `svh`, not `vh` (CONSTRAINT-23): on iOS `100vh` is
 * the *large* viewport — browser chrome hidden — so with the tab bar showing the
 * page would be toolbar-height too tall and need one nudge of scroll before it
 * settled. `svh` is the viewport in the state the screen actually opens in.
 *
 * @param rows Placed orders for the fetched range, each carrying its `production_date`.
 * @param unscheduled Orders with no production date — the callout and every `+ Add order` list.
 * @param pickups Placed pickups for the fetched range, each carrying its `pickup_date`.
 * @param unscheduledPickups Pickups with no date — the header's undated callout.
 * @param weekStart Anchor week's Monday as `yyyy-MM-dd`.
 * @param customers Active customers for the new-PO form's dropdown.
 */
export default function CalendarLayout({
  rows,
  unscheduled,
  pickups,
  unscheduledPickups,
  weekStart,
  customers,
}: CalendarLayoutProps) {
  const shouldReduceMotion = Boolean(useReducedMotion())
  const rowsByDay = useMemo(() => groupRowsByDay(rows), [rows])
  const pickupsByDay = useMemo(() => groupPickupsByDay(pickups), [pickups])
  const visibility = useCalendarVisibilityState()
  // One placement instance for the whole screen. Every gesture — drag, armed
  // tap, day menu, popup — routes through its `group` discriminator, so the
  // choice of table is made in exactly one place (CONSTRAINT-25).
  const placement = useGroupedPlacement()
  const orders = useCalendarActions(rows, unscheduled, rowsByDay, placement)
  const pickupActions = usePickupCalendarActions(
    pickups,
    unscheduledPickups,
    pickupsByDay,
    placement,
  )
  const { newOrderDay, newPickupDay, starters, closeNewOrder, closeNewPickup } = useNewCardDay()
  const armMode = useArmModeState(placement.place, placement.unschedule, shouldReduceMotion)

  return (
    <div
      className="h-[calc(100svh-0.75rem)] overflow-hidden flex flex-col bg-app-bg"
      onClick={armMode.cancel}
    >
      <CalendarDndContext
        rows={orders.draggableRows}
        pickups={pickupActions.allPickups}
        onPlace={placement.place}
        onUnschedule={placement.unschedule}
      >
        <ArmModeProvider value={armMode}>
          <CardSelectionProvider value={orders.selectRow}>
            <PickupVisibilityProvider value={visibility}>
              <NewOrderDayProvider value={starters}>
                <CalendarBoard
                  rowsByDay={rowsByDay}
                  pickupsByDay={pickupsByDay}
                  unscheduled={unscheduled}
                  unscheduledPickups={unscheduledPickups}
                  weekStart={weekStart}
                  shouldReduceMotion={shouldReduceMotion}
                  onPick={orders.handlePick}
                  onPickPickup={pickupActions.handlePickPickup}
                  onSelectPickup={pickupActions.selectPickup}
                />
              </NewOrderDayProvider>
            </PickupVisibilityProvider>
          </CardSelectionProvider>
        </ArmModeProvider>
      </CalendarDndContext>

      <CalendarOverlays
        selectedRow={orders.selectedRow}
        onCloseRow={orders.closeDialog}
        onToggleBackhaul={placement.setBackhaul}
        onToggleSameDay={placement.setSameDay}
        onRemoveRow={placement.unscheduleOrder}
        selectedPickup={pickupActions.selectedPickup}
        onClosePickup={pickupActions.closePickupDialog}
        onRemovePickup={pickupActions.removeFromCalendar}
        newOrderDay={newOrderDay}
        newPickupDay={newPickupDay}
        onCloseNewOrder={closeNewOrder}
        onCloseNewPickup={closeNewPickup}
        customers={customers}
      />
    </div>
  )
}
