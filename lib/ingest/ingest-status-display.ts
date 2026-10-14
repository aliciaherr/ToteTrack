import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import type { IngestStatus } from '@/lib/actions/ingest'
import { INGEST_STALE_AFTER_MS, MAX_BADGE_COUNT } from './ingest-status.constants'

/**
 * Pure display rules for the review-queue status in the menu (Task 105).
 * No React and no DB, so each rule is tested on its own.
 */

/**
 * Whether the last check is too old to trust. Never checked counts as stale:
 * silence must be distinguishable from failure (PRD, Feature 16).
 *
 * @param lastRunAt ISO timestamp of the last finished run, or `null`.
 * @param now The current time.
 * @returns `true` when `lastRunAt` is null, unparseable, or older than
 *   `INGEST_STALE_AFTER_MS`.
 */
export function isCheckStale(lastRunAt: string | null, now: Date): boolean {
  if (!lastRunAt) return true
  const checkedAt = parseISO(lastRunAt).getTime()
  if (Number.isNaN(checkedAt)) return true
  return now.getTime() - checkedAt > INGEST_STALE_AFTER_MS
}

/**
 * "Last checked" in the viewer's own time zone: `Today 6:12 AM`,
 * `Yesterday 6:12 AM`, else `Oct 10, 6:12 AM`.
 *
 * @param lastRunAt ISO timestamp of the last finished run, or `null`.
 * @param now The current time, which decides "Today" and "Yesterday".
 * @returns The label; `Never checked` for `null`, and the raw value for an
 *   unparseable one, so bad data shows instead of hiding.
 */
export function formatLastChecked(lastRunAt: string | null, now: Date): string {
  if (!lastRunAt) return 'Never checked'
  const checkedAt = parseISO(lastRunAt)
  if (Number.isNaN(checkedAt.getTime())) return lastRunAt
  const time = format(checkedAt, 'h:mm a')
  const daysAgo = differenceInCalendarDays(now, checkedAt)
  if (daysAgo === 0) return `Today ${time}`
  if (daysAgo === 1) return `Yesterday ${time}`
  return `${format(checkedAt, 'MMM d')}, ${time}`
}

/**
 * Undecided POs: the one count the menu badge, the drawer panel and the
 * "Mail checked" toast all show.
 *
 * @param status The last status read, or `null` when there is none to trust.
 * @returns `toReview + beingRead`, or `0` for `null`.
 */
export function pendingTotal(status: Pick<IngestStatus, 'toReview' | 'beingRead'> | null): number {
  return status ? status.toReview + status.beingRead : 0
}

/**
 * The number the menu badge prints.
 *
 * @param count Undecided POs; callers hide the badge at `0`.
 * @returns The count, or `99+` above `MAX_BADGE_COUNT`.
 */
export function badgeLabel(count: number): string {
  return count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(count)
}
