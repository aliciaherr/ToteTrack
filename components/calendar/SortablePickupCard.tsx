'use client'

import { useSortable } from '@dnd-kit/sortable'
import { motion } from 'framer-motion'
import DropPlaceholder from './DropPlaceholder'
import PickupCard, { isLockedPickupStatus } from './PickupCard'
import { toTranslate, type CardDragData } from './calendarDnd'
import { useArmMode } from './armMode'
import { useLongPressArm } from './useLongPressArm'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

interface SortablePickupCardProps {
  pickup: CalendarPickupRow
  /** The day column this card sits in, or `UNSCHEDULED_ORIGIN`. */
  dateKey: string
  index: number
  /** Opens this pickup's popup. Called only when nothing is armed. */
  onSelect: (pickup: CalendarPickupRow) => void
}

/**
 * The card face, optionally wrapped for the tap-placement flight. Mirrors
 * `SortableProductionCard`'s `CardFace` — the flight is a property of the
 * gesture, not of the entity, so both groups animate identically.
 */
function PickupCardFace({
  pickup,
  isArmed,
  isFlying,
}: {
  pickup: CalendarPickupRow
  isArmed: boolean
  isFlying: boolean
}) {
  if (!isFlying) return <PickupCard pickup={pickup} isArmed={isArmed} />
  return (
    <motion.div layout layoutId={`fly-${pickup.id}`}>
      <PickupCard pickup={pickup} isArmed={isArmed} />
    </motion.div>
  )
}

/**
 * Drag wrapper around a `PickupCard` — the pickups list's counterpart to
 * `SortableProductionCard`, deliberately built to the same shape so the two
 * lists behave identically under drag, long-press and tap.
 *
 * Every payload it emits carries `group: 'pickup'` (CONSTRAINT-25). That single
 * field is what makes the collision pre-filter hide every order slot while this
 * card is in the air, and what makes `resolveDropTarget` / `resolveTapAction`
 * refuse an order destination if one ever reaches them.
 *
 * `completed` pickups mount the hook disabled *and* have no listeners spread
 * onto them, so they carry no drag handle and no `aria-roledescription` —
 * disabling only the hook would still announce them as sortable. The same lock
 * disables arming, mirroring the server's block list. They stay valid drop
 * *slots* so an active pickup can be sequenced across one, exactly as a built
 * order card does.
 *
 * `onSelect` is a prop rather than a context, unlike the order card's
 * `useSelectCard`: both places that render this card — the day column list and
 * the undated callout — already hold the handler, so a context would add an
 * indirection with no prop-drilling to remove.
 */
export default function SortablePickupCard({
  pickup,
  dateKey,
  index,
  onSelect,
}: SortablePickupCardProps) {
  const isLocked = isLockedPickupStatus(pickup.status)
  const { armed, flyingId, arm, tap } = useArmMode()
  const pressHandlers = useLongPressArm(
    () => arm({ group: 'pickup', row: pickup, dateKey, index }),
    isLocked,
  )
  const dragData: CardDragData = { type: 'card', group: 'pickup', dateKey, index }
  const isArmed = armed?.group === 'pickup' && armed.row.id === pickup.id

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: pickup.id,
    data: dragData,
    disabled: { draggable: isLocked, droppable: false },
  })

  const handleClick = () => {
    if (armed !== null) {
      tap({ type: 'card', group: 'pickup', cardId: pickup.id, dateKey, index })
      return
    }
    onSelect(pickup)
  }

  return (
    <div
      ref={setNodeRef}
      onClick={handleClick}
      className="calendar-card-press"
      style={{ transform: toTranslate(transform), transition: transition ?? undefined }}
      {...pressHandlers}
      {...(isLocked ? {} : attributes)}
      {...(isLocked ? {} : listeners)}
    >
      {isDragging ? (
        <DropPlaceholder />
      ) : (
        <PickupCardFace pickup={pickup} isArmed={isArmed} isFlying={flyingId === pickup.id} />
      )}
    </div>
  )
}
