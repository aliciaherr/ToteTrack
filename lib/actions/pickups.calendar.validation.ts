import { z } from 'zod'
import { calendarDateSchema } from './dates.validation'
import { SORT_INDEX_MAX } from './calendar.validation'

// Validation schemas for `lib/actions/pickups.calendar.ts`. CONSTRAINT-24:
// this file carries NO `'use server'` directive on purpose — the directive is
// the publication mechanism, so a helper module wearing it would become a
// second set of browser-callable endpoints. It is imported by the action
// module and by nothing client-side.
//
// `SORT_INDEX_MAX` is reused from `calendar.validation` rather than redeclared:
// the two lists share one sanity bound, and two copies could drift into
// disagreeing about what a malformed payload looks like.

/**
 * Payload for `setPickupPlacement` — a day column plus a position in it.
 *
 * **`group` is a validated field, not documentation.** The discriminator that
 * keeps orders and pickups apart on the client (CONSTRAINT-25) is carried
 * across the wire and re-checked here, so a caller that reuses the order
 * placement payload — or hand-crafts one — is rejected by Zod before the action
 * touches the database. The UI preventing the mistake is not the guarantee; the
 * literal is.
 *
 * `calendarDateSchema`, not `productionDateSchema`: a pickup carries no
 * production-day rule. The calendar only renders Mon–Sat, so a dragged pickup
 * lands on a Mon–Sat in practice, but a collection is not production and the
 * server must not invent a business-day invariant the entity does not have.
 * This is also why pre-existing Saturday-dated pickups needed no write-side
 * change when Saturday became a production column (Task 88) — they were always
 * legal, merely unrenderable.
 */
export const setPickupPlacementInputSchema = z.object({
  group: z.literal('pickup', { message: 'That card is not a pickup.' }),
  pickupDate: calendarDateSchema,
  sortIndex: z
    .number()
    .int('Sort index must be a whole number.')
    .min(0, 'Sort index must be 0 or greater.')
    .max(SORT_INDEX_MAX, `Sort index must be ${SORT_INDEX_MAX} or less.`),
})

export type SetPickupPlacementInput = z.input<typeof setPickupPlacementInputSchema>
