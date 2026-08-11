import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPush = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
  usePathname: () => '/customers',
  useSearchParams: () => new URLSearchParams('id=abc&window=6M'),
}))

// The real `motion.span` swallows unknown props; this proxy forwards `layoutId`
// as a data attribute so the "own layoutId" acceptance criterion is assertable.
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({
          children,
          layoutId,
          transition: _transition,
          variants: _variants,
          initial: _initial,
          animate: _animate,
          exit: _exit,
          ...rest
        }: Record<string, unknown> & { children?: React.ReactNode }) => (
          <div data-layout-id={layoutId as string | undefined} {...rest}>
            {children}
          </div>
        ),
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}))

import PickupHistory from '../PickupHistory'
import type { CustomerPickupRow } from '@/db/queries/pickups'

const samplePickups: CustomerPickupRow[] = [
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    status: 'scheduled',
    qty_275: 12,
    qty_330: 0,
    pickup_date: '2026-05-01',
  },
  {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    status: 'cancelled',
    qty_275: 0,
    qty_330: 4,
    pickup_date: '2026-04-02',
  },
]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PickupHistory', () => {
  it('renders rows for the selected window', () => {
    render(<PickupHistory pickups={samplePickups} window="3M" unscheduledCount={0} />)

    expect(screen.getByRole('heading', { name: /pickup history/i })).toBeInTheDocument()
    expect(screen.getByText('2026-05-01')).toBeInTheDocument()
    expect(screen.getByText('2026-04-02')).toBeInTheDocument()
    expect(screen.getByText('Scheduled')).toBeInTheDocument()
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
    // A zero count renders as an em dash, matching the pickups table.
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(2)
    // The active tab is the one the server resolved, not a local default.
    expect(screen.getByRole('tab', { name: '3M', selected: true })).toBeInTheDocument()
  })

  it('empty state when the customer has none', () => {
    render(<PickupHistory pickups={[]} window="1M" unscheduledCount={0} />)

    expect(screen.getByText(/no pickups in this window/i)).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('links a row to the pickups tab by id', () => {
    render(<PickupHistory pickups={samplePickups} window="3M" unscheduledCount={0} />)

    fireEvent.click(screen.getByRole('link', { name: 'View pickup on 2026-05-01' }))

    expect(mockPush).toHaveBeenCalledWith(
      '/pickups?id=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    )
  })

  it('writes ?pwindow= on a tab change and leaves Order History\'s ?window= alone', () => {
    render(<PickupHistory pickups={samplePickups} window="1M" unscheduledCount={0} />)

    fireEvent.click(screen.getByRole('tab', { name: '1Y' }))

    expect(mockPush).toHaveBeenCalledOnce()
    const href = mockPush.mock.calls[0][0] as string
    const params = new URLSearchParams(href.split('?')[1])
    expect(params.get('pwindow')).toBe('1Y')
    // Order History's param survives untouched — the two panels are independent.
    expect(params.get('window')).toBe('6M')
    expect(params.get('id')).toBe('abc')
  })

  it('notes the unscheduled count in the heading when there is one', () => {
    render(<PickupHistory pickups={samplePickups} window="3M" unscheduledCount={3} />)

    const heading = screen.getByRole('heading', { name: /pickup history/i })
    expect(heading).toHaveTextContent('Pickup History · 3 unscheduled')

    // Quiet by construction: the palette's muted token, no weight bump, and
    // none of the badge/pill/accent chrome that would read as an alert.
    const note = screen.getByText('· 3 unscheduled')
    expect(note.className).toContain('text-muted-foreground')
    expect(note.className).toContain('font-normal')
    expect(note.className).not.toMatch(/bg-|rounded|font-semibold|font-bold|text-primary/)
  })

  it('omits the suffix entirely when nothing is unscheduled', () => {
    render(<PickupHistory pickups={samplePickups} window="3M" unscheduledCount={0} />)

    const heading = screen.getByRole('heading', { name: /pickup history/i })
    expect(heading.textContent).toBe('Pickup History')
    expect(screen.queryByText(/unscheduled/i)).toBeNull()
  })

  it('shows the count without adding a dateless row to the table', () => {
    // The count is not window-scoped and never becomes a row — the list stays
    // exactly what `getCustomerPickups` returned for the active window.
    render(<PickupHistory pickups={[]} window="1M" unscheduledCount={2} />)

    expect(screen.getByText(/no pickups in this window/i)).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
    expect(
      screen.getByRole('heading', { name: /pickup history/i }),
    ).toHaveTextContent('· 2 unscheduled')
  })

  it('uses an underline layoutId of its own, not Order History\'s', () => {
    render(<PickupHistory pickups={samplePickups} window="1M" unscheduledCount={0} />)

    const underline = document.querySelector('[data-layout-id]')
    expect(underline?.getAttribute('data-layout-id')).toBe('pickup-history-underline')
    expect(underline?.getAttribute('data-layout-id')).not.toBe('order-history-underline')
  })
})
