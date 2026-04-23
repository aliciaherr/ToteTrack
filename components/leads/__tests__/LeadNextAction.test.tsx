import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

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
  })
})
