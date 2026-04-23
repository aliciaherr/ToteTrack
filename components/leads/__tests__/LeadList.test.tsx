import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LeadListRow } from '@/db/queries/leads'

const mockPush = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
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

import LeadList from '../LeadList'

function makeLead(overrides: Partial<LeadListRow> = {}): LeadListRow {
  return {
    id: '77777777-7777-7777-7777-777777777777',
    name: 'Alice Smith',
    company: 'Acme Corp',
    status: 'warm',
    next_follow_up_date: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LeadList', () => {
  it('renders the default empty state when no leads exist and no search is active', () => {
    render(<LeadList leads={[]} selectedId={null} status="all" search="" />)
    expect(screen.getByText(/no leads yet\. add your first lead/i)).toBeInTheDocument()
  })

  it('renders the search-specific empty state when no leads match the search term', () => {
    render(<LeadList leads={[]} selectedId={null} status="all" search="acme" />)
    expect(screen.getByText(/no leads match that search/i)).toBeInTheDocument()
  })

  it('renders each lead row with the name, company, and status badge visible', () => {
    const leads = [
      makeLead({
        id: '77777777-7777-7777-7777-777777777777',
        name: 'Alice Smith',
        company: 'Acme Corp',
        status: 'hot',
      }),
      makeLead({
        id: '88888888-8888-8888-8888-888888888888',
        name: 'Bob Jones',
        company: 'Globex',
        status: 'cold',
      }),
    ]
    render(<LeadList leads={leads} selectedId={null} status="all" search="" />)
    expect(screen.getByText('Alice Smith')).toBeInTheDocument()
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
    expect(screen.getByText('Bob Jones')).toBeInTheDocument()
    expect(screen.getByText('hot')).toBeInTheDocument()
    expect(screen.getByText('cold')).toBeInTheDocument()
  })

  it('marks the currently-selected lead row with aria-current="page"', () => {
    const selectedId = '77777777-7777-7777-7777-777777777777'
    const leads = [
      makeLead({ id: selectedId, name: 'Alice Smith' }),
      makeLead({ id: '88888888-8888-8888-8888-888888888888', name: 'Bob Jones' }),
    ]
    render(<LeadList leads={leads} selectedId={selectedId} status="all" search="" />)
    const current = screen.getByRole('link', { current: 'page' })
    expect(current).toHaveTextContent(/alice smith/i)
  })

  it('builds row hrefs that preserve the selected id, active status, and search term', () => {
    const leads = [makeLead({ id: '77777777-7777-7777-7777-777777777777' })]
    render(<LeadList leads={leads} selectedId={null} status="hot" search="acme" />)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe(
      '/leads?id=77777777-7777-7777-7777-777777777777&status=hot&search=acme',
    )
  })

  it('marks the tab matching the active status as aria-selected', () => {
    render(<LeadList leads={[]} selectedId={null} status="hot" search="" />)
    const hotTab = screen.getByRole('tab', { name: /hot/i })
    const coldTab = screen.getByRole('tab', { name: /cold/i })
    expect(hotTab).toHaveAttribute('aria-selected', 'true')
    expect(coldTab).toHaveAttribute('aria-selected', 'false')
  })

  it('navigates via the router when a status tab is clicked', () => {
    render(<LeadList leads={[]} selectedId={null} status="all" search="" />)
    fireEvent.click(screen.getByRole('tab', { name: /hot/i }))
    expect(mockPush).toHaveBeenCalledTimes(1)
    expect(mockPush.mock.calls[0][0]).toContain('status=hot')
  })

  it('fires the onNew callback when the "+ New" button is clicked', () => {
    const onNew = vi.fn()
    render(<LeadList leads={[]} selectedId={null} status="all" search="" onNew={onNew} />)
    fireEvent.click(screen.getByRole('button', { name: /add new lead/i }))
    expect(onNew).toHaveBeenCalledOnce()
  })
})
