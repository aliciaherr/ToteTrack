'use client'

import { createContext, useContext } from 'react'

type StartOnDay = (dateKey: string) => void

/** The two "create a row on this day" handlers the day menu can fire. */
export interface NewCardDayValue {
  startNewOrder: StartOnDay
  startNewPickup: StartOnDay
}

/**
 * Carries "start a new PO on this day" and "start a new pickup on this day"
 * from `AddOrderMenu` up to `CalendarLayout`, which owns the two drawers the
 * forms render in.
 *
 * A context rather than props because the menu sits four levels below the
 * layout (`WeekStrip → DayColumn → ColumnFooter → AddOrderMenu`) and every hop
 * between is presentational. Threading two callbacks through all four would
 * make three components carry props they only forward, for one consumer — the
 * same trade `cardSelection` already resolved this way.
 *
 * One context holding both starters rather than two contexts: they are opened
 * by the same menu, on the same day, and a second provider would double the
 * wrapping in `CalendarLayout` for no separation that anything reads.
 *
 * The day is passed as a `yyyy-MM-dd` key rather than a `Date` because that is
 * exactly what the two create actions store (CONSTRAINT-19 / CONSTRAINT-25).
 *
 * Defaults to no-ops so the menu still renders outside a calendar (the day
 * column tests do exactly that).
 */
const NewCardDayContext = createContext<NewCardDayValue>({
  startNewOrder: () => {},
  startNewPickup: () => {},
})

export const NewOrderDayProvider = NewCardDayContext.Provider

/** The current "open the new-PO form on this day" handler. A no-op outside a calendar. */
export function useStartNewOrder(): StartOnDay {
  return useContext(NewCardDayContext).startNewOrder
}

/** The current "open the new-pickup form on this day" handler. A no-op outside a calendar. */
export function useStartNewPickup(): StartOnDay {
  return useContext(NewCardDayContext).startNewPickup
}
