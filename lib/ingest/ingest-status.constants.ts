/**
 * Timings and limits for the review-queue status in the menu (Task 105).
 *
 * No DB import and no runtime dependency, so the client hook and the tests can
 * import it (the `ingest.constants.ts` precedent).
 */

/** How often a running "Check mail now" re-reads the status. */
export const INGEST_STATUS_POLL_MS = 5_000

/**
 * How long a "Check mail now" waits for `last_run_at` to move before giving
 * up. Matches the run route's `maxDuration` (300 s): a run still going after
 * this has been killed by the platform, so waiting longer cannot help.
 */
export const INGEST_RUN_WATCH_MS = 300_000

/**
 * A last check older than this is shown as stale. The cron runs daily and
 * fires anywhere inside its hour, so a healthy gap is up to 25 h; one more hour
 * of grace keeps a slightly late cron from looking like a failure.
 */
export const INGEST_STALE_AFTER_MS = 26 * 60 * 60 * 1000

/** Largest number the menu badge prints; anything above reads "99+". */
export const MAX_BADGE_COUNT = 99
