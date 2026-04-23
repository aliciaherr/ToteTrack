import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
})
