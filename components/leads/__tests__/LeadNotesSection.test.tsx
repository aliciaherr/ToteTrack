import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
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
    expect(textarea).toHaveValue('')
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
  })
})
