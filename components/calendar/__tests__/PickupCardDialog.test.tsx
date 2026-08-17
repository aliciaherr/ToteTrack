import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { forwardRef } from 'react'

const mockUpdatePickupStatus = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())

type MotionMockProps = Record<string, unknown> & { children?: React.ReactNode }

vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
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

// `lib/actions/pickups` carries `'use server'` and imports the postgres driver;
// vitest has no Next transform to replace it with an RPC stub.
vi.mock('@/lib/actions/pickups', () => ({
  updatePickup: vi.fn(),
  updatePickupStatus: mockUpdatePickupStatus,
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ toast: mockToast }) }))

import PickupCardDialog from '../PickupCardDialog'
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
    address: '9 Dock Rd',
    notes: 'gate code 4821',
    contacts: [
      {
        id: '33333333-3333-3333-3333-333333333333',
        name: 'Dana Reyes',
        email: 'dana@acme.test',
        phone: null,
      },
    ],
    ...overrides,
  }
}

function renderDialog(
  overrides: Partial<CalendarPickupRow> = {},
  onRemove = vi.fn().mockResolvedValue(undefined),
) {
  const onClose = vi.fn()
  render(
    <PickupCardDialog
      open
      pickup={makePickup(overrides)}
      onClose={onClose}
      onRemove={onRemove}
    />,
  )
  return { onClose, onRemove }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PickupCardDialog', () => {
  it('stays unmounted when there is no selection', () => {
    render(<PickupCardDialog open={false} pickup={null} onClose={vi.fn()} onRemove={vi.fn()} />)

    expect(screen.queryByTestId('pickup-card-dialog')).not.toBeInTheDocument()
  })

  it('titles itself with the customer and shows the counts, address and notes', () => {
    renderDialog()

    const dialog = screen.getByTestId('pickup-card-dialog')
    expect(within(dialog).getByText('Acme Industrial')).toBeInTheDocument()
    expect(within(dialog).getByText('12 × 275, 4 × 330')).toBeInTheDocument()
    expect(within(dialog).getByText('9 Dock Rd')).toBeInTheDocument()
    expect(within(dialog).getByText('gate code 4821')).toBeInTheDocument()
  })

  it('never shows a price — a pickup is never billed', () => {
    const dialog = renderDialog() && screen.getByTestId('pickup-card-dialog')

    expect(dialog.textContent).not.toContain('$')
    expect(dialog.textContent).not.toContain('Total')
  })

  it('offers the Contact menu, unforked from the order popup', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: /contact/i }))

    expect(screen.getByTestId('contact-menu')).toBeInTheDocument()
    expect(screen.getByRole('menu', { name: 'Contact' })).toBeInTheDocument()
  })

  it('marks a scheduled pickup complete through the audited action', async () => {
    mockUpdatePickupStatus.mockResolvedValueOnce({ success: true })
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Mark as Complete' }))

    await waitFor(() =>
      expect(mockUpdatePickupStatus).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        'completed',
      ),
    )
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('cancels a scheduled pickup through the same action', async () => {
    mockUpdatePickupStatus.mockResolvedValueOnce({ success: true })
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Pickup' }))

    await waitFor(() =>
      expect(mockUpdatePickupStatus).toHaveBeenCalledWith(
        '11111111-1111-1111-1111-111111111111',
        'cancelled',
      ),
    )
  })

  it('surfaces a rejected transition in the alert region rather than silently failing', async () => {
    mockUpdatePickupStatus.mockResolvedValueOnce({ error: 'Invalid status transition.' })
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Mark as Complete' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid status transition.')
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('offers only the reopen move on a completed pickup', () => {
    renderDialog({ status: 'completed' })

    expect(screen.getByRole('button', { name: 'Reopen Pickup' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mark as Complete' })).not.toBeInTheDocument()
  })

  it('removes the pickup from the calendar and closes', async () => {
    const { onClose, onRemove } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Remove from calendar' }))

    await waitFor(() =>
      expect(onRemove).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111'),
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('closes anyway when the remove mutation rejects, rather than trapping the panel', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onRemove = vi.fn().mockRejectedValue(new Error('offline'))
    const { onClose } = renderDialog({}, onRemove)

    fireEvent.click(screen.getByRole('button', { name: 'Remove from calendar' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('links out to the Pickups tab instead of editing fields here', () => {
    renderDialog()

    expect(screen.getByRole('link', { name: 'Open in Pickups' })).toHaveAttribute(
      'href',
      '/pickups?id=11111111-1111-1111-1111-111111111111',
    )
  })

  it('closes on Escape', () => {
    const { onClose } = renderDialog()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })
})
