import { isValid, parseISO } from 'date-fns'
import { z } from 'zod'
import { isBusinessDay } from '@/lib/dates'
import { ISO_DATE_RE } from './orders.validation'

// `lib/actions/calendar.ts` is a `'use server'` module, and Next.js requires
// every export of such a module to be an async function. Constants, Zod
// schemas and types therefore live in this sibling (Platform-Native Rule).

/**
 * Upper bound on `production_sort_index`. Not a business limit — a day column
 * has no card cap — but a sanity bound so a malformed client payload cannot
 * push an arbitrary integer into the column.
 */
export const SORT_INDEX_MAX = 9_999

/**
 * Non-throwing counterpart to `parseDbDate`, for use inside Zod refinements.
 * `ISO_DATE_RE` only proves the *shape* `yyyy-MM-dd`; impossible calendar dates
 * such as `2026-02-31` still parse to an Invalid Date and must be rejected as a
 * validation failure rather than a thrown `InvalidDateError`.
 *
 * Uses `parseISO`, never `new Date(string)` — the latter reads a date-only
 * string as UTC midnight and lands on the previous calendar day in any
 * negative-offset timezone.
 */
function parseIsoDateOrNull(value: string): Date | null {
  const parsed = parseISO(value)
  return isValid(parsed) ? parsed : null
}

// The no-weekend invariant (CONSTRAINT-19) is enforced here, at the write
// boundary, and nowhere else. A card's column IS its stored `production_date`,
// and no read path second-guesses it, so this refinement is the only thing
// standing between a bad payload and a card that can never be rendered — the
// calendar has no Saturday or Sunday column to draw it in.
const productionDateSchema = z
  .string()
  .regex(ISO_DATE_RE, 'Invalid date format.')
  .refine((value) => parseIsoDateOrNull(value) !== null, 'Invalid date format.')
  .refine((value) => {
    const parsed = parseIsoDateOrNull(value)
    return parsed === null || isBusinessDay(parsed)
  }, 'Production dates must fall on a weekday.')

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

/** Payload for `toggleSameDayDelivery` — the target state, not a flip. */
export const toggleSameDayDeliveryInputSchema = z.object({
  next: z.boolean(),
})
