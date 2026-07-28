import { z } from 'zod'
import { productionDateSchema } from './dates.validation'

// `lib/actions/calendar.ts` is a `'use server'` module, and Next.js requires
// every export of such a module to be an async function. Constants, Zod
// schemas and types therefore live in this sibling (Platform-Native Rule).

/**
 * Upper bound on `production_sort_index`. Not a business limit — a day column
 * has no card cap — but a sanity bound so a malformed client payload cannot
 * push an arbitrary integer into the column.
 */
export const SORT_INDEX_MAX = 9_999

/** Payload for `setProductionPlacement` — a day column plus a position in it. */
export const setProductionPlacementInputSchema = z.object({
  productionDate: productionDateSchema,
  sortIndex: z
    .number()
    .int('Sort index must be a whole number.')
    .min(0, 'Sort index must be 0 or greater.')
    .max(SORT_INDEX_MAX, `Sort index must be ${SORT_INDEX_MAX} or less.`),
})

export type SetProductionPlacementInput = z.input<typeof setProductionPlacementInputSchema>

/**
 * Payload shared by the popup's two flag toggles, `toggleSameDayDelivery` and
 * `toggleBackhaul`. One schema rather than two identical ones: both carry the
 * target state rather than a flip, so a double-fired click cannot toggle twice,
 * and neither has any other field.
 */
export const orderFlagInputSchema = z.object({
  next: z.boolean(),
})
