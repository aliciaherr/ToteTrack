import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { TicketDetail as TicketDetailType } from '@/db/queries/support'

const mockGetSignedUrl = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/support', () => ({
  getSupportAttachmentSignedUrl: mockGetSignedUrl,
}))

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
    ...rest
  }: {
    href: string
    children: React.ReactNode
    className?: string
    [key: string]: unknown
  }) => (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  ),
}))

import TicketDetail from '../TicketDetail'

const TICKET_ID = '44444444-4444-4444-4444-444444444444'
const ATTACHMENT_ID = '55555555-5555-5555-5555-555555555555'

function makeDetail(overrides: Partial<TicketDetailType> = {}): TicketDetailType {
  return {
    id: TICKET_ID,
    title: 'Cannot save a new lead',
    category: 'bug',
    priority: 'high',
    description: 'Clicking Save Lead throws a 500 from the server.',
    status: 'open',
    developer_notes: null,
    created_at: '2026-04-21T10:00:00Z',
    attachments: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TicketDetail', () => {
  it('renders the NotFoundState when detail is null', () => {
    render(<TicketDetail detail={null} backHref="/support" />)
    expect(screen.getByText(/ticket not found/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to issues/i })).toHaveAttribute('href', '/support')
  })

  it('renders title, category, priority, description, and status for a selected ticket', () => {
    render(
      <TicketDetail
        detail={makeDetail({
          title: 'Cannot save a new lead',
          category: 'bug',
          priority: 'critical',
          description: 'Clicking Save Lead throws a 500.',
          status: 'in_progress',
        })}
        backHref="/support"
      />,
    )
    expect(screen.getByRole('heading', { name: /cannot save a new lead/i })).toBeInTheDocument()
    expect(screen.getByText(/^bug$/i)).toBeInTheDocument()
    expect(screen.getByText(/^critical$/i)).toBeInTheDocument()
    expect(screen.getByText(/clicking save lead throws a 500\./i)).toBeInTheDocument()
    expect(screen.getByText(/^in progress$/i)).toBeInTheDocument()
  })

  it('renders the "No notes yet" placeholder when developer_notes is null', () => {
    render(<TicketDetail detail={makeDetail({ developer_notes: null })} backHref="/support" />)
    expect(screen.getByText(/no notes yet/i)).toBeInTheDocument()
  })

  it('renders the developer_notes content when present', () => {
    render(
      <TicketDetail
        detail={makeDetail({ developer_notes: 'Investigating — reproduced locally.' })}
        backHref="/support"
      />,
    )
    expect(screen.getByText(/investigating — reproduced locally\./i)).toBeInTheDocument()
  })

  it('renders the "No attachments." placeholder when the ticket has none', () => {
    render(<TicketDetail detail={makeDetail({ attachments: [] })} backHref="/support" />)
    expect(screen.getByText(/no attachments\./i)).toBeInTheDocument()
  })

  it('renders one clickable link per attachment, preserving the original filename', () => {
    render(
      <TicketDetail
        detail={makeDetail({
          attachments: [
            { id: ATTACHMENT_ID, file_name: 'one.png' },
            { id: '66666666-6666-6666-6666-666666666666', file_name: 'two.pdf' },
          ],
        })}
        backHref="/support"
      />,
    )
    expect(screen.getByText('one.png')).toBeInTheDocument()
    expect(screen.getByText('two.pdf')).toBeInTheDocument()
  })
})

describe('TicketDetail — attachment download flow', () => {
  const openSpy = vi.fn()
  const fakeTab = { location: { href: '' }, close: vi.fn() }

  beforeEach(() => {
    openSpy.mockReset()
    fakeTab.location.href = ''
    fakeTab.close.mockReset()
    // Stub window.open so we can assert it was called synchronously and
    // navigated after the signed-URL resolves.
    vi.stubGlobal(
      'open',
      openSpy.mockImplementation(() => fakeTab),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('opens a blank tab synchronously and navigates it to the signed URL on success', async () => {
    mockGetSignedUrl.mockResolvedValueOnce({
      url: 'https://example.supabase.co/signed/abc?token=xyz',
    })
    render(
      <TicketDetail
        detail={makeDetail({
          attachments: [{ id: ATTACHMENT_ID, file_name: 'screenshot.png' }],
        })}
        backHref="/support"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /screenshot\.png/i }))

    // Open happens synchronously before the await.
    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank')

    await waitFor(() => expect(mockGetSignedUrl).toHaveBeenCalledWith(ATTACHMENT_ID))
    await waitFor(() =>
      expect(fakeTab.location.href).toBe('https://example.supabase.co/signed/abc?token=xyz'),
    )
    expect(fakeTab.close).not.toHaveBeenCalled()
  })

  it('closes the blank tab and surfaces the server error when the action rejects', async () => {
    mockGetSignedUrl.mockResolvedValueOnce({ error: 'Attachment not found.' })
    render(
      <TicketDetail
        detail={makeDetail({
          attachments: [{ id: ATTACHMENT_ID, file_name: 'screenshot.png' }],
        })}
        backHref="/support"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /screenshot\.png/i }))

    await waitFor(() => expect(fakeTab.close).toHaveBeenCalledOnce())
    expect(await screen.findByRole('alert')).toHaveTextContent(/attachment not found/i)
  })

  it('shows the popup-blocked hint when window.open returns null', async () => {
    openSpy.mockImplementation(() => null)
    mockGetSignedUrl.mockResolvedValueOnce({ url: 'https://example.supabase.co/signed/abc' })
    render(
      <TicketDetail
        detail={makeDetail({
          attachments: [{ id: ATTACHMENT_ID, file_name: 'screenshot.png' }],
        })}
        backHref="/support"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /screenshot\.png/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/allow popups/i)
  })
})
