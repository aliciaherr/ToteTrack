import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { format, getDay, parseISO } from 'date-fns'
import { forwardRef } from 'react'

const mockUseReducedMotion = vi.hoisted(() => vi.fn().mockReturnValue(false))
const mockSetProductionPlacement = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())
const mockPush = vi.hoisted(() => vi.fn())
const mockSearchCalendarOrders = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())
const mockUpdatePickup = vi.hoisted(() => vi.fn())
const mockUpdatePickupStatus = vi.hoisted(() => vi.fn())
const mockCreatePickup = vi.hoisted(() => vi.fn())
const mockSetPickupPlacement = vi.hoisted(() => vi.fn())
const mockClearPickupPlacement = vi.hoisted(() => vi.fn())

// The motion-only props are named so they are stripped from `rest` and never
// reach a real DOM node. A `type` is erased, so the hoisted factory can use it.
type MotionMockProps = Record<string, unknown> & { children?: React.ReactNode }

// The dialog added by Task 58 pulls `motion` + `AnimatePresence` into this
// tree, so the mock has to cover them too. Same shape as NavDrawer.test.tsx.
vi.mock('framer-motion', () => ({
  useReducedMotion: mockUseReducedMotion,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    div: forwardRef<HTMLDivElement, MotionMockProps>(function MotionDiv(
      { children, initial, animate, exit, variants, transition, ...rest }: MotionMockProps,
      ref,
    ) {
      return <div ref={ref} {...rest}>{children}</div>
    }),
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

// Search's read action, stubbed for the same reason as the placement writes: it
// is a `'use server'` module and imports the postgres driver.
vi.mock('@/lib/actions/calendar.search', () => ({
  searchCalendarOrders: mockSearchCalendarOrders,
}))

// The card popup's status block (Task 66) reaches both order-status actions,
// and they import the postgres driver for the same reason as above.
vi.mock('@/lib/actions/orders', () => ({
  updateOrderStatus: vi.fn(),
}))

vi.mock('@/lib/actions/orders.revert', () => ({
  revertOrderToScheduled: vi.fn(),
}))

// The pickup popup's status block and the new-pickup form both reach
// `lib/actions/pickups`, another `'use server'` module that imports the
// postgres driver.
vi.mock('@/lib/actions/pickups', () => ({
  createPickup: mockCreatePickup,
  updatePickup: mockUpdatePickup,
  updatePickupStatus: mockUpdatePickupStatus,
}))

// Task 81's pickup placement module. `Remove from calendar`, the pickup half of
// every drag and the day menu's pickup picks all land here.
vi.mock('@/lib/actions/pickups.calendar', () => ({
  setPickupPlacement: mockSetPickupPlacement,
  clearPickupPlacement: mockClearPickupPlacement,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

// `OrderForm` reaches `@/lib/actions/orders`, a `'use server'` module that
// imports the postgres driver. Stubbed the same way `OrderLayout.test.tsx` does
// it, exposing the props Task 64 has to get right — the mode, the build-day
// override, and the unlocked customer field — plus a save trigger. The drawer,
// the context and the menu around it are all real.
vi.mock('@/components/orders/OrderForm', () => ({
  default: ({
    mode,
    productionDate,
    lockedCustomerId,
    onSaved,
  }: {
    mode: 'create' | 'edit'
    productionDate?: string | null
    lockedCustomerId: string | null
    onSaved: () => void
  }) => (
    <div
      data-testid="order-form"
      data-mode={mode}
      data-production-date={productionDate ?? ''}
      data-locked-customer-id={lockedCustomerId ?? ''}
    >
      <button type="button" onClick={onSaved}>
        save-order
      </button>
    </div>
  ),
}))

// `PickupForm` is stubbed for the same two reasons `OrderForm` is: it reaches
// the `'use server'` pickups module, and it renders a `motion.form` the
// framer-motion mock above does not provide. The props it exposes are the ones
// Task 81 has to get right — create mode, and the day the clicked column
// pre-fills into the visible date field.
vi.mock('@/components/pickups/PickupForm', () => ({
  default: ({
    mode,
    initialPickupDate,
    lockedCustomerId,
    onSaved,
  }: {
    mode: 'create' | 'edit'
    initialPickupDate?: string | null
    lockedCustomerId: string | null
    onSaved: () => void
  }) => (
    <div
      data-testid="pickup-form"
      data-mode={mode}
      data-pickup-date={initialPickupDate ?? ''}
      data-locked-customer-id={lockedCustomerId ?? ''}
    >
      <button type="button" onClick={onSaved}>
        save-pickup
      </button>
    </div>
  ),
}))

import CalendarLayout from '../CalendarLayout'
import {
  buildWeekGroups,
  formatWeekRange,
  groupPickupsByDay,
  groupRowsByDay,
} from '../calendarWeeks'
import { InvalidDateError } from '@/lib/errors'
import { CALENDAR_WEEKS_BUFFER } from '@/db/queries/calendar.constants'
import { CALENDAR_VIEW_ORDER, type CalendarView } from '../pickupVisibility'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

// 2026-07-27 is a Monday; 2026-07-26 the Sunday before it. The anchor week
// straddles a month boundary, so its Saturday is 2026-08-01.
const ANCHOR_MONDAY = '2026-07-27'
const ANCHOR_FRIDAY = '2026-07-31'
const ANCHOR_SATURDAY = '2026-08-01'
/** `date-fns` day-of-week index for Sunday — the only day with no column. */
const SUNDAY = 0

/** Mon–Sat. Must track `BUSINESS_DAYS_PER_WEEK` in `lib/dates.ts` (Task 88). */
const BUSINESS_DAYS_PER_WEEK = 6
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
    contacts: [],
    ...overrides,
  }
}

function makePickup(overrides: Partial<CalendarPickupRow> = {}): CalendarPickupRow {
  return {
    id: 'pickup-1',
    customer_id: '33333333-3333-3333-3333-333333333333',
    customer_name: 'Northside Bottling',
    status: 'scheduled',
    qty_275: 12,
    qty_330: 4,
    pickup_date: ANCHOR_MONDAY,
    sort_index: null,
    address: null,
    notes: null,
    contacts: [],
    ...overrides,
  }
}

function renderLayout(props: Partial<Parameters<typeof CalendarLayout>[0]> = {}) {
  return render(
    <CalendarLayout
      rows={[]}
      unscheduled={[]}
      pickups={[]}
      unscheduledPickups={[]}
      weekStart={ANCHOR_MONDAY}
      findPo={null}
      customers={[]}
      {...props}
    />,
  )
}

/**
 * Presses the header's view cycle until it lands on `view`.
 *
 * Driven by the control's own `data-view` rather than a fixed press count, so
 * the tests state the view they need and stay correct if the cycle order in
 * `CALENDAR_VIEW_ORDER` is ever reordered.
 */
function cycleToView(view: CalendarView) {
  const control = screen.getByTestId('calendar-view-cycle')
  for (let press = 0; press < CALENDAR_VIEW_ORDER.length; press += 1) {
    if (control.getAttribute('data-view') === view) return
    fireEvent.click(control)
  }
  throw new Error(`The view cycle never reached "${view}".`)
}

/** Opens one day column's `+ Add order` menu and returns it. */
function openDayMenu(dateKey: string): HTMLElement {
  const column = document.querySelector(`[data-date="${dateKey}"]`) as HTMLElement
  fireEvent.click(within(column).getByText('+ Add'))
  return within(column).getByTestId('add-order-menu')
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
  // Every placement mock resolves by default. `useCalendarMutation` reads
  // `'error' in result`, so a mock left returning undefined throws a TypeError
  // out of a fire-and-forget handler rather than failing the assertion.
  mockSetProductionPlacement.mockResolvedValue({ success: true })
  mockSetPickupPlacement.mockResolvedValue({ success: true })
  mockClearPickupPlacement.mockResolvedValue({ success: true })
  mockSearchCalendarOrders.mockResolvedValue({ hits: [] })
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

  it('emits six days per week, Mon–Sat, and never a Sunday', () => {
    for (const week of buildWeekGroups(ANCHOR_MONDAY)) {
      expect(week.days).toHaveLength(BUSINESS_DAYS_PER_WEEK)
      for (const day of week.days) {
        expect(getDay(day)).not.toBe(SUNDAY)
      }
    }
  })

  it('closes the anchor week on its Saturday', () => {
    const anchorWeek = buildWeekGroups(ANCHOR_MONDAY)[CALENDAR_WEEKS_BUFFER]
    const lastDay = anchorWeek.days[anchorWeek.days.length - 1]

    expect(format(lastDay, 'yyyy-MM-dd')).toBe(ANCHOR_SATURDAY)
  })

  it('rejects an anchor that is not a Monday', () => {
    // Accepting one would silently emit a Sunday column (CONSTRAINT-19).
    expect(() => buildWeekGroups('2026-07-29')).toThrow(InvalidDateError)
  })

  it('rejects an unparseable anchor', () => {
    expect(() => buildWeekGroups('not-a-date')).toThrow(InvalidDateError)
  })
})

describe('formatWeekRange', () => {
  it('omits the repeated month within a single month', () => {
    // Mon 2026-07-06 – Sat 2026-07-11 sits entirely inside July.
    expect(formatWeekRange(parseISO('2026-07-06'), parseISO('2026-07-11'))).toBe('Jul 6 – 11')
  })

  it('repeats the month when the week straddles a boundary', () => {
    // The anchor week now straddles: its Saturday fell into August once the
    // week grew a sixth column (Task 88).
    expect(formatWeekRange(parseISO(ANCHOR_MONDAY), parseISO(ANCHOR_SATURDAY))).toBe(
      'Jul 27 – Aug 1',
    )
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

describe('groupPickupsByDay', () => {
  it('buckets pickups by pickup_date', () => {
    const grouped = groupPickupsByDay([
      makePickup({ id: 'a', pickup_date: ANCHOR_MONDAY }),
      makePickup({ id: 'b', pickup_date: ANCHOR_FRIDAY }),
    ])

    expect(grouped.get(ANCHOR_MONDAY)).toHaveLength(1)
    expect(grouped.get(ANCHOR_FRIDAY)).toHaveLength(1)
  })

  it('drops undated pickups rather than inventing a column for them', () => {
    expect(groupPickupsByDay([makePickup({ pickup_date: null })]).size).toBe(0)
  })

  it('preserves the order the query returned instead of re-sorting', () => {
    // The ORDER BY in `getCalendarPickups` is the single source of column
    // order — a client-side comparator could only disagree with it.
    const grouped = groupPickupsByDay([
      makePickup({ id: 'c', sort_index: null }),
      makePickup({ id: 'a', sort_index: 0 }),
      makePickup({ id: 'b', sort_index: 1 }),
    ])

    expect(grouped.get(ANCHOR_MONDAY)?.map((pickup) => pickup.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('CalendarLayout', () => {
  it('renders six columns per week — Mon–Sat, no Sunday', () => {
    renderLayout()

    const weekGroups = screen.getAllByTestId('week-group')
    expect(weekGroups).toHaveLength(EXPECTED_WEEK_COUNT)

    for (const group of weekGroups) {
      const columns = within(group).getAllByTestId('day-column')
      expect(columns).toHaveLength(BUSINESS_DAYS_PER_WEEK)

      for (const column of columns) {
        const day = getDay(parseISO(column.getAttribute('data-date') ?? ''))
        expect(day).not.toBe(SUNDAY)
      }
    }
  })

  it('renders a Saturday column that accepts a card', () => {
    // The regression this guards: before Task 88 a Saturday-dated row was
    // fetched but had no column to land in, so it vanished from the calendar.
    renderLayout({ rows: [makeRow({ production_date: ANCHOR_SATURDAY })] })

    const saturdayColumn = document.querySelector(
      `[data-date="${ANCHOR_SATURDAY}"]`,
    ) as HTMLElement
    expect(saturdayColumn).not.toBeNull()
    expect(within(saturdayColumn).getByText('PO-1000')).toBeInTheDocument()
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
    // The clock is frozen inside the anchor week on purpose. Without it the
    // test reads the real date, and once that drifts more than
    // CALENDAR_WEEKS_BUFFER weeks from ANCHOR_MONDAY today's column is not in
    // the strip at all — so the button re-anchors the route instead of
    // scrolling and there is no `behavior` to assert on.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 29, 12, 0, 0)) // Wednesday 2026-07-29
    renderLayout()
    scrollToSpy.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /current week/i }))

    expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }))
  })

  it('jumps instead of smooth-scrolling when reduced motion is requested', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 29, 12, 0, 0)) // Wednesday 2026-07-29
    mockUseReducedMotion.mockReturnValue(true)
    renderLayout()
    scrollToSpy.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /current week/i }))

    expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }))
  })

  it('re-anchors the route when today is outside the rendered strip', () => {
    // What search reaches on every jump to a distant order: the strip is drawn
    // around a far-off anchor, so today's column was never loaded and there is
    // nothing to scroll to. Before Task 93 the button silently did nothing.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 6, 29, 12, 0, 0)) // Wednesday 2026-07-29
    renderLayout({ weekStart: '2027-03-01' })
    scrollToSpy.mockClear()

    fireEvent.click(screen.getByRole('button', { name: /current week/i }))

    expect(mockPush).toHaveBeenCalledWith('/calendar')
    expect(scrollToSpy).not.toHaveBeenCalled()
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

  it('gives every day column an + Add action', () => {
    // The label lost the word "order" in Task 81: the menu now creates a PO
    // *or* a pickup, so naming one of them would misdescribe half of it.
    renderLayout()

    const columns = screen.getAllByTestId('day-column')
    for (const column of columns) {
      expect(within(column).getByText('+ Add')).toBeInTheDocument()
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

  it('re-reads the open popup from fresh server rows rather than a pinned copy', () => {
    // A pill toggle revalidates and refreshes; the popup has to show what came
    // back, not the row object it was opened with (CONSTRAINT-02).
    const { rerender } = renderLayout({ rows: [makeRow({ backhaul: false })] })
    fireEvent.click(screen.getByText('PO-1000'))

    expect(screen.getByRole('switch', { name: /backhaul/i })).toHaveAttribute(
      'aria-checked',
      'false',
    )

    rerender(
      <CalendarLayout
        rows={[makeRow({ backhaul: true })]}
        unscheduled={[]}
        pickups={[]}
        unscheduledPickups={[]}
        weekStart={ANCHOR_MONDAY}
      findPo={null}
        customers={[]}
      />,
    )

    expect(screen.getByRole('switch', { name: /backhaul/i })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('closes the popup when its card leaves the calendar', () => {
    const { rerender } = renderLayout({ rows: [makeRow()] })
    fireEvent.click(screen.getByText('PO-1000'))
    expect(screen.getByTestId('production-card-dialog')).toBeInTheDocument()

    // What a cancel looks like from the client: the row is gone from the next
    // server payload, so there is nothing left for the popup to show.
    rerender(
      <CalendarLayout
        rows={[]}
        unscheduled={[]}
        pickups={[]}
        unscheduledPickups={[]}
        weekStart={ANCHOR_MONDAY}
      findPo={null}
        customers={[]}
      />,
    )

    expect(screen.queryByTestId('production-card-dialog')).not.toBeInTheDocument()
  })
})

describe('CalendarLayout — the view cycle', () => {
  it('opens on the orders view, every visit', () => {
    renderLayout({ rows: [makeRow()], pickups: [makePickup()] })

    expect(screen.getByTestId('calendar-view-cycle')).toHaveAttribute('data-view', 'orders')
    expect(screen.getByText('PO-1000')).toBeInTheDocument()
    expect(screen.queryByTestId('pickup-card')).not.toBeInTheDocument()
  })

  it('cycles Orders → Pickups → Both and wraps back to Orders', () => {
    renderLayout({ rows: [makeRow()], pickups: [makePickup()] })
    const control = screen.getByTestId('calendar-view-cycle')

    fireEvent.click(control)
    expect(control).toHaveAttribute('data-view', 'pickups')
    expect(screen.queryByText('PO-1000')).not.toBeInTheDocument()

    fireEvent.click(control)
    expect(control).toHaveAttribute('data-view', 'both')
    expect(screen.getByText('PO-1000')).toBeInTheDocument()
    expect(screen.getByTestId('pickup-card')).toBeInTheDocument()

    fireEvent.click(control)
    expect(control).toHaveAttribute('data-view', 'orders')
  })

  it('names both the current view and the next one, for screen readers', () => {
    renderLayout()

    expect(screen.getByTestId('calendar-view-cycle')).toHaveAccessibleName(
      'Showing Orders. Switch to Pickups.',
    )
  })

  it('never reaches a view that hides both lists', () => {
    // The old pair of toggles could turn everything off, and every column drew
    // a "both lists are hidden" message for it. Three views replace four
    // combinations, so that state is now unreachable (CONSTRAINT-25, Task 93).
    renderLayout({ rows: [makeRow()], pickups: [makePickup()] })
    const control = screen.getByTestId('calendar-view-cycle')

    for (let press = 0; press <= CALENDAR_VIEW_ORDER.length; press += 1) {
      const hasCards =
        screen.queryByText('PO-1000') !== null || screen.queryByTestId('pickup-card') !== null
      expect(hasCards).toBe(true)
      fireEvent.click(control)
    }
  })

  it('shows pickup cards in the right column on the pickups view', () => {
    renderLayout({ pickups: [makePickup({ pickup_date: ANCHOR_FRIDAY })] })

    cycleToView('pickups')

    const fridayColumn = document.querySelector(`[data-date="${ANCHOR_FRIDAY}"]`) as HTMLElement
    expect(within(fridayColumn).getByTestId('pickup-card')).toBeInTheDocument()
    expect(within(fridayColumn).getByText('12 × 275, 4 × 330')).toBeInTheDocument()

    const mondayColumn = document.querySelector(`[data-date="${ANCHOR_MONDAY}"]`) as HTMLElement
    expect(within(mondayColumn).queryByTestId('pickup-card')).not.toBeInTheDocument()
    expect(within(mondayColumn).getByTestId('column-pickups-empty')).toBeInTheDocument()
  })

  it('keeps the two lists independent — orders stay put when pickups appear', () => {
    renderLayout({ rows: [makeRow()], pickups: [makePickup()] })

    cycleToView('both')

    const mondayColumn = document.querySelector(`[data-date="${ANCHOR_MONDAY}"]`) as HTMLElement
    expect(within(mondayColumn).getByText('PO-1000')).toBeInTheDocument()
    expect(within(mondayColumn).getByTestId('pickup-card')).toBeInTheDocument()
  })

  it('keeps the unscheduled-orders callout up in every view', () => {
    // "No active order may be invisible" is an invariant of the orders half,
    // and a view toggle is a statement about which cards to draw — not a
    // request to stop being told there is unscheduled work (Task 93).
    renderLayout({ unscheduled: [makeRow({ production_date: null })] })
    const control = screen.getByTestId('calendar-view-cycle')

    // By test id, not by role+name: this asserts inside a loop over a fully
    // rendered nine-week calendar, and recomputing accessibility roles across
    // that tree on each pass is slow enough to time out under a loaded suite.
    for (let press = 0; press <= CALENDAR_VIEW_ORDER.length; press += 1) {
      expect(screen.getByTestId('unscheduled-callout-pill')).toHaveTextContent('1')
      fireEvent.click(control)
    }
  })

  it('surfaces undated pickups only while pickups are on', () => {
    renderLayout({ unscheduledPickups: [makePickup({ pickup_date: null })] })

    expect(screen.queryByRole('button', { name: /pickups need a date/i })).not.toBeInTheDocument()

    cycleToView('pickups')

    expect(screen.getByRole('button', { name: /pickups need a date/i })).toHaveTextContent('1')
  })

  it('opens the pickup popup from a card and closes it again', () => {
    renderLayout({ pickups: [makePickup()] })
    cycleToView('pickups')

    fireEvent.click(screen.getByTestId('pickup-card'))

    const dialog = screen.getByTestId('pickup-card-dialog')
    expect(within(dialog).getByText('Northside Bottling')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('pickup-card-dialog')).not.toBeInTheDocument()
  })

  it('removes a pickup from the calendar through clearPickupPlacement', async () => {
    mockClearPickupPlacement.mockResolvedValueOnce({ success: true })
    renderLayout({ pickups: [makePickup({ address: '9 Dock Rd', notes: 'gate code 4821' })] })
    cycleToView('pickups')
    fireEvent.click(screen.getByTestId('pickup-card'))

    fireEvent.click(screen.getByRole('button', { name: 'Remove from calendar' }))

    await waitFor(() => expect(mockClearPickupPlacement).toHaveBeenCalledWith('pickup-1'))
    // Task 81 supersedes Task 80's shortcut (INFO-05): the id alone goes over
    // the wire and the action nulls `pickup_date` *and* `sort_index`, instead
    // of resending the whole editable row last-write-wins with a stale index.
    expect(mockUpdatePickup).not.toHaveBeenCalled()
  })
})

describe('CalendarLayout — Add Purchase Order from a day column', () => {
  it('lists both create actions above the undated rows, behind a divider', () => {
    renderLayout({ unscheduled: [makeRow({ id: 'u1', production_date: null })] })

    const menu = openDayMenu(ANCHOR_MONDAY)
    const items = within(menu).getAllByRole('menuitem')

    expect(items[0]).toHaveTextContent('Add Purchase Order')
    expect(items[1]).toHaveTextContent('Add Pickup')
    expect(items[2]).toHaveTextContent('PO-1000')
    expect(within(menu).getByRole('separator')).toBeInTheDocument()
  })

  it('lists undated rows of both kinds, each under its own label', () => {
    renderLayout({
      unscheduled: [makeRow({ id: 'u1', production_date: null })],
      unscheduledPickups: [makePickup({ id: 'up1', pickup_date: null })],
    })

    const menu = openDayMenu(ANCHOR_MONDAY)

    const orders = within(menu).getByRole('group', { name: 'Undated orders' })
    const pickups = within(menu).getByRole('group', { name: 'Undated pickups' })
    expect(within(orders).getByRole('menuitem', { name: /PO-1000/ })).toBeInTheDocument()
    expect(
      within(pickups).getByRole('menuitem', { name: /Northside Bottling/ }),
    ).toBeInTheDocument()
  })

  it('places the chosen undated order on the clicked day, at the end of that list', () => {
    renderLayout({
      rows: [makeRow({ id: 'placed', production_date: ANCHOR_FRIDAY })],
      unscheduled: [makeRow({ id: 'u1', po_number: 'PO-2000', production_date: null })],
      pickups: [makePickup({ id: 'p1', pickup_date: ANCHOR_FRIDAY })],
    })

    const menu = openDayMenu(ANCHOR_FRIDAY)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /PO-2000/ }))

    // Index 1 — the count of *orders* already on Friday, never the two lists
    // combined (CONSTRAINT-25); a pickup sits on that day too, and counting it
    // would open a gap in the orders sequence.
    expect(mockSetProductionPlacement).toHaveBeenCalledWith('u1', {
      group: 'order',
      productionDate: ANCHOR_FRIDAY,
      sortIndex: 1,
    })
    expect(mockSetPickupPlacement).not.toHaveBeenCalled()
  })

  it('places the chosen undated pickup on the clicked day, at the end of that list', () => {
    renderLayout({
      pickups: [makePickup({ id: 'placed', pickup_date: ANCHOR_FRIDAY })],
      unscheduledPickups: [makePickup({ id: 'up1', pickup_date: null })],
    })

    const menu = openDayMenu(ANCHOR_FRIDAY)
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Northside Bottling/ }))

    // Index 1 — the count of *pickups* already on Friday, never the two lists
    // combined (CONSTRAINT-25).
    expect(mockSetPickupPlacement).toHaveBeenCalledWith('up1', {
      group: 'pickup',
      pickupDate: ANCHOR_FRIDAY,
      sortIndex: 1,
    })
    expect(mockSetProductionPlacement).not.toHaveBeenCalled()
  })

  it('keeps the empty state for the lists below when nothing is undated', () => {
    renderLayout({ unscheduled: [] })

    const menu = openDayMenu(ANCHOR_MONDAY)

    expect(within(menu).getByText('Nothing to add — everything has a date.')).toBeInTheDocument()
    // Both create actions survive an empty undated set.
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(2)
  })

  it('keeps the drawer shut until a day asks for it', () => {
    renderLayout()

    expect(screen.queryByTestId('order-form')).not.toBeInTheDocument()
  })

  it('opens the create form pinned to the clicked column and dismisses the menu', () => {
    renderLayout()

    openDayMenu(ANCHOR_FRIDAY)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Purchase Order' }))

    const form = screen.getByTestId('order-form')
    expect(form.getAttribute('data-mode')).toBe('create')
    // The clicked day, not the delivery date, is what the new PO stores
    // (CONSTRAINT-19 — position is stored, never derived).
    expect(form.getAttribute('data-production-date')).toBe(ANCHOR_FRIDAY)
    expect(form.getAttribute('data-locked-customer-id')).toBe('')
    expect(screen.queryByTestId('add-order-menu')).not.toBeInTheDocument()
  })

  it('carries the day of whichever column was clicked, not the first one', () => {
    renderLayout()

    openDayMenu(ANCHOR_MONDAY)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Purchase Order' }))

    expect(screen.getByTestId('order-form').getAttribute('data-production-date')).toBe(
      ANCHOR_MONDAY,
    )
  })

  it('closes the drawer and refetches the calendar once the PO is saved', () => {
    renderLayout()
    openDayMenu(ANCHOR_FRIDAY)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Purchase Order' }))

    fireEvent.click(screen.getByText('save-order'))

    expect(screen.queryByTestId('order-form')).not.toBeInTheDocument()
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('closes the drawer on Escape without saving', () => {
    renderLayout()
    openDayMenu(ANCHOR_FRIDAY)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Purchase Order' }))

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByTestId('order-form')).not.toBeInTheDocument()
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('opens the pickup form pinned to the clicked column, from the same menu', () => {
    renderLayout()

    openDayMenu(ANCHOR_FRIDAY)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Pickup' }))

    const form = screen.getByTestId('pickup-form')
    expect(form.getAttribute('data-mode')).toBe('create')
    // Pre-filled into the *visible* date field, unlike the order drawer's
    // hidden build-day override: a pickup's date is its placement, so the
    // salesperson can see and change it before saving (CONSTRAINT-25).
    expect(form.getAttribute('data-pickup-date')).toBe(ANCHOR_FRIDAY)
    expect(screen.queryByTestId('add-order-menu')).not.toBeInTheDocument()
    // The two drawers are independent — opening one must not open the other.
    expect(screen.queryByTestId('order-form')).not.toBeInTheDocument()
  })

  it('closes the pickup drawer and refetches once the pickup is saved', () => {
    renderLayout()
    openDayMenu(ANCHOR_FRIDAY)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Pickup' }))

    fireEvent.click(screen.getByText('save-pickup'))

    expect(screen.queryByTestId('pickup-form')).not.toBeInTheDocument()
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('keeps the drawer a fixed overlay at every width so the page cannot scroll', () => {
    // The calendar root is `overflow-hidden`; DetailDrawer's default lg+ inline
    // docking would clip the form or force a page scroll (CONSTRAINT-19).
    renderLayout()
    openDayMenu(ANCHOR_FRIDAY)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Purchase Order' }))

    const drawer = screen.getByRole('region', { name: 'New purchase order' })
    expect(drawer.className).toContain('fixed')
    expect(drawer.className).not.toContain('lg:relative')
  })
})
