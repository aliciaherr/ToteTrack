'use client'

import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import SortablePickupCard from './SortablePickupCard'
import { useArmMode } from './armMode'
import { sortableListId } from './calendarDnd'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

interface ColumnPickupListProps {
  pickups: CalendarPickupRow[]
  dateKey: string
  /** True when the orders list is drawn above this one, which earns a divider. */
  hasOrdersAbove: boolean
  /** Attaches this list's own droppable, id `pickups:${dateKey}`. */
  setDropRef: (element: HTMLElement | null) => void
  /** Opens a pickup's popup. */
  onSelect: (pickup: CalendarPickupRow) => void
}

/**
 * A day column's second list: its pickups, below the orders list and ordered
 * independently of it (CONSTRAINT-25).
 *
 * Its own file rather than more of `DayColumnParts` so that file stays inside
 * the 200-line component cap (CQ-02) — the same reason `DayColumnParts` was
 * split out of `DayColumn`.
 *
 * `flex-1 min-h-0` on both branches, matching the orders list: with both lists
 * on they take half the column each and scroll internally, and with orders off
 * this one takes the whole column. The split falls out of the flex chain, so
 * neither list can force the page itself to scroll (CONSTRAINT-19).
 *
 * It is a **separate sortable list and a separate droppable** from the orders
 * list above it: `SortableContext` id `pickup:${dateKey}`, droppable id
 * `pickups:${dateKey}`. Two ids in one column is what lets collision detection
 * hide this list entirely while an order is in the air, so a drag preview never
 * opens a slot here that the drop would refuse.
 *
 * Both branches carry the droppable ref and the tap handler: an empty day must
 * be able to receive a pickup, and a tap on empty space appends the armed card.
 * Taps on a card never reach here — the card's own handler runs first and
 * disarms, so the bubbled click finds nothing armed.
 */
export default function ColumnPickupList({
  pickups,
  dateKey,
  hasOrdersAbove,
  setDropRef,
  onSelect,
}: ColumnPickupListProps) {
  const { tap } = useArmMode()
  const dividerClass = hasOrdersAbove ? 'border-t border-border' : ''
  const handleTap = () =>
    tap({ type: 'column', group: 'pickup', dateKey, cardCount: pickups.length })

  return (
    <SortableContext
      id={sortableListId('pickup', dateKey)}
      items={pickups.map((pickup) => pickup.id)}
      strategy={verticalListSortingStrategy}
    >
      {pickups.length === 0 ? (
        <div
          ref={setDropRef}
          onClick={handleTap}
          data-testid="column-pickups-empty"
          className={`flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground p-8 text-center ${dividerClass}`}
        >
          No pickups.
        </div>
      ) : (
        <ul
          ref={setDropRef}
          onClick={handleTap}
          data-testid="column-pickups"
          className={`calendar-scroll flex-1 min-h-0 overflow-y-auto p-2 space-y-2 ${dividerClass}`}
          role="list"
        >
          {pickups.map((pickup, index) => (
            <li key={pickup.id}>
              <SortablePickupCard
                pickup={pickup}
                dateKey={dateKey}
                index={index}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>
      )}
    </SortableContext>
  )
}
