import { render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ProductionWidget, { formatDayLabel } from '../ProductionWidget'
import {
  productionWidgetDays,
  PRODUCTION_WIDGET_ROWS_PER_DAY,
  type ProductionDayGroup,
  type ProductionWidgetRow,
} from '@/db/queries/production-widget.constants'

vi.mock('next/link', () => ({
  default: ({ href, children, className }: any) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

// 2026-07-27 is a Monday, 07-31 the Friday of that week, 07-25/26 the weekend
// before it. Local noon everywhere so no timezone can shift the day.
const MONDAY = new Date(2026, 6, 27, 12)
const THURSDAY = new Date(2026, 6, 30, 12)
const FRIDAY = new Date(2026, 6, 31, 12)
const SATURDAY = new Date(2026, 6, 25, 12)
const SUNDAY = new Date(2026, 6, 26, 12)

function makeRow(overrides: Partial<ProductionWidgetRow> = {}): ProductionWidgetRow {
  return {
    id: 'order-1',
    po_number: 'PO-1000',
    customer_name: 'Acme Industrial',
    status: 'scheduled',
    backhaul: false,
    same_day_delivery: false,
    production_day: '2026-07-27',
    ...overrides,
  }
}

function makeGroup(date: string, rowCount: number, total = rowCount): ProductionDayGroup {
  return {
    date,
    rows: Array.from({ length: rowCount }, (_, index) =>
      makeRow({ id: `order-${index}`, po_number: `PO-${1000 + index}`, production_day: date }),
    ),
    total,
  }
}

function renderWidget(groups: ProductionDayGroup[], unscheduledCount = 0) {
  return render(<ProductionWidget groups={groups} unscheduledCount={unscheduledCount} />)
}

describe('productionWidgetDays', () => {
  it('starts with today when today is a business day', () => {
    expect(productionWidgetDays(MONDAY)).toEqual(['2026-07-27', '2026-07-28'])
  })

  it('on Friday the second day is Monday, not Saturday', () => {
    expect(productionWidgetDays(FRIDAY)).toEqual(['2026-07-31', '2026-08-03'])
  })

  it.each([
    ['Saturday', SATURDAY],
    ['Sunday', SUNDAY],
  ])('on %s the window starts at Monday', (_label, weekend) => {
    expect(productionWidgetDays(weekend)).toEqual(['2026-07-27', '2026-07-28'])
  })

  it('never returns a weekend date', () => {
    for (const today of [MONDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY]) {
      for (const day of productionWidgetDays(today)) {
        const dayOfWeek = new Date(`${day}T12:00:00`).getDay()
        expect(dayOfWeek).not.toBe(0)
        expect(dayOfWeek).not.toBe(6)
      }
    }
  })
})

describe('formatDayLabel', () => {
  // Relative labels were removed on purpose: they held for at most one of the
  // two columns, and on a Friday or a weekend for neither, so the heading
  // changed format depending on when you looked at it.
  it('always renders the real weekday and date', () => {
    expect(formatDayLabel('2026-07-27')).toBe('Mon, Jul 27')
    expect(formatDayLabel('2026-08-03')).toBe('Mon, Aug 3')
  })

  it('never renders a relative label, even for today', () => {
    const label = formatDayLabel('2026-07-27')
    expect(label).not.toMatch(/today|tomorrow/i)
  })
})

describe('ProductionWidget', () => {
  it('renders the two days as side-by-side columns, not a stacked list', () => {
    renderWidget([makeGroup('2026-07-27', 2), makeGroup('2026-07-28', 1)])

    const columns = screen.getAllByTestId('production-day')
    expect(columns).toHaveLength(2)
    expect(columns[0]).toHaveAttribute('data-date', '2026-07-27')
    expect(columns[1]).toHaveAttribute('data-date', '2026-07-28')
    // Siblings in one grid — neither contains the other.
    expect(columns[0].contains(columns[1])).toBe(false)
    expect(columns[0].parentElement).toBe(columns[1].parentElement)
    expect(columns[0].parentElement?.className).toContain('grid-cols-2')
  })

  it('heads each column with a real date, never Today/Tomorrow', () => {
    renderWidget([makeGroup('2026-07-27', 1), makeGroup('2026-07-28', 1)])

    expect(screen.getByRole('heading', { name: 'Mon, Jul 27' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tue, Jul 28' })).toBeInTheDocument()
    expect(screen.queryByText(/today|tomorrow/i)).not.toBeInTheDocument()
  })

  it('on a Friday the second column is the following Monday', () => {
    renderWidget([makeGroup('2026-07-31', 1), makeGroup('2026-08-03', 1)])

    expect(screen.getByRole('heading', { name: 'Fri, Jul 31' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mon, Aug 3' })).toBeInTheDocument()
  })

  it(`caps at ${PRODUCTION_WIDGET_ROWS_PER_DAY} rows per column and shows the remainder`, () => {
    renderWidget([makeGroup('2026-07-27', PRODUCTION_WIDGET_ROWS_PER_DAY, 6)])

    expect(screen.getAllByRole('listitem')).toHaveLength(PRODUCTION_WIDGET_ROWS_PER_DAY)
    expect(screen.getByText('+ 2 more')).toBeInTheDocument()
  })

  it('shows 8 orders across the two columns when both are full', () => {
    renderWidget([
      makeGroup('2026-07-27', PRODUCTION_WIDGET_ROWS_PER_DAY),
      makeGroup('2026-07-28', PRODUCTION_WIDGET_ROWS_PER_DAY),
    ])

    expect(screen.getAllByRole('listitem')).toHaveLength(PRODUCTION_WIDGET_ROWS_PER_DAY * 2)
  })

  it('shows no remainder line when everything fits', () => {
    renderWidget([makeGroup('2026-07-27', 2, 2)])

    expect(screen.queryByText(/more$/)).not.toBeInTheDocument()
  })

  it('shows the unscheduled count as a light red pill', () => {
    renderWidget([makeGroup('2026-07-27', 1)], 4)

    const pill = screen.getByText('4 unscheduled')
    expect(pill).toBeInTheDocument()
    expect(pill.className).toContain('bg-red-100')
    expect(pill.className).toContain('text-red-800')
  })

  it('says all orders are dated rather than showing a zero pill', () => {
    renderWidget([makeGroup('2026-07-27', 1)], 0)

    expect(screen.getByText('All orders dated')).toBeInTheDocument()
    expect(screen.queryByText('0 unscheduled')).not.toBeInTheDocument()
  })

  it('links the footer to the calendar', () => {
    renderWidget([makeGroup('2026-07-27', 1)])

    expect(screen.getByRole('link', { name: /view calendar/i })).toHaveAttribute(
      'href',
      '/calendar',
    )
  })

  it('renders an empty state in that column only, not a blank group', () => {
    renderWidget([makeGroup('2026-07-27', 0), makeGroup('2026-07-28', 1)])

    expect(screen.getByRole('heading', { name: 'Mon, Jul 27' })).toBeInTheDocument()
    expect(screen.getByText('Nothing scheduled.')).toBeInTheDocument()
    // The other column still lists its order.
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('places B and SD tags immediately after the customer name', () => {
    renderWidget([
      {
        date: '2026-07-27',
        rows: [makeRow({ backhaul: true, same_day_delivery: true })],
        total: 1,
      },
    ])

    const row = screen.getByRole('listitem')
    expect(within(row).getByLabelText('Backhaul')).toBeInTheDocument()
    expect(within(row).getByLabelText('Same-day delivery')).toBeInTheDocument()

    // The tags share a parent with the customer name, not with the PO number.
    const customerLine = within(row).getByText('Acme Industrial').parentElement
    expect(customerLine).toContainElement(within(row).getByLabelText('Backhaul'))
    expect(customerLine).toContainElement(within(row).getByLabelText('Same-day delivery'))
  })

  it('links each row to the order deep link with a 44px target', () => {
    renderWidget([makeGroup('2026-07-27', 1)])

    const link = within(screen.getByRole('listitem')).getByRole('link')
    expect(link).toHaveAttribute('href', '/orders?id=order-0')
    expect(link.className).toContain('min-h-[44px]')
  })

  it('falls back to a placeholder when the customer name is null', () => {
    renderWidget([
      { date: '2026-07-27', rows: [makeRow({ customer_name: null })], total: 1 },
    ])

    expect(screen.getByText('Unknown customer')).toBeInTheDocument()
  })

  it.each(['completed', 'invoiced'] as const)('dims %s rows the way the calendar card does', (status) => {
    renderWidget([{ date: '2026-07-27', rows: [makeRow({ status })], total: 1 }])

    const link = within(screen.getByRole('listitem')).getByRole('link')
    expect(link.className).toContain('bg-muted')
    expect(link.className).toContain('opacity-75')
    // Legibility floor (CONSTRAINT-19): dimmed, never illegible.
    expect(link.className).not.toMatch(/opacity-(0|5|10|20|25|30|40|50|60)\b/)
    expect(screen.getByText('PO-1000')).toBeInTheDocument()
  })

  it('leaves scheduled rows undimmed', () => {
    renderWidget([{ date: '2026-07-27', rows: [makeRow({ status: 'scheduled' })], total: 1 }])

    const link = within(screen.getByRole('listitem')).getByRole('link')
    expect(link.className).toContain('bg-card')
    expect(link.className).not.toMatch(/opacity-/)
  })

  it('dims only the built rows in a mixed column', () => {
    renderWidget([
      {
        date: '2026-07-27',
        rows: [
          makeRow({ id: 'live', po_number: 'PO-LIVE', status: 'scheduled' }),
          makeRow({ id: 'built', po_number: 'PO-BUILT', status: 'completed' }),
        ],
        total: 2,
      },
    ])

    const [live, built] = screen.getAllByRole('listitem')
    expect(within(live).getByRole('link').className).not.toContain('opacity-75')
    expect(within(built).getByRole('link').className).toContain('opacity-75')
  })

  it('keeps row height identical whether or not a row carries tags', () => {
    // Regression: `BackhaulTag` / `SameDayTag` are 20px against a 16px text
    // line, so an untagged row and a tagged row in the opposite column stopped
    // lining up. Both text lines are pinned to h-5.
    renderWidget([
      { date: '2026-07-27', rows: [makeRow({ id: 'plain' })], total: 1 },
      {
        date: '2026-07-28',
        rows: [makeRow({ id: 'tagged', backhaul: true, same_day_delivery: true })],
        total: 1,
      },
    ])

    const [plain, tagged] = screen.getAllByRole('listitem')
    expect(within(tagged).getByLabelText('Backhaul')).toBeInTheDocument()

    const lineHeights = (item: HTMLElement) =>
      Array.from(item.querySelectorAll('a > span')).map((el) => el.className.includes('h-5'))

    expect(lineHeights(plain)).toEqual([true, true])
    expect(lineHeights(tagged)).toEqual([true, true])
  })
})
