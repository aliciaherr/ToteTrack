'use client'

import { createContext, useContext } from 'react'

/** The three views the calendar's single header control cycles between. */
export type CalendarView = 'orders' | 'pickups' | 'both'

/**
 * Cycle order for the header control, and the only place it is written down.
 *
 * Orders first because that is what the calendar opens on and what it mostly
 * is; `both` last so the common Orders → Both move is one tap away in each
 * direction (one forward, one more to wrap).
 *
 * There is deliberately **no** "neither" view (CONSTRAINT-25, amended by Task
 * 93). Two independent toggles used to make both-off reachable and every day
 * column drew an explicit "lists hidden" message for it, but nobody opens a
 * calendar to see no cards — it was a state the old control *permitted*, never
 * one it was designed for. A fourth stop would be tapped through on every loop
 * to reach a blank grid.
 */
export const CALENDAR_VIEW_ORDER: readonly CalendarView[] = ['orders', 'pickups', 'both']

/** Human label for each view — the cycle pill's face. */
export const CALENDAR_VIEW_LABELS: Record<CalendarView, string> = {
  orders: 'Orders',
  pickups: 'Pickups',
  both: 'Both',
}

/**
 * The opening view on **every** visit: orders (CONSTRAINT-25).
 *
 * Nothing persists it — not localStorage, not a URL param, not a cookie. This
 * app stores no client state anywhere, and one enum is not the reason to start;
 * a salesperson who switched to pickups last Tuesday should still open the
 * calendar tomorrow on the production board they know.
 */
export const DEFAULT_CALENDAR_VIEW: CalendarView = 'orders'

/** Which of the calendar's two card groups are currently drawn. */
export interface CalendarVisibility {
  /** The current view — what the header pill shows. */
  view: CalendarView
  showOrders: boolean
  showPickups: boolean
  /** Advances to the next view, wrapping at the end of `CALENDAR_VIEW_ORDER`. */
  cycleView: () => void
  /**
   * Jumps straight to a view, skipping the cycle.
   *
   * Search is the only caller: finding an order while the view is on pickups
   * has to reveal orders before there is a card to scroll to (Task 93).
   */
  setView: (view: CalendarView) => void
}

/**
 * The two booleans a view implies.
 *
 * The view is the state, but the booleans stay the currency: `DayColumn` and
 * every column test ask "is this group drawn", never "which view is this", so
 * a view that could not answer in booleans would push the enum four levels
 * down the tree for no gain.
 */
export function visibilityForView(view: CalendarView): {
  showOrders: boolean
  showPickups: boolean
} {
  return {
    showOrders: view === 'orders' || view === 'both',
    showPickups: view === 'pickups' || view === 'both',
  }
}

/** The view that follows `view`, wrapping past the last one. */
export function nextCalendarView(view: CalendarView): CalendarView {
  const index = CALENDAR_VIEW_ORDER.indexOf(view)
  return CALENDAR_VIEW_ORDER[(index + 1) % CALENDAR_VIEW_ORDER.length]
}

/** The flags the calendar opens with, derived so they cannot drift. */
export const DEFAULT_CALENDAR_VISIBILITY = visibilityForView(DEFAULT_CALENDAR_VIEW)

/**
 * Carries the header's view control down to the day columns that obey it.
 *
 * A context rather than props for the same reason `cardSelection.tsx` is one:
 * the control lives in the header and the lists it governs are four levels down
 * (`WeekStrip → DayColumn → ColumnBody → list`), so threading the state plus
 * its setters would add prop hops to reach one decision.
 *
 * The default is inert — the real default view with no-op setters — so a column
 * or a card still renders outside a calendar (every existing `DayColumn` test
 * does exactly that) and behaves as it did before pickups existed.
 */
const PickupVisibilityContext = createContext<CalendarVisibility>({
  view: DEFAULT_CALENDAR_VIEW,
  ...DEFAULT_CALENDAR_VISIBILITY,
  cycleView: () => {},
  setView: () => {},
})

export const PickupVisibilityProvider = PickupVisibilityContext.Provider

/** The current group visibility. The default view outside a calendar. */
export function useCalendarVisibility(): CalendarVisibility {
  return useContext(PickupVisibilityContext)
}
