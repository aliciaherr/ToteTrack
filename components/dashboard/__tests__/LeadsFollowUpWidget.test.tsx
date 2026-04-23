import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import LeadsFollowUpWidget from '../LeadsFollowUpWidget'
import type { LeadFollowUpRow } from '@/db/queries/dashboard'

vi.mock('next/link', () => ({
  default: ({ href, children, className }: {
    href: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

const sampleRows: LeadFollowUpRow[] = [
  {
    id: 'l-1',
    name: 'Alice Smith',
    company: 'Acme Corp',
    next_follow_up_date: '2026-04-15',
    overdue_days: 7,
  },
  {
    id: 'l-2',
    name: 'Bob Jones',
    company: null,
    next_follow_up_date: '2026-04-22',
    overdue_days: 0,
  },
]

describe('LeadsFollowUpWidget', () => {
  it('renders each row with name and company and the overdue days badge', () => {
    render(<LeadsFollowUpWidget rows={sampleRows} />)
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    expect(screen.getByText('7 days overdue')).toBeInTheDocument()
  })

  it('renders "Due today" instead of an overdue count when overdue_days is 0', () => {
    render(<LeadsFollowUpWidget rows={sampleRows} />)
    expect(screen.getByText(/due today/i)).toBeInTheDocument()
  })

  it('links each row to the lead detail deep-link', () => {
    render(<LeadsFollowUpWidget rows={sampleRows} />)
    const link = screen.getByText('Alice Smith').closest('a')
    expect(link).toHaveAttribute('href', '/leads?id=l-1')
  })

  it('renders the empty state when rows is empty', () => {
    render(<LeadsFollowUpWidget rows={[]} />)
    expect(screen.getByText(/no leads to follow up on/i)).toBeInTheDocument()
  })

  it('renders the "View all" link to the leads list', () => {
    render(<LeadsFollowUpWidget rows={sampleRows} />)
    const viewAll = screen.getByText('View all').closest('a')
    expect(viewAll).toHaveAttribute('href', '/leads')
  })
})
