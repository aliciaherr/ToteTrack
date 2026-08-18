import {
  UNSCHEDULED_ORIGIN,
  type CardGroup,
  type DropTarget,
  type UnscheduleTarget,
} from './calendarDnd'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

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

/**
 * The card currently armed by a long-press, with its origin position.
 *
 * A tagged union rather than one shape with a widened `row`, so the group and
 * the row type can never disagree: an armed pickup carries a
 * `CalendarPickupRow` and nothing else (CONSTRAINT-25).
 */
export type ArmedCard =
  | { group: 'order'; row: CalendarOrderRow; dateKey: string; index: number }
  | { group: 'pickup'; row: CalendarPickupRow; dateKey: string; index: number }

/** A tap on a card while another card is armed. */
export interface CardTapTarget {
  type: 'card'
  /** The tapped card's list. A tap from the other group never places. */
  group: CardGroup
  cardId: string
  dateKey: string
  /**
   * The tapped card's rendered position, used verbatim as the insertion index.
   * The armed card takes this slot; everything else closes up around it. This is
   * the same number `resolveDropTarget` reads off a drag's `over` payload, which
   * is what makes touch and drag byte-identical (Task 91).
   */
  index: number
}

/** A tap on one of a day column's two list areas while a card is armed. */
export interface ColumnTapTarget {
  type: 'column'
  group: CardGroup
  dateKey: string
  /** Cards currently rendered in that list, including the armed card if it lives there. */
  cardCount: number
}

/** A tap on an unscheduled callout while a card is armed. */
export interface CalloutTapTarget {
  type: 'callout'
  group: CardGroup
}

export type TapTarget = CardTapTarget | ColumnTapTarget | CalloutTapTarget

/** What a resolved tap should do. `cancel` disarms without writing. */
export type TapAction =
  | { kind: 'place'; target: DropTarget }
  | { kind: 'unschedule'; target: UnscheduleTarget }
  | { kind: 'cancel' }

/**
 * One rule, everywhere: **the armed card takes the tapped card's position**
 * (Task 91). The tapped card's rendered index is used verbatim — same day or
 * across days, up the column or down it — and everything else closes up around
 * the moved card.
 *
 * The earlier same-column `index - 1` correction was wrong, not merely
 * different. It assumed the drag path feeds the server a *post-removal* index
 * while a tap feeds a pre-removal one. It does not: `resolveDropTarget` reads
 * `index` off the `over` payload, which is the card's static rendered position
 * from props and is never re-numbered mid-drag. Both gestures therefore speak
 * the same number, and subtracting one from the tap made a downward same-day
 * move land one slot short of where the salesperson aimed. Removing it retires
 * the touch/drag asymmetry; the parity suite in `armPlacement.test.ts` runs the
 * same logical move through both resolvers and fails loudly if they diverge.
 *
 * There is no "tapped my own slot" cancel here. Within one group and one
 * `dateKey` a rendered index identifies exactly one card, so an equal index
 * means the armed card itself — already caught by the `cardId` guard above.
 */
function resolveCardTap(armed: ArmedCard, target: CardTapTarget): TapAction {
  if (target.cardId === armed.row.id) return { kind: 'cancel' }
  // A card inside a callout dropdown is not a position to insert at — the
  // dropdown has no calendar order. Tapping one means "into the unscheduled
  // list", the same statement as tapping the callout itself.
  if (target.dateKey === UNSCHEDULED_ORIGIN) return resolveCalloutTap(armed)

  return {
    kind: 'place',
    target: {
      group: armed.group,
      cardId: armed.row.id,
      dateKey: target.dateKey,
      index: target.index,
    },
  }
}

function resolveColumnTap(armed: ArmedCard, target: ColumnTapTarget): TapAction {
  // Appending within the card's own list: the rendered count includes the armed
  // card, so last place is `cardCount - 1` — and if it is already there, the tap
  // changes nothing and must not burn a write. The count is this group's list
  // only, so a column holding four orders and one pickup never mixes the two.
  const sameColumn = target.dateKey === armed.dateKey
  const index = sameColumn ? target.cardCount - 1 : target.cardCount
  if (sameColumn && index === armed.index) return { kind: 'cancel' }

  return {
    kind: 'place',
    target: { group: armed.group, cardId: armed.row.id, dateKey: target.dateKey, index },
  }
}

function resolveCalloutTap(armed: ArmedCard): TapAction {
  // Already unscheduled — nothing to clear, and firing the mutation would burn
  // a write to set nulls to null. Mirrors `resolveUnscheduleTarget`.
  if (armed.dateKey === UNSCHEDULED_ORIGIN) return { kind: 'cancel' }
  return { kind: 'unschedule', target: { group: armed.group, cardId: armed.row.id } }
}

/**
 * Resolves a tap made while a card is armed into the action it should perform
 * (Task 68). The touch counterpart of `resolveDropTarget` /
 * `resolveUnscheduleTarget`, sharing their contracts: origin-position taps are
 * silent no-ops, an unscheduled card cannot be re-unscheduled, and a `place`
 * carries the byte-identical insertion index a drag would have produced — the
 * server cannot tell the two gestures apart (Task 91).
 *
 * **The group is checked first and is absolute** (CONSTRAINT-25). An armed
 * pickup ignores every order target and vice versa, whether that target is a
 * card, a list's empty space or a callout pill. `cancel` rather than a
 * silently-ignored tap, because the same outcome already exists: an unclaimed
 * tap bubbles to the calendar root and disarms, so a cross-group tap behaving
 * any other way would be the odd one out.
 */
export function resolveTapAction(armed: ArmedCard, target: TapTarget): TapAction {
  if (target.group !== armed.group) return { kind: 'cancel' }

  switch (target.type) {
    case 'card':
      return resolveCardTap(armed, target)
    case 'column':
      return resolveColumnTap(armed, target)
    case 'callout':
      return resolveCalloutTap(armed)
  }
}
