import type { PoStatus } from '@/db/queries/orders'

// Statuses whose cards are read-only on the calendar: the build already
// happened, so the card is dimmed and exposes no drag affordance. Mirrors the
// block list `setProductionPlacement` enforces server-side — a card that looks
// draggable but is rejected on drop is worse than one that never lifts.
const BUILT_STATUSES: readonly PoStatus[] = ['completed', 'invoiced']

/**
 * True for orders whose build already happened. Exported so the drag wrapper
 * decides draggability from the same list the card dims on — two lists would
 * eventually disagree and produce a dimmed card that still lifts.
 */
export function isBuiltStatus(status: PoStatus): boolean {
  return BUILT_STATUSES.includes(status)
}

/**
 * The "already built" treatment, shared verbatim by the calendar card and the
 * dashboard production widget row so the two surfaces cannot drift apart.
 *
 * Two signals rather than one. The previous `opacity-60` alone was too subtle to
 * read as inactive at a glance, and fading further is not the fix: CONSTRAINT-19
 * ranks text legibility *above* card density, and a salesperson has to be able
 * to read a completed PO, not merely notice it. So the opacity drop stays modest
 * at 75% and the surface carries the signal — `bg-muted` (#E2E8F0) against the
 * active `bg-card` (#FFFFFF) is an obvious step down in a column of white cards,
 * while leaving the card's own text near full contrast.
 */
export const BUILT_SURFACE_CLASS = 'bg-muted opacity-75'

/** The active counterpart — the plain card surface, at full opacity. */
export const ACTIVE_SURFACE_CLASS = 'bg-card'
