import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LeadDetail } from '@/db/queries/leads'

const mockCreateLead = vi.hoisted(() => vi.fn())
const mockUpdateLead = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/leads', () => ({
  createLead: mockCreateLead,
  updateLead: mockUpdateLead,
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
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

import LeadForm from '../LeadForm'

const LEAD_ID = '66666666-6666-6666-6666-666666666666'

const sampleDetail: LeadDetail = {
  id: LEAD_ID,
  name: 'Alice Smith',
  title: 'Ops Manager',
  company: 'Acme Corp',
  email: 'alice@example.com',
  phone: null,
  status: 'hot',
  lead_source: 'Referral',
  next_follow_up_date: '2026-05-15',
  next_action_type: 'call',
  updated_at: '2026-04-18T12:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
})

// The EH-01 tests spy on `console.error`. Restoring only at the end of those
// test bodies would leave the spy installed if one failed mid-way, silencing
// `console.error` for every test that runs after it in this file.
afterEach(() => {
  vi.restoreAllMocks()
})

describe('LeadForm', () => {
  it('renders the "New Lead" heading and an empty name field in create mode', () => {
    render(<LeadForm mode="create" onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /new lead/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/full name/i)).toHaveValue('')
  })

  it('pre-fills existing fields when rendering in edit mode with a lead detail', () => {
    render(
      <LeadForm mode="edit" initialDetail={sampleDetail} onClose={vi.fn()} onSaved={vi.fn()} />,
    )
    expect(screen.getByRole('heading', { name: /edit alice smith/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/full name/i)).toHaveValue('Alice Smith')
    expect(screen.getByPlaceholderText(/company name/i)).toHaveValue('Acme Corp')
    expect(screen.getByPlaceholderText(/email@example\.com/i)).toHaveValue('alice@example.com')
  })

  it('surfaces the name-required error and does not call createLead on empty submit', async () => {
    render(<LeadForm mode="create" onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /save lead/i }))
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument()
    expect(mockCreateLead).not.toHaveBeenCalled()
  })

  it('submits a name-only lead (email and phone both optional)', async () => {
    mockCreateLead.mockResolvedValueOnce({ id: 'name-only-lead' })
    render(<LeadForm mode="create" onClose={vi.fn()} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/full name/i), {
      target: { value: 'Alice' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save lead/i }))
    await waitFor(() => expect(mockCreateLead).toHaveBeenCalledTimes(1))
  })

  it('passes a normalised payload to createLead and fires onSaved on success', async () => {
    mockCreateLead.mockResolvedValueOnce({ id: 'new-lead-id' })
    const onSaved = vi.fn()
    render(<LeadForm mode="create" onClose={vi.fn()} onSaved={onSaved} />)

    fireEvent.change(screen.getByPlaceholderText(/full name/i), { target: { value: 'Alice' } })
    fireEvent.change(screen.getByPlaceholderText(/email@example\.com/i), {
      target: { value: 'alice@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save lead/i }))

    await vi.waitFor(() => expect(mockCreateLead).toHaveBeenCalledTimes(1))
    const [arg] = mockCreateLead.mock.calls[0]
    expect(arg).toMatchObject({
      name: 'Alice',
      email: 'alice@example.com',
      phone: null,
      status: 'warm',
    })
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it('calls updateLead with the existing lead id when submitted in edit mode', async () => {
    mockUpdateLead.mockResolvedValueOnce({ success: true })
    const onSaved = vi.fn()
    render(
      <LeadForm
        mode="edit"
        initialDetail={sampleDetail}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /save lead/i }))
    await vi.waitFor(() => expect(mockUpdateLead).toHaveBeenCalledTimes(1))
    const [id] = mockUpdateLead.mock.calls[0]
    expect(id).toBe(LEAD_ID)
    expect(mockCreateLead).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it('surfaces a server error from createLead without calling onSaved', async () => {
    mockCreateLead.mockResolvedValueOnce({ error: 'Server rejected the request.' })
    const onSaved = vi.fn()
    render(<LeadForm mode="create" onClose={vi.fn()} onSaved={onSaved} />)

    fireEvent.change(screen.getByPlaceholderText(/full name/i), { target: { value: 'Alice' } })
    fireEvent.change(screen.getByPlaceholderText(/email@example\.com/i), {
      target: { value: 'alice@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save lead/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/server rejected the request/i)
    expect(onSaved).not.toHaveBeenCalled()
    // One submit must mean exactly one action call — a count-free
    // `toHaveBeenCalled` here would hide a double-fire on the failure path.
    expect(mockCreateLead).toHaveBeenCalledTimes(1)
    // Save Lead must come back for a retry: react-hook-form clears
    // `isSubmitting` once the handler settles.
    expect(screen.getByRole('button', { name: /save lead/i })).toBeEnabled()
  })

  // Before the try/catch in `runSave`, a transport-level rejection (offline,
  // stale action id after a deploy) escaped `handleSubmit` unhandled: nothing
  // logged, no alert, and — because react-hook-form still clears
  // `isSubmitting` — a Save Lead click that silently did nothing at all.
  it('surfaces a generic error when createLead rejects in transit (EH-01)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCreateLead.mockRejectedValueOnce(new Error('network down'))
    const onSaved = vi.fn()
    render(<LeadForm mode="create" onClose={vi.fn()} onSaved={onSaved} />)

    fireEvent.change(screen.getByPlaceholderText(/full name/i), { target: { value: 'Alice' } })
    fireEvent.click(screen.getByRole('button', { name: /save lead/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(onSaved).not.toHaveBeenCalled()
    expect(mockToast).not.toHaveBeenCalled()
    expect(mockCreateLead).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /save lead/i })).toBeEnabled()
    // The cause must reach the console — never swallowed (EH-01). The message
    // wording is not the contract, so it is matched loosely; the context object
    // is, so it is matched explicitly. `afterEach` restores the spy.
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('submit failed'),
      expect.objectContaining({ mode: 'create', leadId: null, cause: expect.any(Error) }),
    )
    expect(consoleError).toHaveBeenCalledTimes(1)
    // SEC-05: the log carries identifiers and the cause, never the lead's own
    // name, email or phone.
    const [, context] = consoleError.mock.calls[0]
    expect(JSON.stringify(context)).not.toMatch(/Alice/)
  })

  it('logs the lead id and surfaces a generic error when updateLead rejects (EH-01)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockUpdateLead.mockRejectedValueOnce(new Error('network down'))
    const onSaved = vi.fn()
    render(
      <LeadForm mode="edit" initialDetail={sampleDetail} onClose={vi.fn()} onSaved={onSaved} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /save lead/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(onSaved).not.toHaveBeenCalled()
    expect(mockUpdateLead).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('submit failed'),
      expect.objectContaining({ mode: 'edit', leadId: LEAD_ID, cause: expect.any(Error) }),
    )
  })

  // Regression, Task 85: `onClose` was declared, passed by both LeadLayout call
  // sites and never rendered — the form had no Cancel affordance at all, unlike
  // CustomerForm, OrderForm and PickupForm. Found via an unused-variable lint
  // warning, which was the symptom rather than the defect.
  it('closes without submitting when Cancel is clicked in create mode', () => {
    const onClose = vi.fn()
    const onSaved = vi.fn()
    render(<LeadForm mode="create" onClose={onClose} onSaved={onSaved} />)

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mockCreateLead).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('closes without submitting when Cancel is clicked in edit mode', () => {
    const onClose = vi.fn()
    render(<LeadForm mode="edit" initialDetail={sampleDetail} onClose={onClose} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mockUpdateLead).not.toHaveBeenCalled()
  })
})
