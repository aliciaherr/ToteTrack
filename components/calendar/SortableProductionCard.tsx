'use client'

import { useSortable } from '@dnd-kit/sortable'
import { motion } from 'framer-motion'
import ProductionCard from './ProductionCard'
import { isBuiltStatus } from './productionCardStatus'
import { toTranslate, type CardDragData } from './calendarDnd'
import { useArmMode } from './armMode'
import { useLongPressArm } from './useLongPressArm'
import { useSelectCard } from './cardSelection'
import type { CalendarOrderRow } from '@/db/queries/calendar'

interface SortableProductionCardProps {
  row: CalendarOrderRow
  dateKey: string
  index: number
}

/**
 * Where the card will land if released now.
 *
 * The dragged card's own slot is the one the sortable strategy moves to the
 * insertion point, so replacing its contents with an accent outline turns that
 * slot into a live drop indicator that tracks the cursor. The card itself is
 * still visible — `DragOverlay` renders a clone following the pointer — so
 * nothing disappears; the original just stops pretending to be in its old place.
 *
 * Without this the source card sat faded in its original position while the
 * gap opened elsewhere, which is what made drops feel like guesswork.
 */
function DropPlaceholder() {
  return (
    <div
      data-testid="drop-placeholder"
      aria-hidden="true"
      className="rounded-md border-2 border-dashed border-primary bg-primary/5"
      style={{ height: 'var(--card-h)' }}
    />
  )
}

/**
 * The card face, optionally wrapped for the tap-placement flight (Task 68).
 *
 * The motion wrapper mounts only while `armMode` marks this card as flying —
 * a just-tapped placement awaiting its refreshed position. `layoutId` lets
 * framer-motion animate the card from its old slot to the new one even though
 * the move is an unmount/remount across columns. Every other render is a plain
 * card, so desktop drags never have a layout animation fighting `@dnd-kit`'s
 * own transforms.
 */
function CardFace({ row, isArmed, isFlying }: { row: CalendarOrderRow; isArmed: boolean; isFlying: boolean }) {
  if (!isFlying) return <ProductionCard row={row} isArmed={isArmed} />
  return (
    <motion.div layout layoutId={`fly-${row.id}`}>
      <ProductionCard row={row} isArmed={isArmed} />
    </motion.div>
  )
}

/**
 * Drag wrapper around a `ProductionCard`.
 *
 * The card itself stays presentational and context-free — Task 57's dropdown
 * and Task 58's popup both render one outside any `DndContext`, so requiring a
 * drag context to render a card would break them.
 *
 * `completed` and `invoiced` cards mount the hook disabled *and* have no
 * listeners spread onto them, so they carry no drag handle and no
 * `aria-roledescription`. Disabling only the hook would still announce them as
 * sortable to a screen reader. The same `isBuilt` disables arming — a card
 * that cannot be dragged cannot be armed, mirroring the server's block list.
 *
 * The wrapper is also the tap target, with two meanings (Task 68):
 * - **Nothing armed:** a click opens the card popup. On mouse/pen, a press
 *   that travels less than `POINTER_ACTIVATION_DISTANCE_PX` never activates
 *   the drag sensor, so the click lands here. On touch, a still-finger
 *   long-press arms the card instead (`useLongPressArm`).
 * - **A card armed:** the click routes to `armMode.tap` — insert at this
 *   card's position, or cancel if this card *is* the armed one — and the
 *   popup stays shut.
 */
export default function SortableProductionCard({
  row,
  dateKey,
  index,
}: SortableProductionCardProps) {
  const isBuilt = isBuiltStatus(row.status)
  const selectCard = useSelectCard()
  const { armed, flyingId, arm, tap } = useArmMode()
  const pressHandlers = useLongPressArm(() => arm({ row, dateKey, index }), isBuilt)
  const dragData: CardDragData = { type: 'card', dateKey, index }

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    // `draggable` and `droppable` are disabled separately on purpose. A bare
    // `disabled: true` turns off both, which stops a built card being a valid
    // drop *slot* — and then nothing can move across it, making the interleaving
    // CONSTRAINT-19 guarantees ("completed and invoiced keep their sequence slot
    // interleaved with scheduled cards") impossible to express.
    id: row.id,
    data: dragData,
    disabled: { draggable: isBuilt, droppable: false },
  })

  const handleClick = () => {
    if (armed !== null) {
      tap({ type: 'card', orderId: row.id, dateKey, index })
      return
    }
    selectCard(row)
  }

  return (
    <div
      ref={setNodeRef}
      onClick={handleClick}
      className="calendar-card-press"
      style={{ transform: toTranslate(transform), transition: transition ?? undefined }}
      {...pressHandlers}
      {...(isBuilt ? {} : attributes)}
      {...(isBuilt ? {} : listeners)}
    >
      {isDragging ? (
        <DropPlaceholder />
      ) : (
        <CardFace row={row} isArmed={armed?.row.id === row.id} isFlying={flyingId === row.id} />
      )}
    </div>
  )
}
