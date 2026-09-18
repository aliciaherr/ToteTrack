'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useRouter } from 'next/navigation'
import { useCardReveal } from './useCardReveal'
import { weekKeyFor } from './calendarWeeks'
import { searchCalendarOrders } from '@/lib/actions/calendar.search'
import type { CalendarOrderRow, CalendarSearchHit } from '@/db/queries/calendar'

// Search for the production calendar (Task 93): which PO the viewer meant.
// Getting them to it is `useCardReveal`'s job. Its own hook rather than more
// state on `calendarLayoutHooks.ts`, because it is the only part of the screen
// that reaches the server for a *read* and the only part that navigates.

/**
 * Quiet period before a keystroke becomes a query.
 *
 * Matches `SEARCH_DEBOUNCE_MS` on the Orders tab deliberately: the two boxes
 * should feel like the same control. Typing a full PO number fires one request
 * at the end rather than one per character.
 */
const SEARCH_DEBOUNCE_MS = 250

export interface CalendarSearch {
  /** Called on every keystroke. Debounced; fills `choices` as the term narrows. */
  preview: (term: string) => void
  /** Resolves `term` to a single card. Called on Enter. */
  submit: (term: string) => void
  /** Matching orders, PO-ascending — the live results list. */
  choices: CalendarSearchHit[]
  /** True when more orders matched than `choices` holds. */
  hasMore: boolean
  /** Jumps to one of `choices`. */
  choose: (hit: CalendarSearchHit) => void
  /** A miss, a rejected term, or a failed lookup — shown under the box. */
  message: string | null
  /** True while a lookup is in flight. */
  isSearching: boolean
  /** Clears results, message and highlight — the box closing. */
  reset: () => void
  /** Bumped when a hit turns out to be undated, to open the callout. */
  undatedSignal: number
  /** PO number currently lit, for `CardHighlightProvider`. */
  highlightedPo: string | null
}

interface UseCalendarSearchArgs {
  /** Every order the client holds — placed and undated alike. */
  rows: CalendarOrderRow[]
  /** The week strip, for the horizontal scroll to the hit's week. */
  stripRef: RefObject<HTMLDivElement | null>
  shouldReduceMotion: boolean
  /** `?find=` from the URL — a hit that arrived via a cross-week navigation. */
  findOnMount?: string | null
}

/**
 * The calendar's PO search.
 *
 * **Typing narrows a list; choosing moves the calendar.** Each pause in typing
 * runs one lookup and fills the results list, PO-ascending, so more characters
 * narrow the same list rather than reshuffling it. Nothing scrolls, no view
 * changes and no navigation happens until a result is picked — which is what
 * makes searching-as-you-type safe on a screen where resolving a hit can
 * re-anchor the whole page.
 *
 * The list is always the server's, never a filter over loaded rows. The client
 * holds nine weeks, so "the matches I can see" is not "the matches there are",
 * and a list that quietly omitted an order three months out would be the exact
 * failure this box exists to prevent.
 *
 * Enter takes the shortest route available:
 *
 * 1. **Exact and loaded** — resolved with no round-trip at all. `po_number` is
 *    `UNIQUE`, so a term that exactly equals a loaded PO is provably the only
 *    match and there is nothing to disambiguate.
 * 2. **One result showing** — that result, without waiting for another lookup.
 * 3. **Otherwise** — one immediate lookup, jumping if it returns a single hit.
 *
 * A hit outside the loaded weeks re-anchors the page through `?week=&find=`,
 * and the reveal resumes on the other side once the card mounts. Undated hits
 * never navigate: `getUnscheduledOrders` is unbounded, so every undated order
 * is already on the client. They live in the header callout rather than a
 * column, which is what `undatedSignal` opens.
 */
export function useCalendarSearch({
  rows,
  stripRef,
  shouldReduceMotion,
  findOnMount = null,
}: UseCalendarSearchArgs): CalendarSearch {
  const router = useRouter()
  const [choices, setChoices] = useState<CalendarSearchHit[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Responses can land out of order — a short term queued before a longer one
  // may answer after it. Only the newest request may write state, or the list
  // ends up showing results for a prefix the viewer has already typed past.
  const requestSeq = useRef(0)

  const byPoNumber = useMemo(() => {
    const index = new Map<string, CalendarOrderRow>()
    for (const row of rows) index.set(row.po_number.toLowerCase(), row)
    return index
  }, [rows])

  const cardReveal = useCardReveal({ byPoNumber, stripRef, shouldReduceMotion, findOnMount })
  const { reveal, clear: clearReveal } = cardReveal

  const clearResults = useCallback(() => {
    setChoices([])
    setHasMore(false)
    setMessage(null)
  }, [])

  const reset = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    requestSeq.current += 1
    setIsSearching(false)
    clearResults()
    clearReveal()
  }, [clearResults, clearReveal])

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  const startReveal = useCallback(
    (row: CalendarOrderRow) => {
      clearResults()
      reveal(row.po_number, row.production_date === null)
    },
    [clearResults, reveal],
  )

  /** Sends the viewer to a hit, navigating first when it is not loaded. */
  const choose = useCallback(
    (hit: CalendarSearchHit) => {
      const loaded = byPoNumber.get(hit.po_number.toLowerCase())
      if (loaded) {
        startReveal(loaded)
        return
      }

      if (hit.production_date === null) {
        // Unreachable in practice — undated orders are always loaded — but a
        // silent nothing here would be the one case where search appears to do
        // nothing at all, so it says so instead.
        setMessage(`PO ${hit.po_number} has no production date and is not loaded.`)
        return
      }

      clearResults()
      const params = new URLSearchParams({
        week: weekKeyFor(hit.production_date),
        find: hit.po_number,
      })
      router.push(`/calendar?${params.toString()}`)
    },
    [byPoNumber, clearResults, router, startReveal],
  )

  /**
   * Runs one lookup and hands the result to `onResult`, newest-request-wins.
   *
   * Returns nothing: every caller cares about the side effects, and awaiting it
   * would let a stale response overwrite a newer one.
   */
  const runLookup = useCallback(
    (term: string, onResult: (hits: CalendarSearchHit[], more: boolean) => void) => {
      const seq = (requestSeq.current += 1)
      setIsSearching(true)
      void searchCalendarOrders(term)
        .then((result) => {
          if (seq !== requestSeq.current) return
          if ('error' in result) {
            setChoices([])
            setHasMore(false)
            setMessage(result.error)
            return
          }
          onResult(result.hits, result.hasMore)
        })
        .finally(() => {
          if (seq === requestSeq.current) setIsSearching(false)
        })
    },
    [],
  )

  const preview = useCallback(
    (term: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      const trimmed = term.trim()
      if (trimmed === '') {
        requestSeq.current += 1
        setIsSearching(false)
        clearResults()
        return
      }

      debounceRef.current = setTimeout(() => {
        runLookup(trimmed, (hits, more) => {
          setChoices(hits)
          setHasMore(more)
          // No message while typing: an empty list under the box already says
          // "nothing matches", and a sentence that appears and vanishes on
          // every other keystroke is noise.
          setMessage(hits.length === 0 ? `No order matching "${trimmed}".` : null)
        })
      }, SEARCH_DEBOUNCE_MS)
    },
    [clearResults, runLookup],
  )

  const submit = useCallback(
    (term: string) => {
      const trimmed = term.trim()
      if (trimmed === '') return
      if (debounceRef.current) clearTimeout(debounceRef.current)

      const exact = byPoNumber.get(trimmed.toLowerCase())
      if (exact) {
        startReveal(exact)
        return
      }

      // The list already showing one answer is an answer; re-asking the server
      // for it would add a round-trip to a question already on screen.
      if (choices.length === 1) {
        choose(choices[0])
        return
      }
      if (choices.length > 1) return

      runLookup(trimmed, (hits, more) => {
        if (hits.length === 0) {
          setMessage(`No order matching "${trimmed}".`)
          return
        }
        if (hits.length === 1) {
          choose(hits[0])
          return
        }
        setChoices(hits)
        setHasMore(more)
      })
    },
    [byPoNumber, choices, choose, runLookup, startReveal],
  )

  return {
    preview,
    submit,
    choices,
    hasMore,
    choose,
    // A reveal that ran out of time is reported through the same line as a
    // miss: from the viewer's side both mean "search did not get you there".
    message: message ?? cardReveal.failure,
    isSearching,
    reset,
    undatedSignal: cardReveal.undatedSignal,
    highlightedPo: cardReveal.highlightedPo,
  }
}
