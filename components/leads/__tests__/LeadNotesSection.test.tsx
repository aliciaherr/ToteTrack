import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { LeadNote } from '@/db/queries/leads'

const mockAddLeadNote = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/leads', () => ({
  addLeadNote: mockAddLeadNote,
}))

import LeadNotesSection from '../LeadNotesSection'

const LEAD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

function makeNote(overrides: Partial<LeadNote> = {}): LeadNote {
  return {
    id: 'note-1',
    content: 'First note.',
    created_at: '2026-04-10T14:30:00Z',
    ...overrides,
  }
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

describe('LeadNotesSection', () => {
  it('renders the empty-state placeholder when the notes array is empty', () => {
    render(<LeadNotesSection leadId={LEAD_ID} notes={[]} onSaved={vi.fn()} />)
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument()
  })

  it('renders each existing note with its content visible', () => {
    const notes = [
      makeNote({ id: 'n1', content: 'First note body.' }),
      makeNote({ id: 'n2', content: 'Second note body.' }),
    ]
    render(<LeadNotesSection leadId={LEAD_ID} notes={notes} onSaved={vi.fn()} />)
    expect(screen.getByText('First note body.')).toBeInTheDocument()
    expect(screen.getByText('Second note body.')).toBeInTheDocument()
  })

  it('blocks submission and shows a client error when the textarea is empty', () => {
    render(<LeadNotesSection leadId={LEAD_ID} notes={[]} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /save note/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/note cannot be empty/i)
    expect(mockAddLeadNote).not.toHaveBeenCalled()
  })

  it('blocks submission when the textarea contains only whitespace', () => {
    render(<LeadNotesSection leadId={LEAD_ID} notes={[]} onSaved={vi.fn()} />)
    fireEvent.change(screen.getByLabelText(/new note content/i), {
      target: { value: '   \n  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save note/i }))
    expect(screen.getByRole('alert')).toHaveTextContent(/note cannot be empty/i)
    expect(mockAddLeadNote).not.toHaveBeenCalled()
  })

  it('calls addLeadNote with the trimmed content and fires onSaved on success', async () => {
    mockAddLeadNote.mockResolvedValueOnce({ id: 'new-note-id' })
    const onSaved = vi.fn()
    render(<LeadNotesSection leadId={LEAD_ID} notes={[]} onSaved={onSaved} />)

    const textarea = screen.getByLabelText(/new note content/i)
    fireEvent.change(textarea, { target: { value: 'A fresh note.' } })
    fireEvent.click(screen.getByRole('button', { name: /save note/i }))

    await vi.waitFor(() => {
      expect(mockAddLeadNote).toHaveBeenCalledWith(LEAD_ID, 'A fresh note.')
    })
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
    // Awaited rather than asserted inline: the component calls `setContent('')`
    // and `onSaved()` back to back after its await, and under React 19 the
    // `onSaved` mock records before React has flushed the re-render. React 18
    // happened to have flushed by this point. The expectation is unchanged —
    // the textarea still clears, one tick later than the old timing assumed.
    await vi.waitFor(() => expect(textarea).toHaveValue(''))
  })

  it('surfaces a server error inline without calling onSaved', async () => {
    mockAddLeadNote.mockResolvedValueOnce({ error: 'Server rejected the note.' })
    const onSaved = vi.fn()
    render(<LeadNotesSection leadId={LEAD_ID} notes={[]} onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText(/new note content/i), {
      target: { value: 'A fresh note.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save note/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/server rejected the note/i)
    expect(onSaved).not.toHaveBeenCalled()
    // Regression guard for the EH-01 fix: the returned-`{ error }` path must
    // keep showing the server's own message, and `finally` must re-enable Save.
    expect(screen.getByRole('button', { name: /save note/i })).toBeEnabled()
  })

  // Before the try/catch in `runAddNote`, a transport-level rejection (offline,
  // stale action id after a deploy) escaped into a floating promise — the
  // onClick discards it — so `setIsSubmitting(false)` never ran: no alert and
  // Save Note stuck disabled with no recovery but a page reload.
  it('recovers with an inline error when addLeadNote rejects in transit (EH-01)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockAddLeadNote.mockRejectedValueOnce(new Error('network down'))
    const onSaved = vi.fn()
    render(<LeadNotesSection leadId={LEAD_ID} notes={[]} onSaved={onSaved} />)

    const textarea = screen.getByLabelText(/new note content/i)
    fireEvent.change(textarea, { target: { value: 'A fresh note.' } })
    fireEvent.click(screen.getByRole('button', { name: /save note/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(screen.getByRole('button', { name: /save note/i })).toBeEnabled()
    expect(onSaved).not.toHaveBeenCalled()
    // Only the success branch clears the textarea: a failed save must not eat
    // the note the salesperson typed.
    expect(textarea).toHaveValue('A fresh note.')
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('addLeadNote failed'),
      expect.objectContaining({ leadId: LEAD_ID, cause: expect.any(Error) }),
    )
  })
})
