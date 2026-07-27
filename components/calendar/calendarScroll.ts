'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { DB_DATE_FORMAT, startOfBusinessWeek } from '@/lib/dates'

// Scroll behaviour for `CalendarLayout`, split out to keep that file within the
// 200-line component cap (CQ-02).

/**
 * Scrolls a week group to the left edge of the strip.
 *
 * Reduced motion gets an instant jump rather than a shortened animation: the
 * strip spans nine weeks, so a smooth scroll across it is a long horizontal
 * sweep — exactly the kind of movement `prefers-reduced-motion` exists to
 * suppress.
 */
function scrollWeekIntoView(
  container: HTMLElement,
  weekKey: string,
  shouldReduceMotion: boolean,
): void {
  const target = container.querySelector<HTMLElement>(`[data-week="${weekKey}"]`)
  if (!target) return

  container.scrollTo({
    left: target.offsetLeft - container.offsetLeft,
    behavior: shouldReduceMotion ? 'auto' : 'smooth',
  })
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
  const [todayKey, setTodayKey] = useState<string | null>(null)

  useEffect(() => {
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
    // On a Saturday or Sunday this resolves to the *following* Mon–Fri.
    const currentWeek = format(startOfBusinessWeek(new Date()), DB_DATE_FORMAT)
    scrollWeekIntoView(stripRef.current, currentWeek, shouldReduceMotion)
  }, [shouldReduceMotion])

  return { stripRef, todayKey, goToCurrentWeek }
}
