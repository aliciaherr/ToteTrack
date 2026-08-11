import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreatePickup = vi.hoisted(() => vi.fn())
const mockUpdatePickup = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/pickups', () => ({
  createPickup: mockCreatePickup,
  updatePickup: mockUpdatePickup,
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: React.ReactNode }) => (
          <form {...rest}>{children}</form>
        ),
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
}))

import PickupForm from '../PickupForm'
import type { PickupDetail } from '@/db/queries/pickups'
import type { CustomerSelectOption } from '@/db/queries/customers'

const customers: CustomerSelectOption[] = [
  { id: '22222222-2222-2222-2222-222222222222', company_name: 'Acme Industrial', addresses: [] },
  { id: '33333333-3333-3333-3333-333333333333', company_name: 'Beta Chemicals', addresses: [] },
]

const sampleDetail: PickupDetail = {
  id: '44444444-4444-4444-4444-444444444444',
  customer_id: customers[0].id,
  customer_name: 'Acme Industrial',
  status: 'scheduled',
  qty_275: 12,
  qty_330: 0,
  pickup_date: '2026-08-20',
  address: '123 Main Street',
  notes: 'Rear gate only.',
}

function renderForm(props: Partial<React.ComponentProps<typeof PickupForm>> = {}) {
  return render(
    <PickupForm
      mode="create"
      customers={customers}
      lockedCustomerId={null}
      onClose={vi.fn()}
      onSaved={vi.fn()}
      {...props}
    />,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PickupForm', () => {
  it('submitting creates a pickup', async () => {
    mockCreatePickup.mockResolvedValueOnce({ id: 'new-pickup-id' })
    const onSaved = vi.fn()
    renderForm({ onSaved })

    fireEvent.change(screen.getByLabelText(/^Customer$/i), {
      target: { value: customers[1].id },
    })
    fireEvent.change(screen.getByLabelText(/275 gal totes/i), { target: { value: '12' } })
    fireEvent.change(screen.getByLabelText(/330 gal totes/i), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText(/pickup date/i), {
      target: { value: '2026-08-20' },
    })
    fireEvent.change(screen.getByLabelText(/collection address/i), {
      target: { value: '456 Oak Ave' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create pickup/i }))

    await vi.waitFor(() => expect(mockCreatePickup).toHaveBeenCalledTimes(1))
    expect(mockCreatePickup).toHaveBeenCalledWith({
      customer_id: customers[1].id,
      qty_275: 12,
      qty_330: 4,
      pickup_date: '2026-08-20',
      address: '456 Oak Ave',
      notes: null,
    })
    // No status is ever sent from this form — transitions belong to
    // `updatePickupStatus` alone.
    expect(mockCreatePickup.mock.calls[0][0]).not.toHaveProperty('status')
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))
    expect(mockToast).toHaveBeenCalledWith('Pickup created.', 'success')
  })

  it('a server error renders in the alert region', async () => {
    mockCreatePickup.mockResolvedValueOnce({ error: 'That customer is inactive.' })
    const onSaved = vi.fn()
    renderForm({ lockedCustomerId: customers[0].id, onSaved })

    fireEvent.change(screen.getByLabelText(/275 gal totes/i), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /create pickup/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('That customer is inactive.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(mockToast).not.toHaveBeenCalled()
  })

  it('surfaces a transport-level rejection as the generic failure and logs context', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCreatePickup.mockRejectedValueOnce(new Error('offline'))
    renderForm({ lockedCustomerId: customers[0].id })

    fireEvent.change(screen.getByLabelText(/330 gal totes/i), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: /create pickup/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Something went wrong. Please try again.',
    )
    expect(consoleSpy).toHaveBeenCalledWith(
      'usePickupForm: submit failed',
      expect.objectContaining({ cause: expect.any(Error) }),
    )
    consoleSpy.mockRestore()
  })

  it('blocks submit with "At least one quantity is required." when both counts are empty', async () => {
    renderForm({ lockedCustomerId: customers[0].id })

    fireEvent.click(screen.getByRole('button', { name: /create pickup/i }))

    expect(await screen.findByTestId('pickup-qty-error')).toHaveTextContent(
      'At least one quantity is required.',
    )
    expect(mockCreatePickup).not.toHaveBeenCalled()
  })

  it('locks the customer field to a read-only display when lockedCustomerId is set', () => {
    renderForm({ lockedCustomerId: customers[0].id })

    expect(screen.getByLabelText(/customer \(pre-selected\)/i)).toHaveTextContent(
      'Acme Industrial',
    )
    expect(screen.queryByLabelText(/^Customer$/i)).toBeNull()
  })

  it('pre-fills every field in edit mode and updates through updatePickup', async () => {
    mockUpdatePickup.mockResolvedValueOnce({ success: true })
    renderForm({ mode: 'edit', initialDetail: sampleDetail })

    expect(screen.getByRole('heading', { name: /edit pickup/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/275 gal totes/i)).toHaveValue(12)
    // A stored zero renders blank rather than "0".
    expect(screen.getByLabelText(/330 gal totes/i)).toHaveValue(null)
    expect(screen.getByLabelText(/pickup date/i)).toHaveValue('2026-08-20')
    expect(screen.getByLabelText(/collection address/i)).toHaveValue('123 Main Street')
    expect(screen.getByLabelText(/^Notes$/i)).toHaveValue('Rear gate only.')

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await vi.waitFor(() => expect(mockUpdatePickup).toHaveBeenCalledTimes(1))
    expect(mockUpdatePickup).toHaveBeenCalledWith(sampleDetail.id, {
      customer_id: sampleDetail.customer_id,
      qty_275: 12,
      qty_330: 0,
      pickup_date: '2026-08-20',
      address: '123 Main Street',
      notes: 'Rear gate only.',
    })
    expect(mockToast).toHaveBeenCalledWith('Pickup updated.', 'success')
  })

  it('offers no status control and no delete control in either mode', () => {
    const { unmount } = renderForm()
    expect(screen.queryByLabelText(/status/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
    unmount()

    renderForm({ mode: 'edit', initialDetail: sampleDetail })
    expect(screen.queryByLabelText(/status/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
  })
})
