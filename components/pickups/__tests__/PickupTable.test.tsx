import { render, screen, within, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import PickupTable, { buildPickupsHref } from '../PickupTable'
import type { PickupTableRow } from '@/db/queries/pickups'

const mockPush = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

function makePickup(index: number, overrides: Partial<PickupTableRow> = {}): PickupTableRow {
  const pad = String(index).padStart(12, '0')
  return {
    id: `00000000-0000-0000-0000-${pad}`,
    customer_id: '11111111-1111-1111-1111-111111111111',
    customer_name: 'Acme Industrial',
    status: 'scheduled',
    qty_275: 12,
    qty_330: 4,
    pickup_date: '2026-08-20',
    ...overrides,
  }
}

function renderTable(props: Partial<React.ComponentProps<typeof PickupTable>> = {}) {
  return render(
    <PickupTable
      pickups={[]}
      status="all"
      search=""
      selectedId={null}
      onNewPickup={vi.fn()}
      {...props}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PickupTable', () => {
  it('renders rows and builds the expected filter href', () => {
    const pickups = [
      makePickup(0, { customer_name: 'Acme Industrial' }),
      makePickup(1, { customer_name: 'Beta Chemicals' }),
    ]
    renderTable({ pickups, status: 'scheduled', search: 'acme' })

    expect(screen.getByText('Acme Industrial')).toBeInTheDocument()
    expect(screen.getByText('Beta Chemicals')).toBeInTheDocument()

    // Selecting a row carries the active status + search along, so the server
    // re-renders the same filtered list with the detail panel opened.
    fireEvent.click(screen.getByRole('row', { name: /Acme Industrial/i }))
    expect(mockPush).toHaveBeenCalledWith(
      `/pickups?status=scheduled&search=acme&id=${pickups[0].id}`,
    )

    // And switching tabs keeps the search term rather than resetting it.
    fireEvent.click(screen.getByRole('tab', { name: /cancelled/i }))
    expect(mockPush).toHaveBeenCalledWith('/pickups?status=cancelled&search=acme')
  })

  it('the empty state distinguishes no-results from no-pickups', () => {
    const { unmount: unmountBare } = renderTable()
    expect(screen.getByText(/no pickups yet/i)).toBeInTheDocument()
    unmountBare()

    const { unmount: unmountFiltered } = renderTable({ status: 'completed' })
    expect(screen.getByText(/no pickups match this filter/i)).toBeInTheDocument()
    unmountFiltered()

    renderTable({ status: 'completed', search: 'acme' })
    expect(screen.getByText(/no pickups match that search/i)).toBeInTheDocument()
  })

  it('renders the columns Customer | 275 | 330 | Status | Date and nothing else', () => {
    renderTable({ pickups: [makePickup(0)] })
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim())
    expect(headers).toEqual(['Customer', '275', '330', 'Status', 'Date'])
  })

  it('renders an em dash for a zero count and for a null date', () => {
    renderTable({
      pickups: [
        makePickup(0, {
          customer_name: 'Zero Co',
          qty_275: 7,
          qty_330: 0,
          pickup_date: null,
        }),
      ],
    })
    const row = screen.getByRole('row', { name: /Zero Co/i })
    expect(within(row).getByText('7')).toBeInTheDocument()
    // Two em dashes: the zero 330 count and the missing date.
    expect(within(row).getAllByText('—')).toHaveLength(2)
  })

  it('exposes no delete control anywhere on the table', () => {
    renderTable({ pickups: [makePickup(0), makePickup(1)] })
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/delete/i)).not.toBeInTheDocument()
  })

  it('debounces the search by 250ms before navigating', () => {
    vi.useFakeTimers()
    try {
      renderTable({ status: 'scheduled' })
      const input = screen.getByLabelText(/search pickups/i)

      fireEvent.change(input, { target: { value: 'ac' } })
      fireEvent.change(input, { target: { value: 'acme' } })
      // Nothing has fired yet — the first keystroke's timer was cleared.
      vi.advanceTimersByTime(249)
      expect(mockPush).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(mockPush).toHaveBeenCalledTimes(1)
      expect(mockPush).toHaveBeenCalledWith('/pickups?status=scheduled&search=acme')
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not render pagination controls — the list is unbounded', () => {
    const pickups = Array.from({ length: 20 }, (_, index) => makePickup(index))
    renderTable({ pickups })
    expect(screen.queryByRole('link', { name: /next page/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /previous page/i })).not.toBeInTheDocument()
  })
})

describe('buildPickupsHref', () => {
  it('omits the default status and a blank search', () => {
    expect(buildPickupsHref('all', '', null)).toBe('/pickups')
    expect(buildPickupsHref('all', '   ', null)).toBe('/pickups')
  })

  it('carries every non-default param', () => {
    expect(
      buildPickupsHref('cancelled', 'acme', '22222222-2222-2222-2222-222222222222'),
    ).toBe('/pickups?status=cancelled&search=acme&id=22222222-2222-2222-2222-222222222222')
  })
})
