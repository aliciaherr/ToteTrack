/**
 * Shared helpers for animated list rows (CustomerRow, LeadRow, TicketRow,
 * OrderRow). Kept outside `lib/animations.ts` because that file is spec'd as
 * pure variant objects only — these are per-item timing knobs + a helper that
 * composes them into motion-component props. Together they implement the
 * Task 28 rule: items 1-8 stagger at 30ms (0ms, 30ms, 60ms ... 210ms); items
 * at index >= 8 appear together with item 8.
 */
import { staggerItem } from './animations'

export const LIST_STAGGER_STEP_SECONDS = 0.03
export const LIST_STAGGER_CAP_INDEX = 7
const LIST_ITEM_DURATION_SECONDS = 0.15

/**
 * Builds the motion-component prop set for a single animated list item.
 * Spread directly onto a `motion.li` / `motion.tr`:
 *   `<motion.li {...buildListItemMotionProps(index, shouldReduceMotion)}>`
 * Returns an empty object when `shouldReduceMotion` is true so the item
 * renders instantly at its final position with no animation.
 */
export function buildListItemMotionProps(index: number, shouldReduceMotion: boolean) {
  if (shouldReduceMotion) return {}
  return {
    variants: staggerItem,
    initial: 'hidden' as const,
    animate: 'visible' as const,
    transition: {
      delay: Math.min(index, LIST_STAGGER_CAP_INDEX) * LIST_STAGGER_STEP_SECONDS,
      duration: LIST_ITEM_DURATION_SECONDS,
      ease: 'easeOut' as const,
    },
  }
}
