'use client'

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { scrollWeekIntoView } from './calendarScroll'
import { HIGHLIGHT_DURATION_MS } from './cardHighlight'
import { useCalendarVisibility } from './pickupVisibility'
import { weekKeyFor } from './calendarWeeks'
import type { CalendarOrderRow } from '@/db/queries/calendar'

// The second half of calendar search (Task 93): given a PO number that is
// already known to exist on the client, put it in front of the viewer. Split
// from `useCalendarSearch.ts`, which decides *which* PO — the two answer
// different questions and neither reads the other's state.

/**
 * How long to wait for a searched card to appear in the DOM before giving up.
 *
 * A reveal that crosses a week boundary waits on a server navigation and a
 * re-render, so it cannot be resolved in the submit handler. This bounds that
 * wait: past it the viewer gets a message instead of a search box that looks
 * like it is still thinking. Generous enough to cover a slow fetch, short
 * enough that nobody stares at it.
 */
const REVEAL_TIMEOUT_MS = 6000

/**
 * Gap between attempts to find the card while a reveal is pending.
 *
 * Short enough to feel immediate once the card mounts, long enough that a slow
 * navigation costs a handful of checks rather than one per frame.
 */
const REVEAL_RETRY_MS = 50

export interface CardReveal {
  /** Puts `poNumber` in front of the viewer, once it is on screen to be found. */
  reveal: (poNumber: string, isUndated: boolean) => void
  /** PO number currently lit, for `CardHighlightProvider`. */
  highlightedPo: string | null
  /** Bumped when the card lives in the undated callout, to open it. */
  undatedSignal: number
  /** Set when a reveal ran out of time without finding its card. */
  failure: string | null
  /** Drops a pending reveal and its highlight — the search box closing. */
  clear: () => void
}

/**
 * Finds the rendered card for a PO number.
 *
 * Walks the nodes and compares attribute values rather than building a
 * `[data-po-number="..."]` selector, because a PO number is free text: a quote
 * or a bracket in one would break the selector, and `CSS.escape` is not in
 * every environment this runs in — jsdom included. There is one node per
 * visible card, so the walk is cheap.
 */
function findCardElement(poNumber: string): HTMLElement | null {
  const cards = document.querySelectorAll<HTMLElement>('[data-po-number]')
  for (const card of cards) {
    if (card.getAttribute('data-po-number') === poNumber) return card
  }
  return null
}

interface UseCardRevealArgs {
  /** Every order the client holds, for resolving the hit's week. */
  byPoNumber: Map<string, CalendarOrderRow>
  /** The week strip, for the horizontal scroll to the hit's week. */
  stripRef: RefObject<HTMLDivElement | null>
  shouldReduceMotion: boolean
  /** `?find=` from the URL — a hit that arrived via a cross-week navigation. */
  findOnMount: string | null
}

/**
 * Scroll-to-and-light for one card.
 *
 * A reveal cannot complete in the handler that starts it: getting to the card
 * may first require switching the view, expanding the undated callout, or a
 * whole server navigation, and none of those have rendered by the time that
 * handler returns. So a reveal is queued, and an effect resolves it once the
 * card exists.
 *
 * The effect re-runs on a short beat rather than waiting on a dependency
 * change, because the card can appear for reasons that change none of its
 * dependencies — the view switching and the callout expanding both do exactly
 * that. It gives up loudly at `REVEAL_TIMEOUT_MS`: a reveal that never lands is
 * a bug, and a search box that silently stays busy is how it would hide.
 */
export function useCardReveal({
  byPoNumber,
  stripRef,
  shouldReduceMotion,
  findOnMount,
}: UseCardRevealArgs): CardReveal {
  const { showOrders, setView } = useCalendarVisibility()
  const [highlightedPo, setHighlightedPo] = useState<string | null>(null)
  const [undatedSignal, setUndatedSignal] = useState(0)
  const [failure, setFailure] = useState<string | null>(null)
  const [pendingPo, setPendingPo] = useState<string | null>(null)
  const [revealTick, setRevealTick] = useState(0)
  const startedAt = useRef<number>(0)

  /**
   * Switching to the orders view is unconditional when orders are hidden: the
   * viewer typed a PO number and pressed Enter, which is an unambiguous request
   * to see that order. Refusing until they fix the view themselves would be a
   * search saying no to a question it can answer.
   */
  const reveal = useCallback(
    (poNumber: string, isUndated: boolean) => {
      setFailure(null)
      if (!showOrders) setView('orders')
      if (isUndated) setUndatedSignal((current) => current + 1)
      startedAt.current = Date.now()
      setPendingPo(poNumber)
    },
    [setView, showOrders],
  )

  const clear = useCallback(() => {
    setPendingPo(null)
    setHighlightedPo(null)
    setFailure(null)
  }, [])

  // A hit that arrived through `?find=`, once the new week's rows are in.
  useEffect(() => {
    if (!findOnMount) return
    startedAt.current = Date.now()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the param is only readable after mount, and the card it names cannot exist before this render.
    setPendingPo(findOnMount)
  }, [findOnMount])

  useEffect(() => {
    if (pendingPo === null) return

    const card = findCardElement(pendingPo)
    if (card === null) {
      if (Date.now() - startedAt.current >= REVEAL_TIMEOUT_MS) {
        setPendingPo(null)
        setFailure(`Could not scroll to PO ${pendingPo}.`)
        return
      }
      const retry = setTimeout(() => setRevealTick((tick) => tick + 1), REVEAL_RETRY_MS)
      return () => clearTimeout(retry)
    }

    const row = byPoNumber.get(pendingPo.toLowerCase())
    if (stripRef.current && row?.production_date) {
      scrollWeekIntoView(stripRef.current, weekKeyFor(row.production_date), shouldReduceMotion)
    }
    card.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      behavior: shouldReduceMotion ? 'auto' : 'smooth',
    })

    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: the effect's job is to read the DOM for a card that may not exist yet and scroll it into view. That scroll is the external-system update the rule asks for; clearing the pending PO and lighting the card are that operation's result, and there is no render-time way to know whether a node exists.
    setPendingPo(null)
    setHighlightedPo(pendingPo)
  }, [pendingPo, revealTick, byPoNumber, stripRef, shouldReduceMotion])

  // The highlight is a pointer, not a selection: it clears itself.
  useEffect(() => {
    if (highlightedPo === null) return
    const timer = setTimeout(() => setHighlightedPo(null), HIGHLIGHT_DURATION_MS)
    return () => clearTimeout(timer)
  }, [highlightedPo])

  return { reveal, highlightedPo, undatedSignal, failure, clear }
}
