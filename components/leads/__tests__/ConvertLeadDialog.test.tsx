import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockConvertLeadToCustomer = vi.hoisted(() => vi.fn())
const mockPush = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/leads', () => ({
  convertLeadToCustomer: mockConvertLeadToCustomer,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: React.ReactNode }) => (
          <div {...rest}>{children}</div>
        ),
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
}))

import ConvertLeadDialog from '../ConvertLeadDialog'

const LEAD_ID = '44444444-4444-4444-4444-444444444444'
const LEAD_NAME = 'Alice Smith'
const NEW_CUSTOMER_ID = '55555555-5555-5555-5555-555555555555'

beforeEach(() => {
  vi.clearAllMocks()
})

// The EH-01 test spies on `console.error`. Restoring only at the end of that
// test body would leave the spy installed if the test failed mid-way, silencing
// `console.error` for every test that runs after it in this file.
afterEach(() => {
  vi.restoreAllMocks()
})

describe('ConvertLeadDialog', () => {
  it('renders nothing when the dialog is closed', () => {
    render(
      <ConvertLeadDialog open={false} leadId={LEAD_ID} leadName={LEAD_NAME} onCancel={vi.fn()} />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the confirmation heading and action buttons when open', () => {
    render(
      <ConvertLeadDialog open={true} leadId={LEAD_ID} leadName={LEAD_NAME} onCancel={vi.fn()} />,
    )
    expect(
      screen.getByRole('heading', { name: /convert alice smith to a customer/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
  })

  it('redirects to the new customer detail view on successful conversion', async () => {
    mockConvertLeadToCustomer.mockResolvedValueOnce({ customerId: NEW_CUSTOMER_ID })
    render(
      <ConvertLeadDialog open={true} leadId={LEAD_ID} leadName={LEAD_NAME} onCancel={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await vi.waitFor(() => {
      expect(mockConvertLeadToCustomer).toHaveBeenCalledWith(LEAD_ID, false)
    })
    await vi.waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(`/customers?id=${NEW_CUSTOMER_ID}`)
    })
  })

  it('shows the duplicate-customer warning when the server returns { warning }', async () => {
    mockConvertLeadToCustomer.mockResolvedValueOnce({
      warning: 'A customer named "Acme Corp" already exists. Convert anyway?',
    })
    render(
      <ConvertLeadDialog open={true} leadId={LEAD_ID} leadName={LEAD_NAME} onCancel={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/acme corp/i)
    expect(screen.getByRole('button', { name: /convert anyway/i })).toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('re-submits with force=true when the user chooses "Convert Anyway"', async () => {
    mockConvertLeadToCustomer
      .mockResolvedValueOnce({ warning: 'Duplicate exists' })
      .mockResolvedValueOnce({ customerId: NEW_CUSTOMER_ID })
    render(
      <ConvertLeadDialog open={true} leadId={LEAD_ID} leadName={LEAD_NAME} onCancel={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    const forceButton = await screen.findByRole('button', { name: /convert anyway/i })
    fireEvent.click(forceButton)
    await vi.waitFor(() => {
      expect(mockConvertLeadToCustomer).toHaveBeenNthCalledWith(2, LEAD_ID, true)
    })
    await vi.waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith(`/customers?id=${NEW_CUSTOMER_ID}`)
    })
  })

  it('surfaces a server error inline when the action returns { error }', async () => {
    mockConvertLeadToCustomer.mockResolvedValueOnce({ error: 'Something went wrong.' })
    render(
      <ConvertLeadDialog open={true} leadId={LEAD_ID} leadName={LEAD_NAME} onCancel={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('disarms the force-convert button when the dialog is closed and reopened after a warning', async () => {
    // The confirm button is wired `onConfirm(Boolean(warning))`. If the
    // close-time reset regresses, reopening leaves it pre-armed to force —
    // the next confirm would silently skip the duplicate-customer gate.
    mockConvertLeadToCustomer.mockResolvedValueOnce({
      warning: 'A customer named "Acme Corp" already exists. Convert anyway?',
    })
    const props = { leadId: LEAD_ID, leadName: LEAD_NAME, onCancel: vi.fn() }
    const { rerender } = render(<ConvertLeadDialog open={true} {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/acme corp/i)
    expect(screen.getByRole('button', { name: /convert anyway/i })).toBeInTheDocument()

    rerender(<ConvertLeadDialog open={false} {...props} />)
    rerender(<ConvertLeadDialog open={true} {...props} />)

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /convert anyway/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument()
  })

  it('re-submits with force=false after a reopen, not the warning it was armed with', async () => {
    mockConvertLeadToCustomer
      .mockResolvedValueOnce({ warning: 'Duplicate exists' })
      .mockResolvedValueOnce({ customerId: NEW_CUSTOMER_ID })
    const props = { leadId: LEAD_ID, leadName: LEAD_NAME, onCancel: vi.fn() }
    const { rerender } = render(<ConvertLeadDialog open={true} {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await screen.findByRole('button', { name: /convert anyway/i })

    rerender(<ConvertLeadDialog open={false} {...props} />)
    rerender(<ConvertLeadDialog open={true} {...props} />)
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await vi.waitFor(() => {
      expect(mockConvertLeadToCustomer).toHaveBeenNthCalledWith(2, LEAD_ID, false)
    })
  })

  // Regression, EH-01. Found by @code-review 2026-08-16. This dialog calls the
  // server action directly — nothing wraps it — so before the `catch` in
  // `runConvert`, a transport-level rejection (offline, stale action id after a
  // deploy) escaped into a floating promise: no alert, `isSubmitting` stuck
  // true, and Cancel / Escape / backdrop-close are all gated on `isSubmitting`.
  // `LeadLayout` only clears `showConvertDialog` via `onCancel`, so the modal
  // was unclosable without a page reload.
  it('recovers with an inline error when convertLeadToCustomer rejects in transit (EH-01)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockConvertLeadToCustomer.mockRejectedValueOnce(new Error('network down'))
    render(
      <ConvertLeadDialog open={true} leadId={LEAD_ID} leadName={LEAD_NAME} onCancel={vi.fn()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(screen.getByRole('button', { name: /confirm/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeEnabled()
    expect(mockPush).not.toHaveBeenCalled()
    // The cause must reach the console — never swallowed (EH-01). The message
    // wording is not the contract, so it is matched loosely; the context object
    // is, so it is matched explicitly. `afterEach` restores the spy.
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('convert failed'),
      expect.objectContaining({ leadId: LEAD_ID, force: false, cause: expect.any(Error) }),
    )
  })
})
