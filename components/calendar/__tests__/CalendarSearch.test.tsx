import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { forwardRef } from 'react'

const mockRefresh = vi.hoisted(() => vi.fn())
const mockPush = vi.hoisted(() => vi.fn())
const mockSearchCalendarOrders = vi.hoisted(() => vi.fn())
const mockUseReducedMotion = vi.hoisted(() => vi.fn())
const mockSetProductionPlacement = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())
const mockCreatePickup = vi.hoisted(() => vi.fn())
const mockUpdatePickup = vi.hoisted(() => vi.fn())
const mockUpdatePickupStatus = vi.hoisted(() => vi.fn())
const mockSetPickupPlacement = vi.hoisted(() => vi.fn())
const mockClearPickupPlacement = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}))

// Search's own read action. Everything after it is the same set of `'use
// server'` and motion stubs `CalendarLayout.test.tsx` installs, for the same
// reasons — these components reach modules that import the postgres driver.
vi.mock('@/lib/actions/calendar.search', () => ({
  searchCalendarOrders: mockSearchCalendarOrders,
}))

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
import type { CalendarOrderRow } from '@/db/queries/calendar'

const ANCHOR_MONDAY = '2026-07-27'
const ANCHOR_TUESDAY = '2026-07-28'
/** Far outside the nine weeks rendered around ANCHOR_MONDAY. */
const DISTANT_DATE = '2027-03-02'

function makeRow(overrides: Partial<CalendarOrderRow> = {}): CalendarOrderRow {
  return {
    id: 'order-1',
    po_number: 'PO-1000',
    customer_id: 'customer-1',
    customer_name: 'Acme Rebottling',
    status: 'scheduled',
    qty_275_recon: 10,
    qty_275_rebot: 0,
    qty_275_new: 0,
    qty_330_recon: 0,
    qty_330_rebot: 0,
    qty_330_new: 0,
    price: '550.00',
    unit_price_275_recon: '55.00',
    unit_price_275_rebot: null,
    unit_price_275_new: null,
    unit_price_330_recon: null,
    unit_price_330_rebot: null,
    unit_price_330_new: null,
    backhaul: false,
    same_day_delivery: false,
    requested_delivery_date: null,
    production_date: ANCHOR_MONDAY,
    production_sort_index: 0,
    contacts: [],
    ...overrides,
  } as CalendarOrderRow
}

function renderCalendar(props: Partial<Parameters<typeof CalendarLayout>[0]> = {}) {
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

/** Expands the search box and submits `term`. */
function search(term: string) {
  fireEvent.click(screen.getByTestId('calendar-search-open'))
  const input = screen.getByTestId('calendar-search-input')
  fireEvent.change(input, { target: { value: term } })
  fireEvent.keyDown(input, { key: 'Enter' })
}

/** Expands the box and types `term` without submitting. */
function typeInSearch(term: string) {
  if (screen.queryByTestId('calendar-search-input') === null) {
    fireEvent.click(screen.getByTestId('calendar-search-open'))
  }
  fireEvent.change(screen.getByTestId('calendar-search-input'), { target: { value: term } })
}

/** Builds `count` hits, PO-ascending, the way the query returns them. */
function hitsFor(...poNumbers: string[]) {
  return poNumbers.map((po, index) => ({
    id: `hit-${index}`,
    po_number: po,
    customer_name: 'Acme Rebottling',
    production_date: ANCHOR_MONDAY,
  }))
}

/** The rendered card for a PO, wherever it lives. */
function cardFor(poNumber: string): HTMLElement | null {
  return document.querySelector(`[data-po-number="${poNumber}"]`)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseReducedMotion.mockReturnValue(false)
  mockSearchCalendarOrders.mockResolvedValue({ hits: [], hasMore: false })
  Element.prototype.scrollTo = vi.fn() as unknown as Element['scrollTo']
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CalendarSearch — the box itself', () => {
  it('starts collapsed so it costs no header room', () => {
    renderCalendar()

    expect(screen.getByTestId('calendar-search-open')).toBeInTheDocument()
    expect(screen.queryByTestId('calendar-search-input')).not.toBeInTheDocument()
  })

  it('says it searches orders, so nobody expects pickups to match', () => {
    // Pickups carry no PO number at all (CONSTRAINT-25), so the scope is a
    // permanent fact about the box and belongs on its face.
    renderCalendar()

    fireEvent.click(screen.getByTestId('calendar-search-open'))

    expect(screen.getByTestId('calendar-search-input')).toHaveAttribute(
      'placeholder',
      'Search orders',
    )
  })

  it('collapses again on Escape', () => {
    renderCalendar()
    fireEvent.click(screen.getByTestId('calendar-search-open'))

    fireEvent.keyDown(screen.getByTestId('calendar-search-input'), { key: 'Escape' })

    expect(screen.queryByTestId('calendar-search-input')).not.toBeInTheDocument()
  })

  it('ignores an empty submission rather than searching for everything', () => {
    renderCalendar()
    fireEvent.click(screen.getByTestId('calendar-search-open'))

    fireEvent.keyDown(screen.getByTestId('calendar-search-input'), { key: 'Enter' })

    expect(mockSearchCalendarOrders).not.toHaveBeenCalled()
  })
})

describe('CalendarSearch — an exact PO already on screen', () => {
  it('lights the card without a round-trip', async () => {
    // `po_number` is UNIQUE, so an exact match on a loaded row is provably the
    // only one and there is nothing for the server to disambiguate.
    renderCalendar({ rows: [makeRow()] })

    search('PO-1000')

    await waitFor(() => expect(cardFor('PO-1000')).toHaveAttribute('data-found', 'true'))
    expect(mockSearchCalendarOrders).not.toHaveBeenCalled()
  })

  it('matches case-insensitively', async () => {
    renderCalendar({ rows: [makeRow()] })

    search('po-1000')

    await waitFor(() => expect(cardFor('PO-1000')).toHaveAttribute('data-found', 'true'))
    expect(mockSearchCalendarOrders).not.toHaveBeenCalled()
  })

  it('scrolls the card into view', async () => {
    renderCalendar({ rows: [makeRow()] })

    search('PO-1000')

    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled())
  })

  it('stops lighting the card once the highlight window passes', async () => {
    renderCalendar({ rows: [makeRow()] })

    search('PO-1000')
    await waitFor(() => expect(cardFor('PO-1000')).toHaveAttribute('data-found', 'true'))

    await waitFor(() => expect(cardFor('PO-1000')).not.toHaveAttribute('data-found'), {
      timeout: 3000,
    })
  })
})

describe('CalendarSearch — a partial term', () => {
  it('asks the server, because the client only holds nine weeks', async () => {
    renderCalendar({ rows: [makeRow()] })

    search('1000')

    await waitFor(() => expect(mockSearchCalendarOrders).toHaveBeenCalledWith('1000'))
  })

  it('jumps straight there when exactly one order matches', async () => {
    mockSearchCalendarOrders.mockResolvedValue({
      hits: [
        {
          id: 'order-1',
          po_number: 'PO-1000',
          customer_name: 'Acme Rebottling',
          production_date: ANCHOR_MONDAY,
        },
      ],
      hasMore: false,
    })
    renderCalendar({ rows: [makeRow()] })

    search('1000')

    await waitFor(() => expect(cardFor('PO-1000')).toHaveAttribute('data-found', 'true'))
    expect(screen.queryByTestId('calendar-search-choices')).not.toBeInTheDocument()
  })

  it('offers a choice rather than guessing when several match', async () => {
    // The failure this prevents: silently flying to the first hit while two
    // more matched out of view, with nothing to say so.
    mockSearchCalendarOrders.mockResolvedValue({
      hits: [
        { id: 'a', po_number: 'PO-1000', customer_name: 'Acme', production_date: ANCHOR_MONDAY },
        { id: 'b', po_number: 'PO-10001', customer_name: 'Beta', production_date: DISTANT_DATE },
      ],
      hasMore: false,
    })
    renderCalendar({ rows: [makeRow()] })

    search('1000')

    const list = await screen.findByTestId('calendar-search-choices')
    expect(within(list).getByText('PO-1000')).toBeInTheDocument()
    expect(within(list).getByText('PO-10001')).toBeInTheDocument()
    expect(cardFor('PO-1000')).not.toHaveAttribute('data-found')
  })

  it('says so when nothing matches', async () => {
    mockSearchCalendarOrders.mockResolvedValue({ hits: [], hasMore: false })
    renderCalendar({ rows: [makeRow()] })

    search('9999')

    expect(await screen.findByTestId('calendar-search-message')).toHaveTextContent(
      'No order matching "9999".',
    )
  })

  it('surfaces a lookup failure instead of looking like a miss', async () => {
    mockSearchCalendarOrders.mockResolvedValue({ error: 'Something went wrong.' })
    renderCalendar({ rows: [makeRow()] })

    search('9999')

    expect(await screen.findByTestId('calendar-search-message')).toHaveTextContent(
      'Something went wrong.',
    )
  })
})

describe('CalendarSearch — an order outside the loaded weeks', () => {
  it('re-anchors the page on the hit’s week and names the card to reveal', async () => {
    mockSearchCalendarOrders.mockResolvedValue({
      hits: [
        {
          id: 'far',
          po_number: 'PO-9000',
          customer_name: 'Acme',
          production_date: DISTANT_DATE,
        },
      ],
      hasMore: false,
    })
    renderCalendar({ rows: [makeRow()] })

    search('9000')

    // 2027-03-02 is a Tuesday; its business week opens on Monday 2027-03-01.
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith('/calendar?week=2027-03-01&find=PO-9000'),
    )
  })

  it('lights the card on arrival, once the new week’s rows are in', async () => {
    // The other half of the jump: the page has re-rendered around the new
    // anchor and `?find=` arrives as a prop.
    renderCalendar({
      rows: [makeRow({ po_number: 'PO-9000', production_date: ANCHOR_TUESDAY })],
      weekStart: ANCHOR_MONDAY,
      findPo: 'PO-9000',
    })

    await waitFor(() => expect(cardFor('PO-9000')).toHaveAttribute('data-found', 'true'))
  })
})

describe('CalendarSearch — an order with no production date', () => {
  it('opens the undated callout and lights the card there', async () => {
    // It has no column to scroll to, but it is always loaded: the undated query
    // is unbounded, so this never needs a round-trip or a navigation.
    renderCalendar({
      unscheduled: [makeRow({ po_number: 'PO-2000', production_date: null })],
    })

    search('PO-2000')

    // The panel opens first; the card inside it is lit on the reveal's next
    // attempt, once it is actually in the DOM to be found.
    await waitFor(() => expect(screen.getByTestId('unscheduled-dropdown')).toBeInTheDocument())
    await waitFor(() => expect(cardFor('PO-2000')).toHaveAttribute('data-found', 'true'))
    expect(mockPush).not.toHaveBeenCalled()
  })
})

describe('CalendarSearch — searching while orders are hidden', () => {
  it('switches to the orders view rather than refusing', async () => {
    renderCalendar({ rows: [makeRow()] })
    // One press of the cycle leaves the pickups view, which draws no orders.
    fireEvent.click(screen.getByTestId('calendar-view-cycle'))
    expect(cardFor('PO-1000')).toBeNull()

    search('PO-1000')

    await waitFor(() =>
      expect(screen.getByTestId('calendar-view-cycle')).toHaveAttribute('data-view', 'orders'),
    )
    await waitFor(() => expect(cardFor('PO-1000')).toHaveAttribute('data-found', 'true'))
  })
})

describe('CalendarSearch — narrowing as you type', () => {
  it('lists matches without Enter being pressed', async () => {
    mockSearchCalendarOrders.mockResolvedValue({
      hits: hitsFor('PO-1000', 'PO-1001', 'PO-1002'),
      hasMore: false,
    })
    renderCalendar()

    typeInSearch('100')

    const list = await screen.findByTestId('calendar-search-choices')
    expect(within(list).getAllByRole('button')).toHaveLength(3)
  })

  it('renders them in the PO order the query returned', async () => {
    // Ascending by PO number, so a further character narrows the same list
    // instead of reshuffling it under a finger already on its way to a row.
    mockSearchCalendarOrders.mockResolvedValue({
      hits: hitsFor('PO-1000', 'PO-1001', 'PO-1002'),
      hasMore: false,
    })
    renderCalendar()

    typeInSearch('100')

    const list = await screen.findByTestId('calendar-search-choices')
    const labels = within(list)
      .getAllByRole('button')
      .map((button) => button.textContent?.slice(0, 7))
    expect(labels).toEqual(['PO-1000', 'PO-1001', 'PO-1002'])
  })

  it('moves nothing while typing — only choosing navigates', async () => {
    mockSearchCalendarOrders.mockResolvedValue({
      hits: hitsFor('PO-1000', 'PO-1001'),
      hasMore: false,
    })
    renderCalendar({ rows: [makeRow()] })

    typeInSearch('100')
    await screen.findByTestId('calendar-search-choices')

    expect(mockPush).not.toHaveBeenCalled()
    expect(cardFor('PO-1000')).not.toHaveAttribute('data-found')
  })

  it('narrows to the newer term as more characters arrive', async () => {
    mockSearchCalendarOrders.mockResolvedValue({
      hits: hitsFor('PO-1000', 'PO-1001', 'PO-1002'),
      hasMore: false,
    })
    renderCalendar()
    typeInSearch('100')
    await screen.findByTestId('calendar-search-choices')

    mockSearchCalendarOrders.mockResolvedValue({ hits: hitsFor('PO-1002'), hasMore: false })
    typeInSearch('1002')

    await waitFor(() => {
      const list = screen.getByTestId('calendar-search-choices')
      expect(within(list).getAllByRole('button')).toHaveLength(1)
    })
    expect(mockSearchCalendarOrders).toHaveBeenLastCalledWith('1002')
  })

  it('waits for a pause rather than querying every keystroke', async () => {
    mockSearchCalendarOrders.mockResolvedValue({ hits: hitsFor('PO-1000'), hasMore: false })
    renderCalendar()

    typeInSearch('1')
    typeInSearch('10')
    typeInSearch('100')

    await screen.findByTestId('calendar-search-choices')
    expect(mockSearchCalendarOrders).toHaveBeenCalledTimes(1)
    expect(mockSearchCalendarOrders).toHaveBeenCalledWith('100')
  })

  it('says so when more matched than the list holds', async () => {
    // A silently truncated list is how someone concludes their order is gone.
    mockSearchCalendarOrders.mockResolvedValue({
      hits: hitsFor('PO-1000', 'PO-1001'),
      hasMore: true,
    })
    renderCalendar()

    typeInSearch('PO')

    expect(await screen.findByTestId('calendar-search-more')).toBeInTheDocument()
  })

  it('drops the list when the box is emptied, without another query', async () => {
    mockSearchCalendarOrders.mockResolvedValue({ hits: hitsFor('PO-1000'), hasMore: false })
    renderCalendar()
    typeInSearch('100')
    await screen.findByTestId('calendar-search-choices')
    mockSearchCalendarOrders.mockClear()

    typeInSearch('')

    await waitFor(() =>
      expect(screen.queryByTestId('calendar-search-choices')).not.toBeInTheDocument(),
    )
    expect(mockSearchCalendarOrders).not.toHaveBeenCalled()
  })

  it('Enter takes the single listed result without asking again', async () => {
    mockSearchCalendarOrders.mockResolvedValue({ hits: hitsFor('PO-1000'), hasMore: false })
    renderCalendar({ rows: [makeRow()] })
    typeInSearch('100')
    await screen.findByTestId('calendar-search-choices')
    mockSearchCalendarOrders.mockClear()

    fireEvent.keyDown(screen.getByTestId('calendar-search-input'), { key: 'Enter' })

    await waitFor(() => expect(cardFor('PO-1000')).toHaveAttribute('data-found', 'true'))
    expect(mockSearchCalendarOrders).not.toHaveBeenCalled()
  })
})
