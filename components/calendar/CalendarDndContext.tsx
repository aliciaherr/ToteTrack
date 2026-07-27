'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useReducedMotion } from 'framer-motion'
import ProductionCard from './ProductionCard'
import {
  AUTO_SCROLL_EDGE_RATIO,
  POINTER_ACTIVATION_DISTANCE_PX,
  TOUCH_ACTIVATION_DELAY_MS,
  TOUCH_ACTIVATION_TOLERANCE_PX,
  resolveDropTarget,
  resolveUnscheduleTarget,
  type DropTarget,
} from './calendarDnd'
import type { CalendarOrderRow } from '@/db/queries/calendar'

interface CalendarDndContextProps {
  children: React.ReactNode
  /** Every card currently on the calendar, for resolving the drag overlay. */
  rows: CalendarOrderRow[]
  /** Persists a resolved placement. Called only for real moves. */
  onPlace: (target: DropTarget) => void
  /** Clears a placement when a card is dropped on the unscheduled callout. */
  onUnschedule: (orderId: string) => void
}

/** The three sensors, each solving a different drag/gesture collision. */
function useCalendarSensors() {
  return useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: POINTER_ACTIVATION_DISTANCE_PX },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: TOUCH_ACTIVATION_DELAY_MS,
        tolerance: TOUCH_ACTIVATION_TOLERANCE_PX,
      },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
}

/**
 * Drag-and-drop shell for the production calendar.
 *
 * Three sensors, each solving a different collision between dragging and the
 * gestures the calendar already uses:
 * - **Pointer** activates after {@link POINTER_ACTIVATION_DISTANCE_PX}px so a
 *   click still opens the card popup instead of starting a drag.
 * - **Touch** activates on a ~{@link TOUCH_ACTIVATION_DELAY_MS}ms long press so
 *   a swipe scrolls the week strip. This is the unvalidated half of A-05 — if
 *   it misbehaves on a real iPad the agreed fallback is tap-to-select then
 *   tap-target, which replaces this sensor rather than tuning it.
 * - **Keyboard** gives the whole interaction a non-pointer path.
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
