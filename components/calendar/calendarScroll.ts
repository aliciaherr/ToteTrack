'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'
import { DB_DATE_FORMAT, startOfBusinessWeek } from '@/lib/dates'

// Scroll behaviour for `CalendarLayout`, split out to keep that file within the
// 200-line component cap (CQ-02).

/**
 * The calendar route with no `?week=` anchor — which `parseCalendarWeek` reads
 * as "today", so pushing it re-anchors the whole strip on the current week.
 */
const CALENDAR_PATH = '/calendar'

/**
 * Scrolls a week group to the left edge of the strip.
 *
 * Reduced motion gets an instant jump rather than a shortened animation: the
 * strip spans nine weeks, so a smooth scroll across it is a long horizontal
 * sweep — exactly the kind of movement `prefers-reduced-motion` exists to
 * suppress.
 *
 * @returns True when the week was found and scrolled to, false when that week
 * is not in the strip at all. The caller **must** handle false: a missing week
 * is not a no-op worth swallowing, it means the viewer asked to go somewhere
 * the loaded window does not reach.
 */
export function scrollWeekIntoView(
  container: HTMLElement,
  weekKey: string,
  shouldReduceMotion: boolean,
): boolean {
  const target = container.querySelector<HTMLElement>(`[data-week="${weekKey}"]`)
  if (!target) return false

  container.scrollTo({
    left: target.offsetLeft - container.offsetLeft,
    behavior: shouldReduceMotion ? 'auto' : 'smooth',
  })
  return true
}

/**
 * Owns the strip's scroll position and the viewer's local "today".
 *
 * `today` is resolved after mount, never during render. The server runs in UTC
 * while the salesperson does not, so a server-rendered "today" would fill the
 * wrong column for any evening in a negative-offset timezone — and correcting
 * it on the client would be a hydration mismatch. One frame without a filled
 * header is the cheaper trade.
 */
export function useWeekScroll(weekStart: string, shouldReduceMotion: boolean) {
  const stripRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const [todayKey, setTodayKey] = useState<string | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate, see the hook doc above: the viewer's local "today" cannot be resolved during render without a hydration mismatch, so post-mount is the only correct time to set it.
    setTodayKey(format(new Date(), DB_DATE_FORMAT))
  }, [])

  // Open on the anchor week without animating — the calendar should already be
  // in the right place when it appears, not slide there.
  useEffect(() => {
    if (stripRef.current === null) return
    scrollWeekIntoView(stripRef.current, weekStart, true)
  }, [weekStart])

  const goToCurrentWeek = useCallback(() => {
    if (stripRef.current === null) return
    // Recomputed on click, not memoised: the tab can sit open past midnight,
    // and `Current week` must mean the current week at the moment it is pressed.
    // On a Saturday this resolves to that Saturday's own week; only a Sunday
    // resolves to the *following* Mon–Sat.
    const currentWeek = format(startOfBusinessWeek(new Date()), DB_DATE_FORMAT)
    if (scrollWeekIntoView(stripRef.current, currentWeek, shouldReduceMotion)) return

    // Today's week is not in the strip, so there is nothing to scroll to. That
    // happens whenever the page is anchored more than `CALENDAR_WEEKS_BUFFER`
    // weeks from today — which search does on every jump to a distant order.
    // Re-anchoring is the only way home: the strip renders exactly the nine
    // weeks the server fetched, and no amount of scrolling reaches past them.
    //
    // Before Task 93 this fell through to a bare `return` and the button did
    // nothing at all, with no error and no message. Nothing in the UI could
    // set `?week=` back then, so the state was unreachable; search reaches it,
    // and a silent dead button is exactly the failure mode the project forbids.
    router.push(CALENDAR_PATH)
  }, [router, shouldReduceMotion])

  return { stripRef, todayKey, goToCurrentWeek }
}
