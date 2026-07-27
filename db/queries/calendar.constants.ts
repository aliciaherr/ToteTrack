/**
 * Pure constants for the production calendar — no DB imports, safe to
 * consume from client components. Lives outside `calendar.ts` because that
 * module imports `@/db` (postgres-js driver), which is Node-only; any
 * client component that value-imports from there drags the entire driver
 * into the browser bundle and fails the production webpack build with
 * `Module not found: 'fs'` / `'perf_hooks'`.
 */

/**
 * Unscheduled POs listed inline in the callout dropdown before it scrolls.
 * Matches the 4-card target of a day column so the dropdown reads as the same
 * kind of surface (CONSTRAINT-19).
 */
export const UNSCHEDULED_DROPDOWN_VISIBLE = 4

/**
 * Weeks fetched either side of the visible week. The week strip pages one week
 * at a time; buffering 4 weeks each way means arrow navigation stays instant
 * for a month in both directions without a round-trip.
 */
export const CALENDAR_WEEKS_BUFFER = 4
