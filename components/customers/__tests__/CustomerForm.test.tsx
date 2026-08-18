import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

// The EH-01 tests below spy on `console.error`. `clearAllMocks` resets call
// history but not the implementation, so without this the spy stays installed
// for every test that runs after them in this file — silencing the one signal
// a LOUD failure has left. Mirrors the guard in `LeadForm.test.tsx`.
afterEach(() => {
  vi.restoreAllMocks()
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

  // Regression guard for the EH-01 fix: wrapping the `await` in try/catch must
  // not intercept the returned-`{ error }` path — the server's own specific
  // message has to keep reaching the operator rather than being flattened to
  // the generic one.
  it('displays the error message returned by createCustomer', async () => {
    mockCreateCustomer.mockResolvedValueOnce({ error: 'A customer with that name already exists.' })
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
    fireEvent.click(screen.getByRole('button', { name: /create customer/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A customer with that name already exists.',
    )
    expect(mockCreateCustomer).toHaveBeenCalledTimes(1)
    expect(onSaved).not.toHaveBeenCalled()
    expect(mockToast).not.toHaveBeenCalled()
  })

  // BLOCKING-2: before the try/catch, a transport-level rejection (offline,
  // stale action id after a deploy) escaped `handleSubmit` as an unhandled
  // promise rejection. React Hook Form still cleared `isSubmitting`, so Save
  // Changes re-enabled itself with no message and nothing logged — the click
  // silently did nothing, which against the LOUD-failure standard is worse
  // than a stuck button.
  it('surfaces an inline error and logs context when updateCustomer rejects (EH-01)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockUpdateCustomer.mockRejectedValueOnce(new Error('network down'))
    const onSaved = vi.fn()
    render(
      <CustomerForm
        mode="edit"
        initialDetail={sampleDetail}
        onClose={vi.fn()}
        onSaved={onSaved}
        onDeleted={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled()
    expect(onSaved).not.toHaveBeenCalled()
    expect(mockUpdateCustomer).toHaveBeenCalledTimes(1)

    // The cause must reach the console with enough context to identify the
    // record — never swallowed (EH-02). The message wording is not the
    // contract, so it is matched loosely.
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('submit failed'),
      expect.objectContaining({
        mode: 'edit',
        customerId: sampleDetail.id,
        cause: expect.any(Error),
      }),
    )
    // SEC-01: identifiers only. No customer field *value* — company name,
    // contact name, email or phone — may reach the console or a log sink.
    // Asserted across every argument of every `console.error` call, not just
    // the one above, so any future log line in this handler is covered too.
    const logged = JSON.stringify(consoleError.mock.calls)
    expect(logged).not.toContain('Acme Industrial')
    expect(logged).not.toContain('Jane Doe')
    expect(logged).not.toContain('jane@acme.example')
    expect(logged).not.toContain('555-0100')
  })

  it('surfaces an inline error when createCustomer rejects in create mode (EH-01)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCreateCustomer.mockRejectedValueOnce(new Error('network down'))
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
    fireEvent.change(screen.getByLabelText(/contact 1 email/i), {
      target: { value: 'sam@newco.example' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create customer/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(onSaved).not.toHaveBeenCalled()
    expect(mockCreateCustomer).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledTimes(1)
    // `customerId` is null on create — the log still names which flow failed.
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('submit failed'),
      expect.objectContaining({ mode: 'create', customerId: null, cause: expect.any(Error) }),
    )
    const logged = JSON.stringify(consoleError.mock.calls)
    expect(logged).not.toContain('NewCo')
    expect(logged).not.toContain('sam@newco.example')
  })
})
