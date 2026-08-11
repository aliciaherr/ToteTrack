'use client'

import { useCallback, useRef, useState } from 'react'
import { useDndMonitor, useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useDismissOnOutsideOrEsc } from '@/lib/hooks/useDismissOnOutsideOrEsc'
import SortablePickupCard from './SortablePickupCard'
import { useArmMode } from './armMode'
import {
  sortableListId,
  UNSCHEDULED_ORIGIN,
  UNSCHEDULED_PICKUPS_DROPPABLE_ID,
  type CalloutDropData,
} from './calendarDnd'
import { UNSCHEDULED_DROPDOWN_VISIBLE } from '@/db/queries/calendar.constants'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

interface UnscheduledPickupsCalloutProps {
  pickups: CalendarPickupRow[]
  /** Opens a pickup's popup. */
  onSelect: (pickup: CalendarPickupRow) => void
}

// `group` is what stops an order card next door being a legal destination here
// (CONSTRAINT-25): the two pills sit side by side in one header, and without it
// a mis-aimed drop would unschedule across entities.
const DROP_DATA: CalloutDropData = { type: 'callout', group: 'pickup' }

// Gap between dropdown cards, in rem, matching the day columns' `space-y-2`.
const CARD_GAP_REM = 0.5
// Vertical padding of the dropdown list, in rem (`p-2` top + bottom).
const LIST_PADDING_REM = 1

/**
 * Height of exactly `UNSCHEDULED_DROPDOWN_VISIBLE` cards plus their gaps and
 * the list's own padding — the same expression the orders callout uses, against
 * `--card-h` so the panel scales with the cards instead of drifting from them.
 */
const DROPDOWN_MAX_HEIGHT = `calc(var(--card-h) * ${UNSCHEDULED_DROPDOWN_VISIBLE} + ${
  CARD_GAP_REM * (UNSCHEDULED_DROPDOWN_VISIBLE - 1) + LIST_PADDING_REM
}rem)`

/**
 * Opens the dropdown while a pickup is dragged over the collapsed pill.
 *
 * Without this the callout is unreachable by drag: the drop zone is the pill
 * itself, a 44px target, and a salesperson aiming at "somewhere in the undated
 * list" has nothing to aim at. The id comparison is what keeps it from opening
 * when an order is dragged over the *other* pill.
 */
function useOpenOnPickupDragOver(open: () => void) {
  useDndMonitor({
    onDragOver(event) {
      if (event.over?.id === UNSCHEDULED_PICKUPS_DROPPABLE_ID) open()
    },
  })
}

/** The card list. Every entry drags straight out onto a day column. */
function PickupsDropdown({
  pickups,
  onSelect,
}: {
  pickups: CalendarPickupRow[]
  onSelect: (pickup: CalendarPickupRow) => void
}) {
  return (
    <div
      id="unscheduled-pickups-dropdown"
      data-testid="unscheduled-pickups-dropdown"
      className="calendar-scroll absolute right-0 top-full mt-2 z-30 w-52 overflow-y-auto rounded-xl bg-card border border-border shadow-lg p-2 space-y-2"
      style={{ maxHeight: DROPDOWN_MAX_HEIGHT }}
    >
      <SortableContext
        id={sortableListId('pickup', UNSCHEDULED_ORIGIN)}
        items={pickups.map((pickup) => pickup.id)}
        strategy={verticalListSortingStrategy}
      >
        {pickups.map((pickup, index) => (
          <SortablePickupCard
            key={pickup.id}
            pickup={pickup}
            dateKey={UNSCHEDULED_ORIGIN}
            index={index}
            onSelect={onSelect}
          />
        ))}
      </SortableContext>
    </div>
  )
}

/**
 * The undated-pickups pill, shown beside the orders callout while the pickups
 * toggle is on.
 *
 * Deliberately terser than `UnscheduledCallout` — a bare count rather than a
 * sentence — because the calendar header has to hold two callouts, two toggles
 * and the week action inside iPad landscape's 1024px without wrapping, and a
 * wrapped header would steal the height the four-card math depends on
 * (CONSTRAINT-19).
 *
 * It is a drop target and a tap target for **pickups only**. Dropping a placed
 * pickup here clears its date, and so does tapping the pill while a pickup is
 * armed — the same operation the popup's `Remove from calendar` runs, given two
 * more entry points because dragging and tapping are the calendar's native
 * gestures. An armed *order* tapped here resolves to `cancel`, and an order
 * drag never sees this pill at all: collision detection removes it from the
 * candidate set before the preview can open (CONSTRAINT-25).
 *
 * Nothing renders when every pickup has a date — there is no all-clear message
 * to make room for. The pill is therefore not a drop target in that state,
 * matching the orders callout, whose empty branch is likewise undroppable; the
 * popup's `Remove from calendar` is the route that always works.
 *
 * @param pickups Pickups with no date, from `getUnscheduledPickups`.
 * @param onSelect Opens the popup for one of them.
 */
export default function UnscheduledPickupsCallout({
  pickups,
  onSelect,
}: UnscheduledPickupsCalloutProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const { armed, tap } = useArmMode()
  const { setNodeRef, isOver } = useDroppable({
    id: UNSCHEDULED_PICKUPS_DROPPABLE_ID,
    data: DROP_DATA,
  })

  const open = useCallback(() => setIsExpanded(true), [])
  const close = useCallback(() => setIsExpanded(false), [])
  const toggle = useCallback(() => {
    if (armed !== null) {
      tap({ type: 'callout', group: 'pickup' })
      return
    }
    setIsExpanded((current) => !current)
  }, [armed, tap])

  const handleSelect = useCallback(
    (pickup: CalendarPickupRow) => {
      close()
      onSelect(pickup)
    },
    [close, onSelect],
  )

  useOpenOnPickupDragOver(open)
  // The shared dismissal hook rather than a third hand-rolled copy (CQ-07).
  useDismissOnOutsideOrEsc(isExpanded, wrapperRef, close, { pointerEvent: 'pointerdown' })

  if (pickups.length === 0) return null

  return (
    <div ref={wrapperRef} className="relative">
      <div ref={setNodeRef}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isExpanded}
          aria-controls="unscheduled-pickups-dropdown"
          aria-label={`${pickups.length} pickups need a date`}
          className={`inline-flex items-center gap-2 rounded-full bg-amber-100 text-amber-800 px-4 min-h-[44px] text-sm font-medium transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
            isOver ? 'ring-2 ring-amber-500' : ''
          }`}
        >
          <span className="tabular-nums font-semibold">{pickups.length}</span>
          undated
        </button>
      </div>

      {isExpanded && <PickupsDropdown pickups={pickups} onSelect={handleSelect} />}
    </div>
  )
}
