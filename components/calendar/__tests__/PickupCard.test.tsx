import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import PickupCard, { formatPickupCounts, isLockedPickupStatus } from '../PickupCard'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

function makePickup(overrides: Partial<CalendarPickupRow> = {}): CalendarPickupRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    customer_id: '22222222-2222-2222-2222-222222222222',
    customer_name: 'Acme Industrial',
    status: 'scheduled',
    qty_275: 12,
    qty_330: 4,
    pickup_date: '2026-07-31',
    sort_index: null,
    address: null,
    notes: null,
    contacts: [],
    ...overrides,
  }
}

describe('formatPickupCounts', () => {
  it('renders both sizes with the spaced multiplication sign', () => {
    expect(formatPickupCounts({ qty_275: 12, qty_330: 4 })).toBe('12 × 275, 4 × 330')
  })

  it('drops a size that is zero rather than printing a zero term', () => {
    expect(formatPickupCounts({ qty_275: 0, qty_330: 4 })).toBe('4 × 330')
    expect(formatPickupCounts({ qty_275: 9, qty_330: 0 })).toBe('9 × 275')
  })

  it('falls back to an em dash when both sizes are zero', () => {
    // Unreachable through the form — `createPickup` requires one positive
    // count — so this is the guard against a row that got there another way.
    expect(formatPickupCounts({ qty_275: 0, qty_330: 0 })).toBe('—')
  })
})

describe('isLockedPickupStatus', () => {
  it('locks a completed pickup', () => {
    expect(isLockedPickupStatus('completed')).toBe(true)
  })

  it('leaves a scheduled pickup unlocked', () => {
    expect(isLockedPickupStatus('scheduled')).toBe(false)
  })
})

describe('PickupCard', () => {
  it('renders the 275/330 counts and holds var(--card-h)', () => {
    render(<PickupCard pickup={makePickup()} />)

    expect(screen.getByTestId('pickup-card-counts')).toHaveTextContent('12 × 275, 4 × 330')
    // The four-card math is measured in cards, not card kinds: a pickup that
    // sized itself would break the column the moment both lists were on.
    expect(screen.getByTestId('pickup-card')).toHaveStyle({ height: 'var(--card-h)' })
  })

  it('a completed pickup renders the built surface', () => {
    render(<PickupCard pickup={makePickup({ status: 'completed' })} />)

    const card = screen.getByTestId('pickup-card')
    expect(card).toHaveAttribute('data-locked', 'true')
    expect(card.className).toContain('bg-muted')
    expect(card.className).toContain('opacity-75')
    expect(card.className).not.toContain('bg-amber-100')
  })

  it('a scheduled pickup carries the amber surface, not the order card language', () => {
    render(<PickupCard pickup={makePickup()} />)

    const card = screen.getByTestId('pickup-card')
    expect(card.className).toContain('bg-amber-100')
    expect(card).not.toHaveAttribute('data-locked')
    // CONSTRAINT-25: never the green-275 / blue-330 size-and-type language.
    expect(card.querySelector('.text-green-700')).toBeNull()
    expect(card.querySelector('.text-blue-700')).toBeNull()
  })

  it('shows the collection date, or an em dash while unscheduled', () => {
    const { rerender } = render(<PickupCard pickup={makePickup()} />)
    expect(screen.getByText('Jul 31')).toBeInTheDocument()

    rerender(<PickupCard pickup={makePickup({ pickup_date: null })} />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('falls back to a placeholder when the customer name is null', () => {
    render(<PickupCard pickup={makePickup({ customer_name: null })} />)

    expect(screen.getByText('Unknown customer')).toBeInTheDocument()
    expect(screen.getByLabelText('Pickup for Unknown customer')).toBeInTheDocument()
  })

  it('never shows an address or notes — those belong to the popup', () => {
    const { container } = render(
      <PickupCard pickup={makePickup({ address: '9 Dock Rd', notes: 'gate code 4821' })} />,
    )

    expect(container.textContent).not.toContain('9 Dock Rd')
    expect(container.textContent).not.toContain('gate code')
  })
})
