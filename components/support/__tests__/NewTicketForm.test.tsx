import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreateTicket = vi.hoisted(() => vi.fn())
const mockUploadTicketAttachment = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

// Mocking `@/db` here short-circuits the real `db/index.ts`, which would
// throw at import time when `DATABASE_URL` is unset (as in test env). The
// enum consts are duplicated — they're also exercised against the action's
// real export in `support.test.ts`, so drift is caught.
vi.mock('@/db', () => ({ db: {} }))
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({}) }))

vi.mock('@/lib/actions/support', () => ({
  createTicket: mockCreateTicket,
  uploadTicketAttachment: mockUploadTicketAttachment,
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

import NewTicketForm from '../NewTicketForm'

const TICKET_ID = '77777777-7777-7777-7777-777777777777'

function setFiles(input: HTMLElement, files: File[]) {
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  fireEvent.change(input)
}

function makePng(name = 'screenshot.png', sizeBytes = 1024): File {
  return new File([new Uint8Array(sizeBytes)], name, { type: 'image/png' })
}

function fillRequired() {
  fireEvent.change(screen.getByPlaceholderText(/short summary/i), {
    target: { value: 'Cannot save a new lead' },
  })
  fireEvent.change(screen.getByPlaceholderText(/steps to reproduce/i), {
    target: { value: 'Clicking Save Lead throws a 500.' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('NewTicketForm', () => {
  it('renders the "Log New Issue" heading and empty title field', () => {
    render(<NewTicketForm />)
    expect(screen.getByRole('heading', { name: /log new issue/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/short summary/i)).toHaveValue('')
  })

  it('surfaces the title-required error and does not call createTicket on empty submit', async () => {
    render(<NewTicketForm />)
    fireEvent.click(screen.getByRole('button', { name: /submit issue/i }))
    expect(await screen.findByText(/title is required/i)).toBeInTheDocument()
    expect(mockCreateTicket).not.toHaveBeenCalled()
  })

  it('surfaces the description-required error when only the title is filled', async () => {
    render(<NewTicketForm />)
    fireEvent.change(screen.getByPlaceholderText(/short summary/i), {
      target: { value: 'Title only' },
    })
    fireEvent.click(screen.getByRole('button', { name: /submit issue/i }))
    expect(await screen.findByText(/description is required/i)).toBeInTheDocument()
    expect(mockCreateTicket).not.toHaveBeenCalled()
  })

  it('calls createTicket with normalised values and fires a success toast on happy path', async () => {
    mockCreateTicket.mockResolvedValueOnce({ id: TICKET_ID })
    render(<NewTicketForm />)

    fillRequired()
    fireEvent.click(screen.getByRole('button', { name: /submit issue/i }))

    await vi.waitFor(() => expect(mockCreateTicket).toHaveBeenCalledTimes(1))
    const [arg] = mockCreateTicket.mock.calls[0]
    expect(arg).toMatchObject({
      title: 'Cannot save a new lead',
      description: 'Clicking Save Lead throws a 500.',
      category: 'bug',
      priority: 'standard',
    })
    await vi.waitFor(() => expect(mockToast).toHaveBeenCalledWith('Issue submitted.', 'success'))
    expect(screen.getByPlaceholderText(/short summary/i)).toHaveValue('')
  })

  it('surfaces the server error from createTicket and does not reset the form', async () => {
    mockCreateTicket.mockResolvedValueOnce({ error: 'Server rejected the request.' })
    render(<NewTicketForm />)

    fillRequired()
    fireEvent.click(screen.getByRole('button', { name: /submit issue/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/server rejected the request/i)
    expect(screen.getByPlaceholderText(/short summary/i)).toHaveValue('Cannot save a new lead')
  })

  it('rejects an oversized file before adding it to the selected list', () => {
    render(<NewTicketForm />)
    const input = screen.getByLabelText(/attach files/i)
    const bigFile = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.pdf', {
      type: 'application/pdf',
    })
    setFiles(input, [bigFile])
    expect(screen.getByRole('alert')).toHaveTextContent(/maximum 5mb per file/i)
    expect(screen.queryByText('big.pdf')).not.toBeInTheDocument()
  })

  it('rejects a disallowed MIME type', () => {
    render(<NewTicketForm />)
    const input = screen.getByLabelText(/attach files/i)
    const txtFile = new File(['hello'], 'note.txt', { type: 'text/plain' })
    setFiles(input, [txtFile])
    expect(screen.getByRole('alert')).toHaveTextContent(/only png, jpg, and pdf/i)
    expect(screen.queryByText('note.txt')).not.toBeInTheDocument()
  })

  it('caps selection at 3 files and surfaces a count error', () => {
    render(<NewTicketForm />)
    const input = screen.getByLabelText(/attach files/i)
    setFiles(input, [
      makePng('a.png'),
      makePng('b.png'),
      makePng('c.png'),
      makePng('d.png'),
    ])
    expect(screen.getByText('a.png')).toBeInTheDocument()
    expect(screen.getByText('b.png')).toBeInTheDocument()
    expect(screen.getByText('c.png')).toBeInTheDocument()
    expect(screen.queryByText('d.png')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(/maximum 3 attachments/i)
  })

  it('removes a selected file when the remove button is clicked', () => {
    render(<NewTicketForm />)
    const input = screen.getByLabelText(/attach files/i)
    setFiles(input, [makePng('a.png'), makePng('b.png')])
    fireEvent.click(screen.getByRole('button', { name: /remove a\.png/i }))
    expect(screen.queryByText('a.png')).not.toBeInTheDocument()
    expect(screen.getByText('b.png')).toBeInTheDocument()
  })

  it('calls uploadTicketAttachment per file and fires a success toast when all uploads succeed', async () => {
    mockCreateTicket.mockResolvedValueOnce({ id: TICKET_ID })
    mockUploadTicketAttachment
      .mockResolvedValueOnce({ path: `${TICKET_ID}/a` })
      .mockResolvedValueOnce({ path: `${TICKET_ID}/b` })

    render(<NewTicketForm />)
    fillRequired()
    const input = screen.getByLabelText(/attach files/i)
    setFiles(input, [makePng('a.png'), makePng('b.png')])

    fireEvent.click(screen.getByRole('button', { name: /submit issue/i }))

    await vi.waitFor(() => expect(mockUploadTicketAttachment).toHaveBeenCalledTimes(2))
    expect(mockUploadTicketAttachment.mock.calls[0][0]).toBe(TICKET_ID)
    expect(mockUploadTicketAttachment.mock.calls[0][1]).toBeInstanceOf(File)
    await vi.waitFor(() => expect(mockToast).toHaveBeenCalledWith('Issue submitted.', 'success'))
  })

  it('surfaces the partial-failure notice when an attachment fails to upload', async () => {
    mockCreateTicket.mockResolvedValueOnce({ id: TICKET_ID })
    mockUploadTicketAttachment
      .mockResolvedValueOnce({ path: `${TICKET_ID}/a` })
      .mockResolvedValueOnce({ error: 'Storage out of quota' })

    render(<NewTicketForm />)
    fillRequired()
    const input = screen.getByLabelText(/attach files/i)
    setFiles(input, [makePng('a.png'), makePng('b.png')])

    fireEvent.click(screen.getByRole('button', { name: /submit issue/i }))

    await vi.waitFor(() => expect(mockUploadTicketAttachment).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByText(/ticket submitted, but 1 attachment failed to upload/i),
    ).toBeInTheDocument()
  })
})
