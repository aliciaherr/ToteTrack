'use client'

import type { DragStartEvent } from '@dnd-kit/core'
import PickupCard from './PickupCard'
import ProductionCard from './ProductionCard'
import { readDragGroup } from './calendarDnd'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

// What the drag overlay carries and how it is drawn, split out of
// `CalendarDndContext` when Task 81 gave the overlay a second card kind and
// pushed that file past the 200-line component cap (CQ-02). Same `*Parts`-style
// idiom as `DayColumnParts` and `AddOrderMenuParts`.

/**
 * The card the overlay is currently carrying. A tagged union rather than a
 * widened row, so the group and the row type can never disagree and the overlay
 * cannot draw an order card for a pickup drag (CONSTRAINT-25).
 */
export type ActiveCard =
  | { group: 'order'; row: CalendarOrderRow }
  | { group: 'pickup'; row: CalendarPickupRow }

/**
 * Resolves the dragged id into the row the overlay should draw.
 *
 * The **payload's** group picks the list to search, not the id — an id found in
 * the wrong collection would mean the two tables had colliding uuids, and
 * searching both would quietly paper over that rather than drawing nothing.
 *
 * @param event The `onDragStart` event, whose payload carries the group.
 * @param rows Every draggable order card on screen.
 * @param pickups Every draggable pickup card on screen.
 * @returns The card to draw, or null when the drag is not a calendar card.
 */
export function findActiveCard(
  event: DragStartEvent,
  rows: CalendarOrderRow[],
  pickups: CalendarPickupRow[],
): ActiveCard | null {
  const group = readDragGroup(event.active.data.current)
  const cardId = String(event.active.id)

  if (group === 'pickup') {
    const pickup = pickups.find((candidate) => candidate.id === cardId)
    return pickup ? { group: 'pickup', row: pickup } : null
  }
  if (group === 'order') {
    const row = rows.find((candidate) => candidate.id === cardId)
    return row ? { group: 'order', row } : null
  }
  return null
}

/** The card clone that follows the pointer, drawn in its own group's face. */
export default function DragOverlayCard({ card }: { card: ActiveCard }) {
  if (card.group === 'pickup') return <PickupCard pickup={card.row} isDragging />
  return <ProductionCard row={card.row} isDragging />
}
