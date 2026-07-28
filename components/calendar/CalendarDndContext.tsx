'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type PointerSensorOptions,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useReducedMotion } from 'framer-motion'
import ProductionCard from './ProductionCard'
import {
  AUTO_SCROLL_EDGE_RATIO,
  POINTER_ACTIVATION_DISTANCE_PX,
  resolveDropTarget,
  resolveUnscheduleTarget,
  type DropTarget,
} from './calendarDnd'
import type { CalendarOrderRow } from '@/db/queries/calendar'

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
  /** Every card currently on the calendar, for resolving the drag overlay. */
  rows: CalendarOrderRow[]
  /** Persists a resolved placement. Called only for real moves. */
  onPlace: (target: DropTarget) => void
  /** Clears a placement when a card is dropped on the unscheduled callout. */
  onUnschedule: (orderId: string) => void
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
 * Collision detection is `closestCenter`: cards are uniform and stacked, so the
 * nearest centre is the position the salesperson visually aimed at.
 */
export default function CalendarDndContext({
  children,
  rows,
  onPlace,
  onUnschedule,
}: CalendarDndContextProps) {
  const shouldReduceMotion = Boolean(useReducedMotion())
  const [activeRow, setActiveRow] = useState<CalendarOrderRow | null>(null)
  const sensors = useCalendarSensors()

  const autoScroll = useMemo(
    () => ({ threshold: { x: AUTO_SCROLL_EDGE_RATIO, y: 0 } }),
    [],
  )

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      setActiveRow(rows.find((row) => row.id === event.active.id) ?? null)
    },
    [rows],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveRow(null)

      // The callout is checked first: it is a drop target that means "remove
      // the placement", not "place here", and it carries no date to resolve.
      const unscheduleId = resolveUnscheduleTarget(event)
      if (unscheduleId !== null) {
        onUnschedule(unscheduleId)
        return
      }

      const target = resolveDropTarget(event)
      if (target === null) return
      onPlace(target)
    },
    [onPlace, onUnschedule],
  )

  const handleDragCancel = useCallback(() => setActiveRow(null), [])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      autoScroll={autoScroll}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {children}
      <DragOverlay dropAnimation={shouldReduceMotion ? null : undefined}>
        {activeRow ? <ProductionCard row={activeRow} isDragging /> : null}
      </DragOverlay>
    </DndContext>
  )
}
