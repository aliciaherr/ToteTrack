'use client'

import { createContext, useContext } from 'react'

/**
 * How long a search hit stays lit, in milliseconds.
 *
 * Long enough to find with the eye after the scroll settles, short enough that
 * it never reads as a permanent selection — the card is being pointed at, not
 * put into a state. Matches two runs of the 0.6s bloom in `globals.css`; change
 * both together or the ring outlives its own animation.
 */
export const HIGHLIGHT_DURATION_MS = 1200

/**
 * The PO number of the card search has just taken the viewer to, if any.
 *
 * Keyed by PO number rather than row id because that is what the viewer typed
 * and what the server resolves — and because `po_number` is `UNIQUE`, so it
 * identifies exactly one card, in a column or in the undated callout.
 *
 * A context for the same reason `cardSelection.tsx` is one: the search box is
 * in the header and the cards are four levels down, and every card needs to
 * know whether it is the one. A plain string rather than a setter pair — only
 * `useCalendarSearch` writes it, and it owns the timer that clears it.
 */
const CardHighlightContext = createContext<string | null>(null)

export const CardHighlightProvider = CardHighlightContext.Provider

/** True when this PO is the search hit currently lit. */
export function useIsHighlighted(poNumber: string): boolean {
  return useContext(CardHighlightContext) === poNumber
}
