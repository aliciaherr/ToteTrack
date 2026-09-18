'use client'

import { useSortable } from '@dnd-kit/sortable'
import { motion } from 'framer-motion'
import DropPlaceholder from './DropPlaceholder'
import ProductionCard from './ProductionCard'
import { isBuiltStatus } from './productionCardStatus'
import { toTranslate, type CardDragData } from './calendarDnd'
import { useArmMode } from './armMode'
import { useIsHighlighted } from './cardHighlight'
import { useLongPressArm } from './useLongPressArm'
import { useSelectCard } from './cardSelection'
import type { CalendarOrderRow } from '@/db/queries/calendar'

interface SortableProductionCardProps {
  row: CalendarOrderRow
  dateKey: string
  index: number
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
function CardFace({
  row,
  isArmed,
  isFlying,
  isFound,
}: {
  row: CalendarOrderRow
  isArmed: boolean
  isFlying: boolean
  isFound: boolean
}) {
  if (!isFlying) return <ProductionCard row={row} isArmed={isArmed} isFound={isFound} />
  return (
    <motion.div layout layoutId={`fly-${row.id}`}>
      <ProductionCard row={row} isArmed={isArmed} isFound={isFound} />
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
 * Every payload it emits — drag data, the armed card, the tap target — carries
 * `group: 'order'` (CONSTRAINT-25). That is what keeps this card out of the
 * pickups list: collision detection never offers it a pickup slot, and the drop
 * and tap resolvers refuse one if it somehow arrives.
 *
 * The wrapper is also the tap target, with two meanings (Task 68):
 * - **Nothing armed:** a click opens the card popup. On mouse/pen, a press
 *   that travels less than `POINTER_ACTIVATION_DISTANCE_PX` never activates
 *   the drag sensor, so the click lands here. On touch, a still-finger
 *   long-press arms the card instead (`useLongPressArm`).
 * - **A card armed:** the click routes to `armMode.tap` — insert at this
 *   card's position, or cancel if this card *is* the armed one, or cancel
 *   because the armed card is a pickup and this is not — and the popup stays
 *   shut.
 */
export default function SortableProductionCard({
  row,
  dateKey,
  index,
}: SortableProductionCardProps) {
  const isBuilt = isBuiltStatus(row.status)
  const selectCard = useSelectCard()
  const { armed, flyingId, arm, tap } = useArmMode()
  const pressHandlers = useLongPressArm(
    () => arm({ group: 'order', row, dateKey, index }),
    isBuilt,
  )
  const dragData: CardDragData = { type: 'card', group: 'order', dateKey, index }
  // The group is part of the comparison, not decoration: an armed pickup must
  // never make an order card render its armed ring.
  const isArmed = armed?.group === 'order' && armed.row.id === row.id
  // Read here rather than in `ProductionCard` so the card face stays
  // presentational and context-free — Task 57's dropdown and Task 58's popup
  // both render one outside every calendar provider. Reading it in the wrapper
  // also means the undated callout lights its cards for free: it renders this
  // same wrapper, so a search hit with no production date needs no second path.
  const isFound = useIsHighlighted(row.po_number)

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

  // `stopPropagation` only while armed, and it is load-bearing (Task 91). The
  // ancestor `<ul>` is itself a tap surface, so without it one tap on a card
  // fired `tap` twice: once here with this card's index, then again from the
  // column handler. `tap` closes over the `armed` *state*, which React has not
  // re-rendered between the two synchronous calls, so the second call still saw
  // a non-null armed card and issued a second, wrong placement — a bottom-of-day
  // append racing the correct one, with no in-flight guard in the mutation.
  // Unarmed clicks must keep bubbling or the card popup path changes.
  const handleClick = (event: React.MouseEvent) => {
    if (armed !== null) {
      event.stopPropagation()
      tap({ type: 'card', group: 'order', cardId: row.id, dateKey, index })
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
        <CardFace
          row={row}
          isArmed={isArmed}
          isFlying={flyingId === row.id}
          isFound={isFound}
        />
      )}
    </div>
  )
}
