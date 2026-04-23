import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import NeedToContactWidget from '../NeedToContactWidget'
import type { NeedToContactRow } from '@/db/queries/dashboard'

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

const sampleRows: NeedToContactRow[] = [
  { id: 'cust-1', company_name: 'Acme Industrial', overdue_days: 14 },
  { id: 'cust-2', company_name: 'Beta Logistics', overdue_days: 3 },
  { id: 'cust-3', company_name: 'Gamma', overdue_days: 1 },
]

describe('NeedToContactWidget', () => {
  it('renders up to the provided rows with company name and overdue badge', () => {
    render(<NeedToContactWidget rows={sampleRows} />)
    expect(screen.getByText('Acme Industrial')).toBeInTheDocument()
    expect(screen.getByText('14 days overdue')).toBeInTheDocument()
    expect(screen.getByText('3 days overdue')).toBeInTheDocument()
    expect(screen.getByText('1 day overdue')).toBeInTheDocument()
  })

  it('links each row to the deep-link customer detail URL', () => {
    render(<NeedToContactWidget rows={sampleRows} />)
    const acmeLink = screen.getByText('Acme Industrial').closest('a')
    expect(acmeLink).toHaveAttribute('href', '/customers?id=cust-1')
  })

  it('renders the empty state when there are zero rows', () => {
    render(<NeedToContactWidget rows={[]} />)
    expect(screen.getByText(/no customers need contact right now/i)).toBeInTheDocument()
  })

  it('renders the "View all" link pointing to the need-to-contact sorted customers view', () => {
    render(<NeedToContactWidget rows={sampleRows} />)
    const viewAll = screen.getByText('View all')
    expect(viewAll.closest('a')).toHaveAttribute('href', '/customers?sort=need_to_contact')
  })
})
