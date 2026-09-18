'use client'

import { useCallback, useEffect, useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import SortableProductionCard from './SortableProductionCard'
import { useArmMode } from './armMode'
import { DROPDOWN_MAX_HEIGHT } from './calloutMetrics'
import { useOpenOnDragOverTarget } from './useOpenOnDragOverTarget'
import {
  UNSCHEDULED_DROPPABLE_ID,
  UNSCHEDULED_ORIGIN,
  type CalloutDropData,
} from './calendarDnd'
import type { CalendarOrderRow } from '@/db/queries/calendar'

interface UnscheduledCalloutProps {
  rows: CalendarOrderRow[]
  /**
   * Bumped by search when a hit turns out to have no production date, so the
   * card it wants to light is in this dropdown rather than a day column.
   *
   * A counter rather than a boolean: two searches in a row for the same undated
   * PO have to open the panel twice, and a boolean that is already `true` would
   * make the second one a no-op.
   */
  openSignal?: number
}

// `group` is what stops the pickups pill next door from being a legal
// destination for an order card (CONSTRAINT-25): the two pills sit side by side
// in one header, and without it a mis-aimed drop would unschedule across
// entities.
const DROP_DATA: CalloutDropData = { type: 'callout', group: 'order' }

function CalloutPill({
  count,
  isExpanded,
  isOver,
  onToggle,
}: {
  count: number
  isExpanded: boolean
  isOver: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isExpanded}
      aria-controls="unscheduled-dropdown"
      className={`inline-flex items-center gap-2 rounded-full bg-red-100 text-red-800 px-4 min-h-[44px] text-sm font-medium transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        isOver ? 'ring-2 ring-red-500' : ''
      }`}
    >
      <span className="tabular-nums font-semibold">{count}</span>
      need a production date
    </button>
  )
}

/** The card list. Every entry is draggable straight out onto a day column. */
function CalloutDropdown({ rows }: { rows: CalendarOrderRow[] }) {
  return (
    <div
      id="unscheduled-dropdown"
      data-testid="unscheduled-dropdown"
      className="calendar-scroll absolute right-0 top-full mt-2 z-30 w-52 overflow-y-auto rounded-xl bg-card border border-border shadow-lg p-2 space-y-2"
      style={{ maxHeight: DROPDOWN_MAX_HEIGHT }}
    >
      <SortableContext
        id={UNSCHEDULED_ORIGIN}
        items={rows.map((row) => row.id)}
        strategy={verticalListSortingStrategy}
      >
        {rows.map((row, index) => (
          <SortableProductionCard
            key={row.id}
            row={row}
            dateKey={UNSCHEDULED_ORIGIN}
            index={index}
          />
        ))}
      </SortableContext>
    </div>
  )
}

/** Dismisses an open panel on Escape. */
function useEscapeToClose(isOpen: boolean, close: () => void) {
  useEffect(() => {
    if (!isOpen) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, close])
}

/**
 * The unscheduled-orders callout: a count pill that opens a list of every order
 * with no production date, whatever its delivery date.
 *
 * It is also a drop target. Dragging a placed card onto it clears that card's
 * placement — the same operation as the `Remove from calendar` menu item, given
 * a second entry point because dragging is the calendar's native gesture
 * (CONSTRAINT-19).
 *
 * No active order may be invisible, so a count of zero renders an explicit
 * all-clear rather than a bare `0` that reads like a broken badge.
 *
 * @param rows Orders with no production date, from `getUnscheduledOrders`.
 */
export default function UnscheduledCallout({ rows, openSignal = 0 }: UnscheduledCalloutProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { armed, tap } = useArmMode()
  const { setNodeRef, isOver } = useDroppable({
    id: UNSCHEDULED_DROPPABLE_ID,
    data: DROP_DATA,
  })

  const open = useCallback(() => setIsExpanded(true), [])
  const close = useCallback(() => setIsExpanded(false), [])
  // While a card is armed (Task 68), the pill is a placement target — tapping
  // it unschedules the armed card, the tap counterpart of drag-onto-callout —
  // and must not also toggle the dropdown under the salesperson's finger.
  // `group: 'order'` is not decoration: an armed *pickup* tapped on this pill
  // resolves to `cancel` and writes nothing, so the two pills sitting side by
  // side in one header cannot unschedule across entities (CONSTRAINT-25).
  const toggle = useCallback(() => {
    if (armed !== null) {
      tap({ type: 'callout', group: 'order' })
      return
    }
    setIsExpanded((current) => !current)
  }, [armed, tap])

  useOpenOnDragOverTarget(UNSCHEDULED_DROPPABLE_ID, open)
  useEscapeToClose(isExpanded, close)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: this subscribes the panel to an external signal (search finding an undated hit), which is exactly what an effect is for. The alternative is lifting `isExpanded` into the header so search can set it, which would put this panel's private open/shut state three levels above the panel.
    if (openSignal > 0) open()
  }, [openSignal, open])

  if (rows.length === 0) {
    return (
      <span data-testid="unscheduled-empty" className="text-sm text-muted-foreground">
        Everything has a production date.
      </span>
    )
  }

  return (
    <div className="relative">
      <div ref={setNodeRef}>
        <CalloutPill
          count={rows.length}
          isExpanded={isExpanded}
          isOver={isOver}
          onToggle={toggle}
        />
      </div>
      {isExpanded && <CalloutDropdown rows={rows} />}
    </div>
  )
}
