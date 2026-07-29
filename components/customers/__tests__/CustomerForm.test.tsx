import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import CustomerForm from '../CustomerForm'
import type { CustomerDetail } from '@/db/queries/customers'

const mockCreateCustomer = vi.hoisted(() => vi.fn())
const mockUpdateCustomer = vi.hoisted(() => vi.fn())
const mockDeleteCustomer = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/customers', () => ({
  createCustomer: mockCreateCustomer,
  updateCustomer: mockUpdateCustomer,
  deleteCustomer: mockDeleteCustomer,
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
        ({ children, ...rest }: { children?: React.ReactNode }) => <form {...rest}>{children}</form>,
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
}))

const sampleDetail: CustomerDetail = {
  id: '11111111-1111-1111-1111-111111111111',
  company_name: 'Acme Industrial',
  status: 'active',
  contact_frequency_days: null,
  auto_calculated_frequency_days: 14,
  effective_frequency_days: 14,
  notes: null,
  addresses: [],
  contacts: [
    {
      id: 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      name: 'Jane Doe',
      role: 'Operations Manager',
      email: 'jane@acme.example',
      phone: '555-0100',
      is_primary: true,
    },
  ],
  last_completed_date: '2026-04-01',
  completed_order_count: 4,
  overdue_days: -2,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CustomerForm', () => {
  it('renders "New Customer" in create mode with an empty company field', () => {
    render(
      <CustomerForm
        mode="create"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { name: /new customer/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/company name/i)).toHaveValue('')
  })

  it('pre-fills company name and primary contact in edit mode', () => {
    render(
      <CustomerForm
        mode="edit"
        initialDetail={sampleDetail}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { name: /edit acme industrial/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/company name/i)).toHaveValue('Acme Industrial')
    expect(screen.getByLabelText(/contact 1 name/i)).toHaveValue('Jane Doe')
  })

  it('blocks submit and surfaces the company name error when empty', async () => {
    render(
      <CustomerForm
        mode="create"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /create customer/i }))
    expect(await screen.findByText(/company name is required/i)).toBeInTheDocument()
    expect(mockCreateCustomer).not.toHaveBeenCalled()
  })

  it('submits a name-only contact (email and phone both optional)', async () => {
    mockCreateCustomer.mockResolvedValueOnce({ id: 'name-only-customer' })
    render(
      <CustomerForm
        mode="create"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(/company name/i), { target: { value: 'NewCo' } })
    fireEvent.change(screen.getByLabelText(/contact 1 name/i), { target: { value: 'Sam' } })
    fireEvent.click(screen.getByRole('button', { name: /create customer/i }))
    await waitFor(() => expect(mockCreateCustomer).toHaveBeenCalled())
  })

  it('renders no delivery-address textarea and omits the field from the submit payload (Feature 14)', async () => {
    mockCreateCustomer.mockResolvedValueOnce({ id: 'new-id' })
    render(
      <CustomerForm
        mode="create"
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onDeleted={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText(/delivery address/i)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/company name/i), { target: { value: 'NewCo' } })
    fireEvent.change(screen.getByLabelText(/contact 1 name/i), { target: { value: 'Sam' } })
    fireEvent.click(screen.getByRole('button', { name: /create customer/i }))

    await vi.waitFor(() => expect(mockCreateCustomer).toHaveBeenCalledTimes(1))
    const [arg] = mockCreateCustomer.mock.calls[0]
    expect(arg).not.toHaveProperty('default_delivery_address')
  })

  it('passes the form payload to createCustomer on valid submit', async () => {
    mockCreateCustomer.mockResolvedValueOnce({ id: 'new-id' })
    const onSaved = vi.fn()
    render(
      <CustomerForm
        mode="create"
        onClose={vi.fn()}
        onSaved={onSaved}
        onDeleted={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(/company name/i), { target: { value: 'NewCo' } })
    fireEvent.change(screen.getByLabelText(/contact 1 name/i), { target: { value: 'Sam' } })
    fireEvent.change(screen.getByLabelText(/contact 1 email/i), { target: { value: 'sam@newco.example' } })
    fireEvent.click(screen.getByRole('button', { name: /create customer/i }))

    await vi.waitFor(() => {
      expect(mockCreateCustomer).toHaveBeenCalledTimes(1)
    })
    const [arg] = mockCreateCustomer.mock.calls[0]
    expect(arg.company_name).toBe('NewCo')
    expect(arg.contacts).toHaveLength(1)
    expect(arg.contacts[0]).toMatchObject({
      name: 'Sam',
      email: 'sam@newco.example',
      phone: null,
      is_primary: true,
    })
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })
})
