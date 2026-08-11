'use client'

import { useDroppable } from '@dnd-kit/core'
import { pickupColumnDroppableId, type ColumnDropData } from './calendarDnd'

// The value-importing half of a day column's drop registration, split out of
// `DayColumn` when Task 81's second list pushed that renderer past the 80-line
// JSX cap (CQ-01 under CONSTRAINT-14).
//
// A sibling module rather than an addition to `calendarDnd.ts`, for the same
// reason `calendarCollision.ts` is one: `calendarDnd.ts` imports `@dnd-kit/core`
// **type-only** and so can be pulled in anywhere (CONSTRAINT-03). `useDroppable`
// is a runtime import, which would force `'use client'` onto that module and
// take the exemption with it.

/** Both of a day column's drop targets, one per card group. */
export interface ColumnDroppables {
  setOrderDropRef: (element: HTMLElement | null) => void
  setPickupDropRef: (element: HTMLElement | null) => void
  /** True while either list is under the pointer — the column's highlight. */
  isOver: boolean
}

/**
 * Registers a day column's **two** droppables, one per group (CONSTRAINT-25):
 * the orders list under the bare `dateKey`, and the pickups list under
 * `pickups:${dateKey}`.
 *
 * Two ids rather than one shared column target is what lets collision detection
 * remove the other group's list from the running before a drag preview can open
 * a slot in it. Each list is a drop target in its own right, not only through
 * its cards — otherwise an empty day could never receive one.
 *
 * Both are registered unconditionally, even for a list the header has toggled
 * off. `ColumnBody` only mounts the ref of a list it draws, so a hidden list
 * holds a registration with no element and can never be hit.
 *
 * @param dateKey The column's `yyyy-MM-dd` key — the orders droppable id.
 * @param orderCount Cards in the orders list; a drop on empty space lands after them.
 * @param pickupCount Cards in the pickups list, used the same way.
 * @returns The two `setNodeRef` callbacks plus the combined hover flag.
 */
export function useColumnDroppables(
  dateKey: string,
  orderCount: number,
  pickupCount: number,
): ColumnDroppables {
  const orderDrop: ColumnDropData = {
    type: 'column',
    group: 'order',
    dateKey,
    cardCount: orderCount,
  }
  const pickupDrop: ColumnDropData = {
    type: 'column',
    group: 'pickup',
    dateKey,
    cardCount: pickupCount,
  }

  const { setNodeRef: setOrderDropRef, isOver: isOrderOver } = useDroppable({
    id: dateKey,
    data: orderDrop,
  })
  const { setNodeRef: setPickupDropRef, isOver: isPickupOver } = useDroppable({
    id: pickupColumnDroppableId(dateKey),
    data: pickupDrop,
  })

  return { setOrderDropRef, setPickupDropRef, isOver: isOrderOver || isPickupOver }
}
