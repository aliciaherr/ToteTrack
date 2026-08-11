'use client'

import { createContext, useContext } from 'react'

/** Which of the calendar's two card groups are currently drawn. */
export interface CalendarVisibility {
  showOrders: boolean
  showPickups: boolean
  /** Flips the orders list. */
  toggleOrders: () => void
  /** Flips the pickups list. */
  togglePickups: () => void
}

/**
 * The opening state on **every** visit: orders on, pickups off (CONSTRAINT-25).
 *
 * Nothing persists it — not localStorage, not a URL param, not a cookie. This
 * app stores no client state anywhere, and two booleans are not the reason to
 * start; a salesperson who turned pickups on last Tuesday should still open the
 * calendar tomorrow on the production board they know.
 */
export const DEFAULT_CALENDAR_VISIBILITY = { showOrders: true, showPickups: false } as const

/**
 * Carries the two header toggles down to the day columns that obey them.
 *
 * A context rather than props for the same reason `cardSelection.tsx` is one:
 * the toggles live in the header and the lists they govern are four levels down
 * (`WeekStrip → DayColumn → ColumnBody → list`), so threading two booleans plus
 * their setters would add eight prop hops to reach one decision.
 *
 * The default is inert — the real defaults with no-op setters — so a column or
 * a card still renders outside a calendar (every existing `DayColumn` test does
 * exactly that) and behaves as it did before pickups existed.
 */
const PickupVisibilityContext = createContext<CalendarVisibility>({
  ...DEFAULT_CALENDAR_VISIBILITY,
  toggleOrders: () => {},
  togglePickups: () => {},
})

export const PickupVisibilityProvider = PickupVisibilityContext.Provider

/** The current group visibility. Orders-on / pickups-off outside a calendar. */
export function useCalendarVisibility(): CalendarVisibility {
  return useContext(PickupVisibilityContext)
}
