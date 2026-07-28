import { isValid, parseISO } from 'date-fns'
import { z } from 'zod'
import { isBusinessDay } from '@/lib/dates'

// Date-input validation shared by the server actions in `lib/actions/`.
//
// Two write boundaries validate a `production_date` — the calendar's placement
// actions (`calendar.validation.ts`) and the order-create schema
// (`orders.validation.ts`) — and CONSTRAINT-19 permits exactly one
// implementation of the weekday rule, so it lives here rather than in either
// caller. A neutral module is required, not merely tidier: `orders.validation`
// owns `ISO_DATE_RE` and `calendar.validation` already imports from it, so
// defining the schema in either one and importing it from the other would
// close an import cycle and leave `ISO_DATE_RE` in the temporal dead zone at
// module-evaluation time. `ISO_DATE_RE` therefore lives here too, re-exported
// from `orders.validation` so its existing consumers are unaffected.

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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

/**
 * A stored production date: a real `yyyy-MM-dd` calendar day that falls on a
 * weekday.
 *
 * The no-weekend invariant (CONSTRAINT-19) is enforced here, at the write
 * boundary, and nowhere else. A card's column IS its stored `production_date`,
 * and no read path second-guesses it, so this refinement is the only thing
 * standing between a bad payload and a card that can never be rendered — the
 * calendar has no Saturday or Sunday column to draw it in. Every writer of the
 * column — drag placement, the `+ Add order` list, and PO creation — goes
 * through this one schema.
 */
export const productionDateSchema = z
  .string()
  .regex(ISO_DATE_RE, 'Invalid date format.')
  .refine((value) => parseIsoDateOrNull(value) !== null, 'Invalid date format.')
  .refine((value) => {
    const parsed = parseIsoDateOrNull(value)
    return parsed === null || isBusinessDay(parsed)
  }, 'Production dates must fall on a weekday.')
