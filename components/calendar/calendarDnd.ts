import type { DragEndEvent } from '@dnd-kit/core'

/**
 * Pixels of movement before a pointer drag begins. Below this a press is a tap
 * and opens the card popup instead — without a threshold every attempt to open
 * a card would start a drag.
 */
export const POINTER_ACTIVATION_DISTANCE_PX = 6

/**
 * Auto-scroll edge zone as a fraction of the scroll container's width.
 * `@dnd-kit` expresses this as a ratio, not pixels; 0.08 of iPad landscape's
 * 1024px is ~82px, the ~80px edge the design calls for.
 */
export const AUTO_SCROLL_EDGE_RATIO = 0.08

/** Droppable id of the unscheduled callout. Not a date — deliberately unparseable. */
export const UNSCHEDULED_DROPPABLE_ID = 'unscheduled-callout'

/**
 * Origin `dateKey` for a card dragged out of the unscheduled dropdown. Such a
 * card sits in no column, so it needs a sentinel that can never equal a real
 * `yyyy-MM-dd` — otherwise the origin check could mistake a genuine placement
 * for a no-op.
 */
export const UNSCHEDULED_ORIGIN = 'unscheduled'

/** Payload attached to a draggable card so a drop can resolve its origin. */
export interface CardDragData {
  type: 'card'
  /** The day column the card sits in, or `UNSCHEDULED_ORIGIN`. */
  dateKey: string
  /** The card's current position within that column. */
  index: number
}

/** Payload attached to the unscheduled callout when it is a drop target. */
export interface CalloutDropData {
  type: 'callout'
}

/** Payload attached to a day column so a drop on empty space still resolves. */
export interface ColumnDropData {
  type: 'column'
  dateKey: string
  /** Cards currently in the column — a drop on empty space lands after them. */
  cardCount: number
}

export type CalendarDropData = CardDragData | ColumnDropData

export interface DropTarget {
  orderId: string
  /** Target day, `yyyy-MM-dd`. Always a weekday — no weekend column exists. */
  dateKey: string
  /** Exact released position within the target column. */
  index: number
}

function readDropData(data: unknown): CalendarDropData | null {
  if (typeof data !== 'object' || data === null) return null
  const candidate = data as Partial<CalendarDropData>
  if (candidate.type !== 'card' && candidate.type !== 'column') return null
  if (typeof candidate.dateKey !== 'string') return null
  return candidate as CalendarDropData
}

/**
 * Resolves a finished drag into the placement it should persist, or null when
 * nothing should be written.
 *
 * Returns null for three distinct cases, all of which must stay silent:
 * a drop outside any target, a drop whose target carries no calendar data, and
 * **a drop at the card's origin** — a press-and-release that moved a few pixels
 * is not an edit, and firing a mutation for it would burn a write and a
 * revalidation on every mis-tap.
 *
 * The target index comes from the card that was dropped *onto*, so a card lands
 * exactly where it was released rather than being appended to the end. Dropping
 * on a column's empty space is the one case that appends, because there is no
 * neighbouring card to position against.
 *
 * There is no weekend branch: `dateKey` can only ever be a rendered column, and
 * the calendar renders Mon–Fri only (CONSTRAINT-19). The server rejects weekend
 * dates independently.
 */
export function resolveDropTarget(event: DragEndEvent): DropTarget | null {
  const origin = readDropData(event.active.data.current)
  if (origin === null || origin.type !== 'card') return null
  if (!event.over) return null

  const target = readDropData(event.over.data.current)
  if (target === null) return null

  const index = target.type === 'card' ? target.index : target.cardCount

  if (target.dateKey === origin.dateKey && index === origin.index) return null

  return { orderId: String(event.active.id), dateKey: target.dateKey, index }
}

/**
 * Inline replacement for `CSS.Transform.toString` from `@dnd-kit/utilities`,
 * which is only a transitive dependency here and must not be imported directly.
 * Cards never scale during a drag, so translation is the whole transform.
 */
export function toTranslate(transform: { x: number; y: number } | null): string | undefined {
  if (transform === null) return undefined
  return `translate3d(${transform.x}px, ${transform.y}px, 0)`
}

/**
 * Resolves a drop onto the unscheduled callout into the order that should have
 * its placement cleared, or null when the drop was not that gesture.
 *
 * Dragging a card onto the callout is the second entry point to
 * `clearProductionPlacement` — the `Remove from calendar` menu item is the
 * first — and the two are one operation (CONSTRAINT-19). A card that was
 * already unscheduled returns null: there is nothing to clear, and firing the
 * mutation would burn a write to set two nulls to null.
 *
 * The card leaves the calendar entirely and appears in the callout, whatever
 * its delivery date — dropping it there is a statement that the order has no
 * build day yet (CONSTRAINT-19).
 */
export function resolveUnscheduleTarget(event: DragEndEvent): string | null {
  const origin = readDropData(event.active.data.current)
  if (origin === null || origin.type !== 'card') return null
  if (origin.dateKey === UNSCHEDULED_ORIGIN) return null

  const overData = event.over?.data.current as Partial<CalloutDropData> | undefined
  if (overData?.type !== 'callout') return null

  return String(event.active.id)
}
