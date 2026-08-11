import { UNSCHEDULED_DROPDOWN_VISIBLE } from '@/db/queries/calendar.constants'

// Sizing for the two unscheduled callout dropdowns (orders and pickups). Both
// panels are the same panel with different cards in it, so the numbers live
// here rather than once per callout: they are `--card-h`-derived metrics, the
// kind that get tuned once on a device and then silently drift apart.
//
// No `'use client'`: three constants, no hook, no handler — valid in both
// graphs, pulled into the client bundle by whichever callout imports it.

/** Gap between dropdown cards, in rem, matching the day columns' `space-y-2`. */
export const CARD_GAP_REM = 0.5

/** Vertical padding of the dropdown list, in rem (`p-2` top + bottom). */
export const LIST_PADDING_REM = 1

/**
 * Height of exactly `UNSCHEDULED_DROPDOWN_VISIBLE` cards plus their gaps and
 * the list's own padding. Expressed against `--card-h` so the dropdown scales
 * with the cards rather than drifting from them at small viewports.
 */
export const DROPDOWN_MAX_HEIGHT = `calc(var(--card-h) * ${UNSCHEDULED_DROPDOWN_VISIBLE} + ${
  CARD_GAP_REM * (UNSCHEDULED_DROPDOWN_VISIBLE - 1) + LIST_PADDING_REM
}rem)`
