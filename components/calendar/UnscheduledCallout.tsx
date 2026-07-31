'use client'

import { useCallback, useEffect, useState } from 'react'
import { useDndMonitor, useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import SortableProductionCard from './SortableProductionCard'
import { useArmMode } from './armMode'
import {
  UNSCHEDULED_DROPPABLE_ID,
  UNSCHEDULED_ORIGIN,
  type CalloutDropData,
} from './calendarDnd'
import { UNSCHEDULED_DROPDOWN_VISIBLE } from '@/db/queries/calendar.constants'
import type { CalendarOrderRow } from '@/db/queries/calendar'

interface UnscheduledCalloutProps {
  rows: CalendarOrderRow[]
}

const DROP_DATA: CalloutDropData = { type: 'callout' }

// Gap between dropdown cards, in rem, matching the day columns' `space-y-2`.
const CARD_GAP_REM = 0.5
// Vertical padding of the dropdown list, in rem (`p-2` top + bottom).
const LIST_PADDING_REM = 1

/**
 * Height of exactly `UNSCHEDULED_DROPDOWN_VISIBLE` cards plus their gaps and
 * the list's own padding. Expressed against `--card-h` so the dropdown scales
 * with the cards rather than drifting from them at small viewports.
 */
const DROPDOWN_MAX_HEIGHT = `calc(var(--card-h) * ${UNSCHEDULED_DROPDOWN_VISIBLE} + ${
  CARD_GAP_REM * (UNSCHEDULED_DROPDOWN_VISIBLE - 1) + LIST_PADDING_REM
}rem)`

/**
 * Opens the dropdown while a card is dragged over the collapsed pill.
 *
 * Without this the callout is unreachable by drag: the drop zone is the pill
 * itself, which is a 44px target, and a salesperson aiming at "somewhere in the
 * unscheduled list" has nothing to aim at. Auto-opening turns the whole panel
 * into the visible target.
 */
function useOpenOnDragOver(open: () => void) {
  useDndMonitor({
    onDragOver(event) {
      if (event.over?.id === UNSCHEDULED_DROPPABLE_ID) open()
    },
  })
}

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
export default function UnscheduledCallout({ rows }: UnscheduledCalloutProps) {
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
  const toggle = useCallback(() => {
    if (armed !== null) {
      tap({ type: 'callout' })
      return
    }
    setIsExpanded((current) => !current)
  }, [armed, tap])

  useOpenOnDragOver(open)
  useEscapeToClose(isExpanded, close)

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
