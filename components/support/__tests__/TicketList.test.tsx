import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TicketListRow } from '@/db/queries/support'

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

import TicketList from '../TicketList'

const TICKET_A = '77777777-7777-7777-7777-777777777777'
const TICKET_B = '88888888-8888-8888-8888-888888888888'

function makeTicket(overrides: Partial<TicketListRow> = {}): TicketListRow {
  return {
    id: TICKET_A,
    title: 'Cannot save a new lead',
    category: 'bug',
    priority: 'high',
    status: 'open',
    created_at: '2026-04-21T10:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('TicketList', () => {
  it('renders the empty-state message when no tickets exist', () => {
    render(<TicketList tickets={[]} selectedId={null} />)
    expect(screen.getByText(/no issues submitted yet/i)).toBeInTheDocument()
  })

  it('renders each ticket row with title, priority label, and status pill visible', () => {
    const tickets = [
      makeTicket({ id: TICKET_A, title: 'Cannot save a new lead', priority: 'critical', status: 'open' }),
      makeTicket({ id: TICKET_B, title: 'Volume chart is blank', priority: 'low', status: 'resolved' }),
    ]
    render(<TicketList tickets={tickets} selectedId={null} />)
    expect(screen.getByText('Cannot save a new lead')).toBeInTheDocument()
    expect(screen.getByText('Volume chart is blank')).toBeInTheDocument()
    expect(screen.getByText(/^critical$/i)).toBeInTheDocument()
    expect(screen.getByText(/^low$/i)).toBeInTheDocument()
    expect(screen.getByText(/^open$/i)).toBeInTheDocument()
    expect(screen.getByText(/^resolved$/i)).toBeInTheDocument()
  })

  it('marks the currently-selected ticket row with aria-current="page"', () => {
    const tickets = [
      makeTicket({ id: TICKET_A, title: 'First ticket' }),
      makeTicket({ id: TICKET_B, title: 'Second ticket' }),
    ]
    render(<TicketList tickets={tickets} selectedId={TICKET_A} />)
    const current = screen.getByRole('link', { current: 'page' })
    expect(current).toHaveTextContent(/first ticket/i)
  })

  it('builds row hrefs that point to /support with the ticket id', () => {
    const tickets = [makeTicket({ id: TICKET_A })]
    render(<TicketList tickets={tickets} selectedId={null} />)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe(`/support?id=${TICKET_A}`)
  })

  it('fires the onNew callback when the "+ New" button is clicked', () => {
    const onNew = vi.fn()
    render(<TicketList tickets={[]} selectedId={null} onNew={onNew} />)
    fireEvent.click(screen.getByRole('button', { name: /log new issue/i }))
    expect(onNew).toHaveBeenCalledOnce()
  })

  it('does not render the "+ New" button when onNew is not provided', () => {
    render(<TicketList tickets={[]} selectedId={null} />)
    expect(screen.queryByRole('button', { name: /log new issue/i })).not.toBeInTheDocument()
  })
})
