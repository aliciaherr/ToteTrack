import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getDay, parseISO } from 'date-fns'
import { forwardRef } from 'react'

const mockUseReducedMotion = vi.hoisted(() => vi.fn().mockReturnValue(false))
const mockSetProductionPlacement = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())

// The dialog added by Task 58 pulls `motion` + `AnimatePresence` into this
// tree, so the mock has to cover them too. Same shape as NavDrawer.test.tsx.
vi.mock('framer-motion', () => ({
  useReducedMotion: mockUseReducedMotion,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: forwardRef<HTMLDivElement, any>(
      ({ children, initial, animate, exit, variants, transition, ...rest }, ref) => (
        <div ref={ref} {...rest}>
          {children}
        </div>
      ),
    ),
  },
}))

// `lib/actions/calendar` carries `'use server'` and imports `@/db`. Next.js
// replaces it with an RPC stub in the client bundle, but vitest has no such
// transform and would load the postgres driver — mocked here, as every other
// action-consuming component test does.
vi.mock('@/lib/actions/calendar', () => ({
  setProductionPlacement: mockSetProductionPlacement,
  clearProductionPlacement: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

import CalendarLayout from '../CalendarLayout'
import { buildWeekGroups, formatWeekRange, groupRowsByDay } from '../calendarWeeks'
import { InvalidDateError } from '@/lib/errors'
import { CALENDAR_WEEKS_BUFFER } from '@/db/queries/calendar.constants'
import type { CalendarOrderRow } from '@/db/queries/calendar'

// 2026-07-27 is a Monday; 2026-07-26 the Sunday before it.
const ANCHOR_MONDAY = '2026-07-27'
const ANCHOR_FRIDAY = '2026-07-31'
const SATURDAY = 6
const SUNDAY = 0

const BUSINESS_DAYS_PER_WEEK = 5
const EXPECTED_WEEK_COUNT = CALENDAR_WEEKS_BUFFER * 2 + 1

let scrollToSpy: ReturnType<typeof vi.fn>
let querySelectorSpy: ReturnType<typeof vi.spyOn>

function makeRow(overrides: Partial<CalendarOrderRow> = {}): CalendarOrderRow {
  return {
    id: 'row-1',
    po_number: 'PO-1000',
    customer_id: '22222222-2222-2222-2222-222222222222',
    customer_name: 'Acme Industrial',
    status: 'scheduled',
    qty_275_recon: 12,
    qty_275_rebot: 0,
    qty_275_new: 0,
    qty_330_recon: 0,
    qty_330_rebot: 0,
    qty_330_new: 0,
    price: '4200.00',
    unit_price_275_recon: '350.00',
    unit_price_275_rebot: null,
    unit_price_275_new: null,
    unit_price_330_recon: null,
    unit_price_330_rebot: null,
    unit_price_330_new: null,
    backhaul: false,
    notes: null,
    same_day_delivery: false,
    production_date: ANCHOR_MONDAY,
    requested_delivery_date: '2026-07-31',
    production_sort_index: null,
    ...overrides,
  }
}

function renderLayout(props: Partial<Parameters<typeof CalendarLayout>[0]> = {}) {
  return render(
    <CalendarLayout rows={[]} unscheduled={[]} weekStart={ANCHOR_MONDAY} {...props} />,
  )
}

/** Selectors passed to the scroll container's `querySelector`, in call order. */
function scrolledWeekSelectors(): string[] {
  const calls = querySelectorSpy.mock.calls as unknown as unknown[][]
  return calls
    .map((call) => String(call[0]))
    .filter((selector) => selector.startsWith('[data-week='))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseReducedMotion.mockReturnValue(false)
  // jsdom implements neither; both are called by `scrollWeekIntoView`.
  scrollToSpy = vi.fn()
  Element.prototype.scrollTo = scrollToSpy as unknown as Element['scrollTo']
  querySelectorSpy = vi.spyOn(Element.prototype, 'querySelector')
})

afterEach(() => {
  querySelectorSpy.mockRestore()
  vi.useRealTimers()
})

describe('buildWeekGroups', () => {
  it('builds the anchor week plus CALENDAR_WEEKS_BUFFER either side', () => {
    const weeks = buildWeekGroups(ANCHOR_MONDAY)

    expect(weeks).toHaveLength(EXPECTED_WEEK_COUNT)
    expect(weeks[CALENDAR_WEEKS_BUFFER].key).toBe(ANCHOR_MONDAY)
  })

  it('emits five weekdays per week and never a weekend', () => {
    for (const week of buildWeekGroups(ANCHOR_MONDAY)) {
      expect(week.days).toHaveLength(BUSINESS_DAYS_PER_WEEK)
      for (const day of week.days) {
        expect(getDay(day)).not.toBe(SATURDAY)
        expect(getDay(day)).not.toBe(SUNDAY)
      }
    }
  })

  it('rejects an anchor that is not a Monday', () => {
    // Accepting one would silently emit weekend columns (CONSTRAINT-19).
    expect(() => buildWeekGroups('2026-07-29')).toThrow(InvalidDateError)
  })

  it('rejects an unparseable anchor', () => {
    expect(() => buildWeekGroups('not-a-date')).toThrow(InvalidDateError)
  })
})

describe('formatWeekRange', () => {
  it('omits the repeated month within a single month', () => {
    expect(formatWeekRange(parseISO(ANCHOR_MONDAY), parseISO(ANCHOR_FRIDAY))).toBe('Jul 27 – 31')
  })

  it('repeats the month when the week straddles a boundary', () => {
    expect(formatWeekRange(parseISO('2026-06-29'), parseISO('2026-07-03'))).toBe('Jun 29 – Jul 3')
  })
})

describe('groupRowsByDay', () => {
  it('buckets rows by production_date', () => {
    const grouped = groupRowsByDay([
      makeRow({ id: 'a', production_date: ANCHOR_MONDAY }),
      makeRow({ id: 'b', production_date: ANCHOR_FRIDAY }),
    ])

    expect(grouped.get(ANCHOR_MONDAY)).toHaveLength(1)
    expect(grouped.get(ANCHOR_FRIDAY)).toHaveLength(1)
  })

  it('drops unscheduled rows rather than inventing a column for them', () => {
    const grouped = groupRowsByDay([makeRow({ production_date: null })])

    expect(grouped.size).toBe(0)
  })

  it('sorts by production_sort_index, placing unplaced rows last', () => {
    const grouped = groupRowsByDay([
      makeRow({ id: 'c', po_number: 'PO-3', production_sort_index: null }),
      makeRow({ id: 'a', po_number: 'PO-1', production_sort_index: 2 }),
      makeRow({ id: 'b', po_number: 'PO-2', production_sort_index: 0 }),
    ])

    expect(grouped.get(ANCHOR_MONDAY)?.map((row) => row.id)).toEqual(['b', 'a', 'c'])
  })

  it('falls back to PO number when sort indexes tie', () => {
    const grouped = groupRowsByDay([
      makeRow({ id: 'z', po_number: 'PO-9', production_sort_index: 1 }),
      makeRow({ id: 'a', po_number: 'PO-1', production_sort_index: 1 }),
    ])

    expect(grouped.get(ANCHOR_MONDAY)?.map((row) => row.id)).toEqual(['a', 'z'])
  })
})

describe('CalendarLayout', () => {
  it('renders five weekday columns per week — Mon–Fri only, no Sat/Sun', () => {
    renderLayout()

    const weekGroups = screen.getAllByTestId('week-group')
    expect(weekGroups).toHaveLength(EXPECTED_WEEK_COUNT)

    for (const group of weekGroups) {
      const columns = within(group).getAllByTestId('day-column')
      expect(columns).toHaveLength(BUSINESS_DAYS_PER_WEEK)

      for (const column of columns) {
        const day = getDay(parseISO(column.getAttribute('data-date') ?? ''))
        expect(day).not.toBe(SATURDAY)
        expect(day).not.toBe(SUNDAY)
      }
    }
  })

  it('opens scrolled to the anchor week', () => {
    renderLayout()

    expect(scrolledWeekSelectors()).toContain(`[data-week="${ANCHOR_MONDAY}"]`)
    expect(scrollToSpy).toHaveBeenCalled()
  })

  it('opens without animating, whatever the motion preference', () => {
    renderLayout()

    expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }))
  })

  it('Current week returns to the week containing today', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 29, 12, 0, 0)) // Wednesday 2026-07-29
    renderLayout({ weekStart: '2026-08-24' })

    fireEvent.click(screen.getByRole('button', { name: /current week/i }))

    expect(scrolledWeekSelectors()).toContain(`[data-week="${ANCHOR_MONDAY}"]`)
  })

  it('a weekend visit targets the following Monday, not the week that just ended', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 26, 12, 0, 0)) // Sunday 2026-07-26
    renderLayout({ weekStart: '2026-08-24' })

    fireEvent.click(screen.getByRole('button', { name: /current week/i }))

    expect(scrolledWeekSelectors()).toContain(`[data-week="${ANCHOR_MONDAY}"]`)
    expect(scrolledWeekSelectors()).not.toContain('[data-week="2026-07-20"]')
  })

  it('smooth-scrolls on Current week by default', () => {
    renderLayout()
    scrollToSpy.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /current week/i }))

    expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
  })

  it('jumps instead of smooth-scrolling when reduced motion is requested', () => {
    mockUseReducedMotion.mockReturnValue(true)
    renderLayout()
    scrollToSpy.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /current week/i }))

    expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }))
  })

  it('renders the empty state for a day with no cards', () => {
    renderLayout()

    expect(screen.getAllByText('Nothing scheduled.').length).toBeGreaterThan(0)
  })

  it('renders a card in the column its production_date names', () => {
    renderLayout({ rows: [makeRow({ production_date: ANCHOR_FRIDAY })] })

    const fridayColumn = document.querySelector(`[data-date="${ANCHOR_FRIDAY}"]`) as HTMLElement
    expect(within(fridayColumn).getByText('PO-1000')).toBeInTheDocument()
    expect(within(fridayColumn).queryByText('Nothing scheduled.')).not.toBeInTheDocument()
  })

  it('gives every day column an + Add order action', () => {
    renderLayout()

    const columns = screen.getAllByTestId('day-column')
    for (const column of columns) {
      expect(within(column).getByText('+ Add order')).toBeInTheDocument()
    }
  })

  it('fills only today’s column header with the primary colour', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 29, 12, 0, 0)) // Wednesday 2026-07-29
    renderLayout()

    const filled = document.querySelectorAll('header.bg-primary')
    expect(filled).toHaveLength(1)
    const todayColumn = document.querySelector('[data-date="2026-07-29"]')
    expect(todayColumn?.querySelector('header')?.className).toContain('bg-primary')
  })

  it('surfaces unscheduled orders through the callout', () => {
    renderLayout({ unscheduled: [makeRow({ production_date: null })] })

    expect(screen.getByRole('button', { name: /need a production date/i })).toHaveTextContent('1')
  })

  it('shows the all-clear instead of a bare zero when nothing is unscheduled', () => {
    renderLayout({ unscheduled: [] })

    expect(screen.getByTestId('unscheduled-empty')).toBeInTheDocument()
  })
})
