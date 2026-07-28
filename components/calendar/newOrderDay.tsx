'use client'

import { createContext, useContext } from 'react'

type StartNewOrder = (dateKey: string) => void

/**
 * Carries "start a new PO on this day" from `AddOrderMenu` up to
 * `CalendarLayout`, which owns the drawer the form renders in.
 *
 * A context rather than a prop because the menu sits four levels below the
 * layout (`WeekStrip → DayColumn → ColumnFooter → AddOrderMenu`) and every hop
 * between is presentational. Threading a callback through all four would make
 * three components carry a prop they only forward, for one consumer — the same
 * trade `cardSelection` already resolved this way.
 *
 * The day is passed as a `yyyy-MM-dd` key rather than a `Date` because that is
 * exactly what `createOrder` stores in `production_date` (CONSTRAINT-19).
 *
 * Defaults to a no-op so the menu still renders outside a calendar (the day
 * column tests do exactly that).
 */
const NewOrderDayContext = createContext<StartNewOrder>(() => {})

export const NewOrderDayProvider = NewOrderDayContext.Provider

/** The current "open the new-PO form on this day" handler. A no-op outside a calendar. */
export function useStartNewOrder(): StartNewOrder {
  return useContext(NewOrderDayContext)
}
