'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { DROPDOWN_MAX_HEIGHT } from './calloutMetrics'
import type { CalendarSearch as CalendarSearchState } from './useCalendarSearch'
import type { CalendarSearchHit } from '@/db/queries/calendar'

/**
 * The placeholder is the whole scope disclosure, and deliberately the only one.
 *
 * Pickups carry no PO number at all (CONSTRAINT-25), so they are not searchable
 * and never will be. Saying so in the box itself means it is read before the
 * first search rather than after a confusing one, and costs no header room —
 * which a note beside the box would.
 */
const SEARCH_PLACEHOLDER = 'Search orders'

/**
 * The live results list: every order matching what has been typed so far,
 * PO-ascending, narrowing as more characters arrive.
 *
 * Capped by `CALENDAR_SEARCH_LIMIT`, and it says so when the cap bites. A
 * silently truncated list is the failure this box exists to avoid — showing
 * the alphabetically-first eight of two hundred as though they were all of
 * them is exactly how someone concludes their order is missing.
 */
function SearchChoices({
  choices,
  hasMore,
  onChoose,
}: {
  choices: CalendarSearchHit[]
  hasMore: boolean
  onChoose: (hit: CalendarSearchHit) => void
}) {
  return (
    <ul
      data-testid="calendar-search-choices"
      className="calendar-scroll absolute left-0 top-full mt-2 z-30 w-full overflow-y-auto rounded-xl bg-card border border-border shadow-lg p-1"
      style={{ maxHeight: DROPDOWN_MAX_HEIGHT }}
    >
      {choices.map((hit) => (
        <li key={hit.id}>
          <button
            type="button"
            onClick={() => onChoose(hit)}
            className="w-full text-left px-3 min-h-[44px] rounded-lg text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="font-medium text-foreground">{hit.po_number}</span>
            <span className="block text-xs text-muted-foreground">
              {hit.customer_name ?? 'Unknown customer'}
              {hit.production_date === null && ' · no production date'}
            </span>
          </button>
        </li>
      ))}
      {hasMore && (
        <li
          data-testid="calendar-search-more"
          className="px-3 py-2 text-xs text-muted-foreground border-t border-border"
        >
          More matches — keep typing to narrow.
        </li>
      )}
    </ul>
  )
}

/**
 * The calendar's order search: a magnifier that expands into a text box.
 *
 * Collapsed by default, and collapsed is the state the header is designed
 * around — a permanently open box would cost the width the merged view cycle
 * was introduced to reclaim (CONSTRAINT-19). Expanding is one tap, and the
 * input takes focus on open so the next thing that happens is typing.
 *
 * Typing narrows a list; only choosing moves the calendar. Each pause in
 * typing fills the results list below the box, and nothing scrolls, switches
 * view or navigates until a result is picked — which is what makes
 * search-as-you-type safe here, where resolving a hit can re-anchor the page.
 * Enter picks the single result when there is exactly one.
 *
 * Escape collapses the box and clears the highlight. Closing is also what
 * dismisses a pick-list, so there is one way out of every state the box can be
 * in.
 */
export default function CalendarSearch({ search }: { search: CalendarSearchState }) {
  const { preview, submit, choices, hasMore, choose, message, isSearching, reset } = search
  const [isOpen, setIsOpen] = useState(false)
  const [term, setTerm] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const close = useCallback(() => {
    setIsOpen(false)
    setTerm('')
    reset()
  }, [reset])

  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  if (!isOpen) {
    return (
      <button
        type="button"
        data-testid="calendar-search-open"
        onClick={() => setIsOpen(true)}
        aria-label="Search orders by PO number"
        className="inline-flex items-center justify-center rounded-full min-h-[44px] min-w-[44px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search aria-hidden="true" className="h-5 w-5" />
      </button>
    )
  }

  return (
    <div className="relative w-56">
      <Search
        aria-hidden="true"
        className="absolute left-3 top-[22px] -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none"
      />
      <input
        ref={inputRef}
        type="text"
        data-testid="calendar-search-input"
        value={term}
        placeholder={SEARCH_PLACEHOLDER}
        aria-label="Search orders by PO number"
        onChange={(event) => {
          setTerm(event.target.value)
          preview(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit(term)
          if (event.key === 'Escape') close()
        }}
        onBlur={(event) => {
          // Only collapse when focus has left the box *and* its pick-list —
          // clicking a result moves focus to that button, which would otherwise
          // unmount the list before its own click handler ran.
          if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) close()
        }}
        className="w-full pl-9 pr-3 h-11 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
      />
      {isSearching && (
        <span
          data-testid="calendar-search-busy"
          role="status"
          className="absolute right-3 top-[22px] -translate-y-1/2 text-xs text-muted-foreground"
        >
          …
        </span>
      )}
      {message !== null && choices.length === 0 && (
        <p
          data-testid="calendar-search-message"
          role="status"
          className="absolute left-0 top-full mt-1 z-30 w-full rounded-lg bg-card border border-border shadow-sm px-3 py-2 text-xs text-muted-foreground"
        >
          {message}
        </p>
      )}
      {choices.length > 0 && (
        <SearchChoices choices={choices} hasMore={hasMore} onChoose={choose} />
      )}
    </div>
  )
}
