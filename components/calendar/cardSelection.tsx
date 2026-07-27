'use client'

import { createContext, useContext } from 'react'
import type { CalendarOrderRow } from '@/db/queries/calendar'

type SelectCard = (row: CalendarOrderRow) => void

/**
 * Carries "open this card's popup" from `CalendarLayout` down to
 * `SortableProductionCard`.
 *
 * A context rather than a prop because the two surfaces that render cards sit
 * at different depths — day columns are four levels down
 * (`WeekStrip → DayColumn → ColumnBody → card`) while the unscheduled dropdown
 * is two — and `SortableProductionCard` is the single consumer either way.
 * Threading a third callback through both chains would add six prop hops to
 * reach one component.
 *
 * Defaults to a no-op so a card can still render outside a calendar (the
 * existing `ProductionCard` tests do exactly that).
 */
const CardSelectionContext = createContext<SelectCard>(() => {})

export const CardSelectionProvider = CardSelectionContext.Provider

/** The current "open the popup" handler. A no-op outside a calendar. */
export function useSelectCard(): SelectCard {
  return useContext(CardSelectionContext)
}
