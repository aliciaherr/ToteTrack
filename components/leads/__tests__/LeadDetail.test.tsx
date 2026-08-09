import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { LeadDetail as LeadDetailType } from '@/db/queries/leads'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

// `lib/actions/leads` value-imports `@/db` (postgres driver), which throws on a
// missing DATABASE_URL under jsdom. LeadNextAction and LeadNotesSection both
// render inside LeadDetail, so both actions have to be stubbed even though this
// file never exercises them.
vi.mock('@/lib/actions/leads', () => ({
  setNextAction: vi.fn(),
  addLeadNote: vi.fn(),
}))

import LeadDetail from '../LeadDetail'

function makeDetail(overrides: Partial<LeadDetailType> = {}): LeadDetailType {
  return {
    id: '99999999-9999-9999-9999-999999999999',
    name: 'Dana Reed',
    title: 'Yard Manager',
    company: 'Acme Industrial',
    email: 'dana@acme-industrial.test',
    phone: '(555) 010-2030',
    status: 'warm',
    lead_source: 'referral',
    next_follow_up_date: null,
    next_action_type: null,
    updated_at: '2026-05-20T12:00:00.000Z',
    ...overrides,
  }
}

function renderDetail(overrides: Partial<LeadDetailType> = {}) {
  render(<LeadDetail detail={makeDetail(overrides)} notes={[]} />)
}

describe('LeadDetail', () => {
  it('renders the lead name, company line, and engagement fields', () => {
    renderDetail()
    expect(screen.getByRole('heading', { name: /dana reed/i })).toBeInTheDocument()
    expect(screen.getByText(/yard manager · acme industrial/i)).toBeInTheDocument()
    expect(screen.getByText('referral')).toBeInTheDocument()
  })

  // These three are the regression guards for the contact-link work: reverting
  // either href to raw interpolation, or either guard to truthiness, has to fail
  // here. Before them, both reverts left the suite green.
  it('builds the Text href from the sanitized phone rather than the raw column', () => {
    renderDetail({ phone: '(555) 010-2030 ext 12 (Dana)' })
    expect(screen.getByRole('link', { name: 'Text Dana Reed' })).toHaveAttribute(
      'href',
      'sms:5550102030',
    )
  })

  it('percent-encodes a smuggled CC in the Email href instead of passing it live', () => {
    renderDetail({ email: 'dana@acme.test?cc=rival@competitor.test' })
    const link = screen.getByRole('link', { name: 'Email Dana Reed' })
    expect(link).toHaveAttribute('href', 'mailto:dana%40acme.test%3Fcc%3Drival@competitor.test')
    expect(link.getAttribute('href')).not.toContain('?cc=')
  })

  it('renders no contact buttons and no contact line for whitespace-only channels', () => {
    renderDetail({ email: '   ', phone: '  ' })
    expect(screen.queryByRole('link', { name: /^Text / })).toBeNull()
    expect(screen.queryByRole('link', { name: /^Email / })).toBeNull()
    // The display line is gated on the same check as the buttons, so a blank
    // column must not open a `<p>` holding an empty span either.
    expect(screen.queryByText('·')).toBeNull()
  })

  it('omits the Edit and Convert buttons when their callbacks are not supplied', () => {
    renderDetail()
    expect(screen.queryByRole('button', { name: /edit/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /convert/i })).toBeNull()
  })

  it('fires onEdit and onConvert when their buttons are pressed', () => {
    const onEdit = vi.fn()
    const onConvert = vi.fn()
    render(<LeadDetail detail={makeDetail()} notes={[]} onEdit={onEdit} onConvert={onConvert} />)
    screen.getByRole('button', { name: /^edit$/i }).click()
    screen.getByRole('button', { name: /^convert$/i }).click()
    expect(onEdit).toHaveBeenCalledOnce()
    expect(onConvert).toHaveBeenCalledOnce()
  })
})
