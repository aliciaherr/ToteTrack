'use server'

import { z } from 'zod'
import { findOrdersByPoNumber, type CalendarSearchResult } from '@/db/queries/calendar'
import { PO_NUMBER_MAX, firstZodMessage } from './orders.validation'
import { assertAuthenticated, GENERIC_FAILURE_MESSAGE } from './auth.guard'

// The calendar's read-only lookup, in a module of its own rather than appended
// to `lib/actions/calendar.ts`. That file owns placement *writes* — every
// export there mutates a row and revalidates a route. This one writes nothing
// and revalidates nothing, and mixing a read into it would mean every reader of
// that module has to check which kind of export they are looking at.

/**
 * A search term is a PO fragment, so it is bounded by the same length as a whole
 * PO number. Anything longer cannot match one and is rejected before it reaches
 * a `LIKE` pattern.
 */
const searchTermSchema = z
  .string()
  .trim()
  .min(1, 'Type a PO number to search.')
  .max(PO_NUMBER_MAX, `Search for ${PO_NUMBER_MAX} characters or fewer.`)

/**
 * Finds calendar orders whose PO number contains `term`.
 *
 * The term is bound as a parameter by the query, never interpolated into SQL
 * (SEC-02). It is still validated here — length-capped and non-empty — because
 * an unbounded term is a pointless round-trip and an empty one would otherwise
 * become the `%%` pattern that matches every order in the table.
 *
 * `%` and `_` inside the term stay literal-ish: they are `LIKE` wildcards, so a
 * term containing them matches more loosely than the viewer intended. That is
 * deliberately not escaped — a PO number containing either is possible but
 * vanishingly rare, and the failure mode is a wider result list the viewer can
 * see and refine, not a wrong answer or an injection.
 *
 * Called on every pause in typing, not only on Enter, so it stays a single
 * indexed `ILIKE` with a small `LIMIT` and does no work the results list will
 * not show.
 *
 * @param term Raw text from the calendar's search box.
 * @returns `{ hits, hasMore }` — hits possibly empty — or `{ error }` with a
 * user-facing message. Never throws: a search box that rejects on the client
 * leaves the header in a spinner with nothing to explain it.
 */
export async function searchCalendarOrders(
  term: string,
): Promise<CalendarSearchResult | { error: string }> {
  try {
    const denied = await assertAuthenticated()
    if (denied) return denied

    const parsed = searchTermSchema.safeParse(term)
    if (!parsed.success) return { error: firstZodMessage(parsed.error) }

    return await findOrdersByPoNumber(parsed.data)
  } catch (cause) {
    console.error('searchCalendarOrders: search failed', {
      operation: 'searchCalendarOrders',
      termLength: term.length,
      cause,
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}
