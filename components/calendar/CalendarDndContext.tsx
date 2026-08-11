'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type PointerSensorOptions,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useReducedMotion } from 'framer-motion'
import DragOverlayCard, { findActiveCard, type ActiveCard } from './CalendarDragOverlay'
import { groupedCollisionDetection } from './calendarCollision'
import {
  AUTO_SCROLL_EDGE_RATIO,
  POINTER_ACTIVATION_DISTANCE_PX,
  resolveDropTarget,
  resolveUnscheduleTarget,
  type DropTarget,
  type UnscheduleTarget,
} from './calendarDnd'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

/**
 * `PointerSensor` that ignores touch pointers. On touch devices dragging is
 * replaced by long-press-to-arm + tap-to-place (Task 68, the A-05
 * contingency), and a sensor that also reacted to touch would race the
 * arming long-press — the exact class of gesture collision that made touch
 * drag unusable. Mouse and pen keep the full drag experience.
 */
class MouseAndPenPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: (
        { nativeEvent }: React.PointerEvent,
        { onActivation }: PointerSensorOptions,
      ): boolean => {
        if (nativeEvent.pointerType === 'touch') return false
        if (!nativeEvent.isPrimary || nativeEvent.button !== 0) return false
        onActivation?.({ event: nativeEvent })
        return true
      },
    },
  ]
}

interface CalendarDndContextProps {
  children: React.ReactNode
  /** Every draggable order card on screen, for resolving the drag overlay. */
  rows: CalendarOrderRow[]
  /** Every draggable pickup card on screen, resolved the same way. */
  pickups: CalendarPickupRow[]
  /** Persists a resolved placement. Called only for real moves. */
  onPlace: (target: DropTarget) => void
  /** Clears a placement when a card is dropped on its own group's callout. */
  onUnschedule: (target: UnscheduleTarget) => void
}

/** The two drag sensors. Touch is deliberately absent — see the class above. */
function useCalendarSensors() {
  return useSensors(
    useSensor(MouseAndPenPointerSensor, {
      activationConstraint: { distance: POINTER_ACTIVATION_DISTANCE_PX },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
}

/**
 * Drag-and-drop shell for the production calendar.
 *
 * Two sensors, each solving a collision between dragging and the gestures the
 * calendar already uses:
 * - **Pointer** (mouse and pen only) activates after
 *   {@link POINTER_ACTIVATION_DISTANCE_PX}px so a click still opens the card
 *   popup instead of starting a drag.
 * - **Keyboard** gives the whole interaction a non-pointer path.
 *
 * Touch has no drag sensor at all. A-05's contingency fired on a real iPad
 * (2026-07-27): touch drag was unusable in every browser, so on touch the
 * interaction is long-press-to-arm + tap-to-place — see `armMode.tsx` and
 * `useLongPressArm.ts` (Task 68).
 *
 * Collision detection is `groupedCollisionDetection`: `closestCenter` — cards
 * are uniform and stacked, so the nearest centre is the position the
 * salesperson visually aimed at — restricted to droppables in the dragged
 * card's own group. Filtering the candidates *before* the algorithm runs is
 * what stops a drag **preview** opening a slot the drop would refuse
 * (CONSTRAINT-25); rejecting only at drop time would let the pickups list part
 * for an order card and then snap shut with no explanation.
 */
export default function CalendarDndContext({
  children,
  rows,
  pickups,
  onPlace,
  onUnschedule,
}: CalendarDndContextProps) {
  const shouldReduceMotion = Boolean(useReducedMotion())
  const [activeCard, setActiveCard] = useState<ActiveCard | null>(null)
  const sensors = useCalendarSensors()

  const autoScroll = useMemo(
    () => ({ threshold: { x: AUTO_SCROLL_EDGE_RATIO, y: 0 } }),
    [],
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => setActiveCard(findActiveCard(event, rows, pickups)),
    [rows, pickups],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveCard(null)

      // The callout is checked first: it is a drop target that means "remove
      // the placement", not "place here", and it carries no date to resolve.
      // Both resolvers refuse a cross-group event on their own, so neither
      // branch can route a card into the other group's mutation.
      const unscheduleTarget = resolveUnscheduleTarget(event)
      if (unscheduleTarget !== null) {
        onUnschedule(unscheduleTarget)
        return
      }

      const target = resolveDropTarget(event)
      if (target === null) return
      onPlace(target)
    },
    [onPlace, onUnschedule],
  )

  const handleDragCancel = useCallback(() => setActiveCard(null), [])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={groupedCollisionDetection}
      autoScroll={autoScroll}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {children}
      <DragOverlay dropAnimation={shouldReduceMotion ? null : undefined}>
        {activeCard ? <DragOverlayCard card={activeCard} /> : null}
      </DragOverlay>
    </DndContext>
  )
}
