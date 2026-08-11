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

/** Droppable id of the unscheduled orders callout. Not a date — deliberately unparseable. */
export const UNSCHEDULED_DROPPABLE_ID = 'unscheduled-callout'

/**
 * Droppable id of the undated *pickups* callout. A second id rather than a
 * shared one: the two callouts are separate drop targets for separate groups,
 * and one id would make a cross-group drop a matter of which pill happened to
 * be nearer the finger (CONSTRAINT-25).
 */
export const UNSCHEDULED_PICKUPS_DROPPABLE_ID = 'unscheduled-pickups-callout'

/**
 * Origin `dateKey` for a card dragged out of an unscheduled dropdown. Such a
 * card sits in no column, so it needs a sentinel that can never equal a real
 * `yyyy-MM-dd` — otherwise the origin check could mistake a genuine placement
 * for a no-op.
 */
export const UNSCHEDULED_ORIGIN = 'unscheduled'

/**
 * Which of the calendar's two independent card lists a payload belongs to
 * (CONSTRAINT-25). Every drag payload, every drop target and every armed-mode
 * tap carries one, and **nothing may cross groups**: an order can never land in
 * a pickup list, or the reverse.
 */
export type CardGroup = 'order' | 'pickup'

// Whitelist rather than a bare cast. Payload data crosses a boundary the client
// controls, so the group is shape-checked (`typeof === 'string'` before any
// membership test, so an array or object value can never reach a string method)
// and then matched against the two legal values.
const CARD_GROUPS: readonly CardGroup[] = ['order', 'pickup']

function isCardGroup(value: unknown): value is CardGroup {
  return typeof value === 'string' && CARD_GROUPS.includes(value as CardGroup)
}

/** Payload attached to a draggable card so a drop can resolve its origin. */
export interface CardDragData {
  type: 'card'
  /** The list this card belongs to. A drop into the other group is refused. */
  group: CardGroup
  /** The day column the card sits in, or `UNSCHEDULED_ORIGIN`. */
  dateKey: string
  /** The card's current position within that column's list. */
  index: number
}

/** Payload attached to an unscheduled callout when it is a drop target. */
export interface CalloutDropData {
  type: 'callout'
  group: CardGroup
}

/** Payload attached to a day column list so a drop on empty space still resolves. */
export interface ColumnDropData {
  type: 'column'
  group: CardGroup
  dateKey: string
  /** Cards currently in that list — a drop on empty space lands after them. */
  cardCount: number
}

export type CalendarDropData = CardDragData | ColumnDropData

export interface DropTarget {
  /** Group the moved card belongs to; decides which mutation persists it. */
  group: CardGroup
  /** Id of the moved card — an order id or a pickup id, never mixed. */
  cardId: string
  /** Target day, `yyyy-MM-dd`. Always a weekday — no weekend column exists. */
  dateKey: string
  /** Exact released position within the target list. */
  index: number
}

/** A card whose calendar placement should be cleared. */
export interface UnscheduleTarget {
  group: CardGroup
  cardId: string
}

/**
 * Droppable id of a day column's pickups list. Composed rather than bare so it
 * can never collide with the orders list's id, which is the bare `dateKey`
 * (CONSTRAINT-25).
 */
export function pickupColumnDroppableId(dateKey: string): string {
  return `pickups:${dateKey}`
}

/**
 * `SortableContext` id for one list in one column. Both groups compose the same
 * way, so a Monday orders list and a Monday pickups list are two distinct
 * sortable lists rather than one list dnd-kit would happily reorder across.
 */
export function sortableListId(group: CardGroup, dateKey: string): string {
  return `${group}:${dateKey}`
}

function readDropData(data: unknown): CalendarDropData | null {
  if (typeof data !== 'object' || data === null) return null
  const candidate = data as Partial<CalendarDropData>
  if (candidate.type !== 'card' && candidate.type !== 'column') return null
  if (typeof candidate.dateKey !== 'string') return null
  if (!isCardGroup(candidate.group)) return null
  return candidate as CalendarDropData
}

function readCalloutDropData(data: unknown): CalloutDropData | null {
  if (typeof data !== 'object' || data === null) return null
  const candidate = data as Partial<CalloutDropData>
  if (candidate.type !== 'callout') return null
  if (!isCardGroup(candidate.group)) return null
  return candidate as CalloutDropData
}

/**
 * The group of whatever is currently being dragged, or null when the active
 * payload is not a calendar card.
 *
 * Read by the collision pre-filter, which is what stops a drag *preview* from
 * opening a slot the drop would refuse — rejecting only at drop time would let
 * the pickup list visibly part for an order card and then snap shut.
 */
export function readDragGroup(data: unknown): CardGroup | null {
  const origin = readDropData(data)
  return origin !== null && origin.type === 'card' ? origin.group : null
}

/**
 * The group a droppable belongs to — a card slot, a column list, or a callout —
 * or null when it is not a calendar target at all.
 */
export function readDroppableGroup(data: unknown): CardGroup | null {
  const target = readDropData(data)
  if (target !== null) return target.group
  return readCalloutDropData(data)?.group ?? null
}

/**
 * Resolves a finished drag into the placement it should persist, or null when
 * nothing should be written.
 *
 * Returns null for four distinct cases, all of which must stay silent:
 * a drop outside any target, a drop whose target carries no calendar data,
 * **a cross-group drop** — an order released over a pickup list, or the reverse
 * (CONSTRAINT-25) — and **a drop at the card's origin**, since a press-and-release
 * that moved a few pixels is not an edit and firing a mutation for it would burn
 * a write and a revalidation on every mis-tap.
 *
 * The cross-group check is the last line rather than the only one: collision
 * detection is pre-filtered by group, so a cross-group `over` should never
 * arrive here. It is kept because a silent write to the wrong table is the one
 * failure this feature cannot recover from, and the check costs one comparison.
 *
 * The target index comes from the card that was dropped *onto*, so a card lands
 * exactly where it was released rather than being appended to the end. Dropping
 * on a list's empty space is the one case that appends, because there is no
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
  if (target.group !== origin.group) return null

  const index = target.type === 'card' ? target.index : target.cardCount

  if (target.dateKey === origin.dateKey && index === origin.index) return null

  return {
    group: origin.group,
    cardId: String(event.active.id),
    dateKey: target.dateKey,
    index,
  }
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
 * Resolves a drop onto an unscheduled callout into the card that should have
 * its placement cleared, or null when the drop was not that gesture.
 *
 * Dragging a card onto its own group's callout is the second entry point to the
 * clear mutation — the popup's `Remove from calendar` is the first — and the two
 * are one operation (CONSTRAINT-19 for orders, CONSTRAINT-25 for pickups). A
 * card that was already unscheduled returns null: there is nothing to clear, and
 * firing the mutation would burn a write to set nulls to null.
 *
 * A card dropped on the *other* group's callout returns null too. The two pills
 * sit side by side in one header, so without the group check a mis-aimed drop
 * would silently unschedule across entities.
 */
export function resolveUnscheduleTarget(event: DragEndEvent): UnscheduleTarget | null {
  const origin = readDropData(event.active.data.current)
  if (origin === null || origin.type !== 'card') return null
  if (origin.dateKey === UNSCHEDULED_ORIGIN) return null

  const overData = readCalloutDropData(event.over?.data.current)
  if (overData === null) return null
  if (overData.group !== origin.group) return null

  return { group: origin.group, cardId: String(event.active.id) }
}
