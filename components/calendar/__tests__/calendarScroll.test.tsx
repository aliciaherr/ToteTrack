import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { format } from 'date-fns'
import { DB_DATE_FORMAT, startOfBusinessWeek } from '@/lib/dates'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))

import { useWeekScroll } from '../calendarScroll'

/** The week `Current week` resolves to, whatever day the suite runs on. */
const CURRENT_WEEK = format(startOfBusinessWeek(new Date()), DB_DATE_FORMAT)

/**
 * A stand-in for the week strip holding the given week groups.
 *
 * `scrollTo` is not implemented in jsdom, so it is stubbed rather than spied on
 * a real method — without it the hook throws instead of scrolling.
 */
function buildStrip(weekKeys: string[]): HTMLDivElement {
  const strip = document.createElement('div')
  for (const key of weekKeys) {
    const section = document.createElement('section')
    section.setAttribute('data-week', key)
    strip.appendChild(section)
  }
  strip.scrollTo = vi.fn()
  document.body.appendChild(strip)
  return strip
}

/** Mounts the hook with its ref already pointing at `strip`. */
function mountWithStrip(strip: HTMLDivElement) {
  const rendered = renderHook(() => useWeekScroll(CURRENT_WEEK, false))
  act(() => {
    rendered.result.current.stripRef.current = strip
  })
  return rendered
}

describe('useWeekScroll', () => {
  beforeEach(() => {
    mockPush.mockClear()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('scrolls to the current week when that week is in the strip', () => {
    const strip = buildStrip([CURRENT_WEEK])
    const { result } = mountWithStrip(strip)

    act(() => result.current.goToCurrentWeek())

    expect(strip.scrollTo).toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('re-anchors the route when the current week is not in the strip', () => {
    // The state search reaches on every jump to a distant order: the strip is
    // rendered around some far-off anchor, so today's column was never loaded.
    const strip = buildStrip(['2001-01-01', '2001-01-08'])
    const { result } = mountWithStrip(strip)

    act(() => result.current.goToCurrentWeek())

    expect(mockPush).toHaveBeenCalledWith('/calendar')
    expect(strip.scrollTo).not.toHaveBeenCalled()
  })

  it('does nothing when the strip has not mounted yet', () => {
    const { result } = renderHook(() => useWeekScroll(CURRENT_WEEK, false))

    act(() => result.current.goToCurrentWeek())

    expect(mockPush).not.toHaveBeenCalled()
  })
})
