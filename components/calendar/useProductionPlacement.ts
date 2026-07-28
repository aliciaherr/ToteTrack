'use client'

import { useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  clearProductionPlacement,
  setProductionPlacement,
  toggleBackhaul,
  toggleSameDayDelivery,
} from '@/lib/actions/calendar'
import { useToast } from '@/lib/hooks/useToast'
import type { DropTarget } from './calendarDnd'

type ActionResult = { success: true } | { error: string }

// Matches the server actions' own fallback copy, for failures that never reach
// them at all.
const GENERIC_FAILURE_MESSAGE = 'Something went wrong. Please try again.'

/**
 * Runs a calendar mutation and reports the outcome, the same way for all three.
 *
 * There is no optimistic move (CONSTRAINT-02). Cards are drawn from server
 * data, so a rejected mutation leaves everything exactly where it started with
 * no rollback to perform — and a failure always surfaces a toast rather than
 * reverting silently, which would look identical to a gesture that never
 * registered.
 *
 * On success the route is refreshed rather than patched locally: the server
 * actions already `revalidatePath('/calendar')`, and re-reading is what keeps
 * the column a card renders in identical to the column the database filtered it
 * into (CONSTRAINT-19).
 */
function useCalendarMutation() {
  const router = useRouter()
  const { toast } = useToast()
  const [, startTransition] = useTransition()

  const run = useCallback(
    async (action: () => Promise<ActionResult>) => {
      let result: ActionResult
      try {
        result = await action()
      } catch (cause) {
        // Every caller fires this and discards the promise, so an uncaught
        // rejection — offline, action-transport failure, a stale action id
        // after a deploy — would be swallowed entirely: no toast, no log, the
        // card simply refuses to move with no way to tell that from a gesture
        // that never registered.
        console.error('useCalendarMutation: server action failed', { cause })
        toast(GENERIC_FAILURE_MESSAGE, 'error')
        return
      }

      if ('error' in result) {
        toast(result.error, 'error')
        return
      }

      startTransition(() => router.refresh())
    },
    [router, toast],
  )

  return { run }
}

/**
 * The four calendar mutations, wrapped for the client: place a card on a day,
 * clear its placement, and set either of the popup's two flags.
 */
export function useProductionPlacement() {
  const { run } = useCalendarMutation()

  const place = useCallback(
    ({ orderId, dateKey, index }: DropTarget) =>
      run(() => setProductionPlacement(orderId, { productionDate: dateKey, sortIndex: index })),
    [run],
  )

  /**
   * Clears a card's placement. The card leaves the calendar and appears in the
   * unscheduled callout, whatever its delivery date (CONSTRAINT-19).
   */
  const unschedule = useCallback(
    (orderId: string) => run(() => clearProductionPlacement(orderId)),
    [run],
  )

  /**
   * Sets the same-day-delivery flag. Takes the target state rather than
   * flipping, matching the server action — a double-fired click cannot toggle
   * twice.
   */
  const setSameDay = useCallback(
    (orderId: string, next: boolean) => run(() => toggleSameDayDelivery(orderId, next)),
    [run],
  )

  /**
   * Sets the backhaul flag. Target state, not a flip — same contract as
   * `setSameDay`, and permitted on completed and invoiced orders.
   */
  const setBackhaul = useCallback(
    (orderId: string, next: boolean) => run(() => toggleBackhaul(orderId, next)),
    [run],
  )

  return { place, unschedule, setSameDay, setBackhaul }
}
