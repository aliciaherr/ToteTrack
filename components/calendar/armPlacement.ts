import { UNSCHEDULED_ORIGIN, type DropTarget } from './calendarDnd'
import type { CalendarOrderRow } from '@/db/queries/calendar'

/**
 * Still-finger duration before a touch press arms a card. Longer than the old
 * `TouchSensor`'s 250ms so it clears the point where a press stops reading as
 * an emphatic tap, but well short of iPadOS's ~500ms system long-press — the
 * app must win the gesture before the OS starts competing for it (A-05).
 */
export const ARM_DELAY_MS = 350

/**
 * Finger drift tolerated during the arming press. The old 8px was tighter than
 * a resting fingertip's natural wobble over the delay window, which silently
 * cancelled legitimate long-presses — the single biggest source of the
 * "botchy" feel A-05 recorded. Movement past this is a scroll, not a press.
 */
export const ARM_MOVE_TOLERANCE_PX = 15

/**
 * How long a just-placed card keeps its `layoutId` after a tap placement, so
 * the fly-to-destination animation can run once the refreshed server data
 * lands. Comfortably longer than a `router.refresh()` round-trip plus the
 * layout transition; after it, the card goes back to being a plain element
 * that desktop drags can move without framer-motion interfering.
 */
export const FLY_RESET_MS = 1500

/** The card currently armed by a long-press, with its origin position. */
export interface ArmedCard {
  row: CalendarOrderRow
  /** Column the card sits in, or `UNSCHEDULED_ORIGIN` for the callout dropdown. */
  dateKey: string
  /** Rendered position within that column. */
  index: number
}

/** A tap on a card while another card is armed. */
export interface CardTapTarget {
  type: 'card'
  orderId: string
  dateKey: string
  /** The tapped card's rendered position — pre-removal, unlike a drag's. */
  index: number
}

/** A tap on a day column's empty space while a card is armed. */
export interface ColumnTapTarget {
  type: 'column'
  dateKey: string
  /** Cards currently rendered in the column, including the armed card if it lives there. */
  cardCount: number
}

/** A tap on the unscheduled callout while a card is armed. */
export interface CalloutTapTarget {
  type: 'callout'
}

export type TapTarget = CardTapTarget | ColumnTapTarget | CalloutTapTarget

/** What a resolved tap should do. `cancel` disarms without writing. */
export type TapAction =
  | { kind: 'place'; target: DropTarget }
  | { kind: 'unschedule'; orderId: string }
  | { kind: 'cancel' }

/**
 * Insertion index for a tap on a card, in the server's terms.
 *
 * `setProductionPlacement` stores the index it is given, and the drag path
 * feeds it dnd-kit's displayed index — which counts positions *with the moved
 * card already lifted out*. A tap has no lift, so the tapped card's rendered
 * index counts the armed card too; when both share a column and the armed card
 * sits above the tap, the rendered index is one higher than the insertion the
 * salesperson aimed at ("the armed card takes the tapped card's place").
 */
function insertionIndex(armed: ArmedCard, target: CardTapTarget): number {
  const sameColumn = target.dateKey === armed.dateKey
  return sameColumn && armed.index < target.index ? target.index - 1 : target.index
}

function resolveCardTap(armed: ArmedCard, target: CardTapTarget): TapAction {
  if (target.orderId === armed.row.id) return { kind: 'cancel' }
  // A card inside the callout dropdown is not a position to insert at — the
  // dropdown has no calendar order. Tapping one means "into the unscheduled
  // list", the same statement as tapping the callout itself.
  if (target.dateKey === UNSCHEDULED_ORIGIN) return resolveCalloutTap(armed)

  const index = insertionIndex(armed, target)
  if (target.dateKey === armed.dateKey && index === armed.index) return { kind: 'cancel' }

  return {
    kind: 'place',
    target: { orderId: armed.row.id, dateKey: target.dateKey, index },
  }
}

function resolveColumnTap(armed: ArmedCard, target: ColumnTapTarget): TapAction {
  // Appending within the card's own column: the rendered count includes the
  // armed card, so last place is `cardCount - 1` — and if it is already there,
  // the tap changes nothing and must not burn a write.
  const sameColumn = target.dateKey === armed.dateKey
  const index = sameColumn ? target.cardCount - 1 : target.cardCount
  if (sameColumn && index === armed.index) return { kind: 'cancel' }

  return {
    kind: 'place',
    target: { orderId: armed.row.id, dateKey: target.dateKey, index },
  }
}

function resolveCalloutTap(armed: ArmedCard): TapAction {
  // Already unscheduled — nothing to clear, and firing the mutation would burn
  // a write to set two nulls to null. Mirrors `resolveUnscheduleTarget`.
  if (armed.dateKey === UNSCHEDULED_ORIGIN) return { kind: 'cancel' }
  return { kind: 'unschedule', orderId: armed.row.id }
}

/**
 * Resolves a tap made while a card is armed into the action it should perform
 * (Task 68). The touch counterpart of `resolveDropTarget` /
 * `resolveUnscheduleTarget`, sharing their contracts: origin-position taps are
 * silent no-ops, an unscheduled card cannot be re-unscheduled, and a `place`
 * carries the same post-removal insertion index a drag would have produced —
 * the server cannot tell the two gestures apart.
 */
export function resolveTapAction(armed: ArmedCard, target: TapTarget): TapAction {
  switch (target.type) {
    case 'card':
      return resolveCardTap(armed, target)
    case 'column':
      return resolveColumnTap(armed, target)
    case 'callout':
      return resolveCalloutTap(armed)
  }
}
