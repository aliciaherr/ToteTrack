'use client'

import { useDndMonitor } from '@dnd-kit/core'

// A sibling module rather than an addition to `calendarDnd.ts`, for the same
// reason `useColumnDroppables.ts` is one: `calendarDnd.ts` imports
// `@dnd-kit/core` **type-only** and so can be pulled in anywhere
// (CONSTRAINT-03). `useDndMonitor` is a runtime import, which would force
// `'use client'` onto that module and take the exemption with it.

/**
 * Opens a collapsed callout while a card is dragged over its pill.
 *
 * Without this a callout is unreachable by drag: the drop zone is the pill
 * itself, a 44px target, and a salesperson aiming at "somewhere in the
 * unscheduled list" has nothing to aim at. Auto-opening turns the whole panel
 * into the visible target.
 *
 * The id comparison is the whole point of the parameter — it is what keeps the
 * orders pill shut while a pickup is dragged over the pickups pill next door,
 * and vice versa (CONSTRAINT-25). Both callouts call this with their own
 * droppable id; neither owns a copy of the monitor.
 *
 * @param droppableId The callout's `useDroppable` id — the only id that opens it.
 * @param open Expands the callout. Called on every qualifying drag-over frame,
 *   so it must be idempotent (both callers pass a `setIsExpanded(true)`).
 */
export function useOpenOnDragOverTarget(droppableId: string, open: () => void) {
  useDndMonitor({
    onDragOver(event) {
      if (event.over?.id === droppableId) open()
    },
  })
}
