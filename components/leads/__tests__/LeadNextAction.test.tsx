import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockSetNextAction = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/leads', () => ({
  setNextAction: mockSetNextAction,
}))

import LeadNextAction from '../LeadNextAction'

const LEAD_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

const EMPTY_CURRENT = {
  next_follow_up_date: null,
  next_action_type: null,
}

beforeEach(() => {
  vi.clearAllMocks()
})

// The EH-01 test spies on `console.error`. Restoring only at the end of that
// test body would leave the spy installed if the test failed mid-way, silencing
// `console.error` for every test that runs after it in this file.
afterEach(() => {
  vi.restoreAllMocks()
})

describe('LeadNextAction', () => {
  it('pre-fills the date and action type from the current prop', () => {
    render(
      <LeadNextAction
        leadId={LEAD_ID}
        current={{ next_follow_up_date: '2026-05-20', next_action_type: 'email' }}
        onSaved={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/date/i)).toHaveValue('2026-05-20')
    expect(screen.getByLabelText(/action type/i)).toHaveValue('email')
  })

  it('blocks submission and shows a client error when the date is empty', () => {
    render(<LeadNextAction leadId={LEAD_ID} current={EMPTY_CURRENT} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /save reminder/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/please select a date/i)
    expect(mockSetNextAction).not.toHaveBeenCalled()
  })

  it('calls setNextAction with date, time, and actionType and fires onSaved on success', async () => {
    mockSetNextAction.mockResolvedValueOnce({ success: true })
    const onSaved = vi.fn()
    render(<LeadNextAction leadId={LEAD_ID} current={EMPTY_CURRENT} onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: '2026-06-01' } })
    fireEvent.change(screen.getByLabelText(/action type/i), { target: { value: 'visit' } })
    fireEvent.click(screen.getByRole('button', { name: /save reminder/i }))

    await vi.waitFor(() => {
      expect(mockSetNextAction).toHaveBeenCalledWith(LEAD_ID, {
        date: '2026-06-01',
        time: '09:00',
        actionType: 'visit',
      })
    })
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it('surfaces a server error inline without calling onSaved', async () => {
    mockSetNextAction.mockResolvedValueOnce({ error: 'Server rejected the reminder.' })
    const onSaved = vi.fn()
    render(<LeadNextAction leadId={LEAD_ID} current={EMPTY_CURRENT} onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: '2026-06-01' } })
    fireEvent.click(screen.getByRole('button', { name: /save reminder/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/server rejected the reminder/i)
    expect(onSaved).not.toHaveBeenCalled()
    // Regression guard for the EH-01 fix: the returned-`{ error }` path must
    // keep showing the server's own message, and `finally` must re-enable Save.
    expect(screen.getByRole('button', { name: /save reminder/i })).toBeEnabled()
  })

  // Before the try/catch in `runSave`, a transport-level rejection (offline,
  // stale action id after a deploy) escaped into a floating promise — the
  // onClick discards it — so `setIsSubmitting(false)` never ran: no alert and
  // Save Reminder stuck disabled with no recovery but a page reload.
  it('recovers with an inline error when setNextAction rejects in transit (EH-01)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSetNextAction.mockRejectedValueOnce(new Error('network down'))
    const onSaved = vi.fn()
    render(<LeadNextAction leadId={LEAD_ID} current={EMPTY_CURRENT} onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText(/date/i), { target: { value: '2026-06-01' } })
    fireEvent.click(screen.getByRole('button', { name: /save reminder/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(screen.getByRole('button', { name: /save reminder/i })).toBeEnabled()
    expect(onSaved).not.toHaveBeenCalled()
    // The cause must reach the console — never swallowed (EH-01). The message
    // wording is not the contract, so it is matched loosely; the context object
    // is, so it is matched explicitly. `afterEach` restores the spy.
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('setNextAction failed'),
      expect.objectContaining({ leadId: LEAD_ID, cause: expect.any(Error) }),
    )
  })
})
