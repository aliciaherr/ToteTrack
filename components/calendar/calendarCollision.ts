'use client'

import { closestCenter, type CollisionDetection } from '@dnd-kit/core'
import { readDragGroup, readDroppableGroup } from './calendarDnd'

// The value-importing half of the drop rules. `calendarDnd.ts` stays type-only
// so it can be imported anywhere (CONSTRAINT-03); this file reaches
// `closestCenter` at runtime and therefore carries `'use client'`.

/**
 * `closestCenter`, restricted to droppables in the dragged card's own group.
 *
 * This is where "an order card cannot be dropped into the pickup list" is
 * actually enforced for the **preview**, not just the write. `resolveDropTarget`
 * refuses a cross-group drop, but a refusal at drop time comes too late to be
 * honest: dnd-kit would still report the pickup list as `over`, the sortable
 * strategy would part its cards to show a slot, and the card would then snap
 * back to where it started with no explanation. Filtering the candidate
 * containers *before* the collision algorithm runs means the other group's
 * lists are simply not in the running — no gap opens, and the nearest legal
 * slot in the card's own group wins instead (CONSTRAINT-25).
 *
 * Cards are uniform and stacked, so nearest-centre remains the position the
 * salesperson visually aimed at; the filter changes the candidate set, never
 * the algorithm.
 *
 * A drag whose payload carries no group is passed through unfiltered rather
 * than dropped: nothing in the calendar produces such a drag, and silently
 * returning no collisions would make a future one look like a dead board.
 */
export const groupedCollisionDetection: CollisionDetection = (args) => {
  const group = readDragGroup(args.active.data.current)
  if (group === null) return closestCenter(args)

  return closestCenter({
    ...args,
    droppableContainers: args.droppableContainers.filter(
      (container) => readDroppableGroup(container.data.current) === group,
    ),
  })
}
