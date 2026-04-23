import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('../LeadList', () => ({
  default: () => <div data-testid="lead-list" />,
}))

vi.mock('../LeadDetail', () => ({
  default: () => <div data-testid="lead-detail" />,
  LeadDetailEmptyState: () => <div data-testid="lead-detail-empty" />,
}))

vi.mock('../LeadForm', () => ({
  default: ({ mode }: { mode: 'create' | 'edit' }) => (
    <div data-testid={`lead-form-${mode}`} />
  ),
}))

vi.mock('../ConvertLeadDialog', () => ({
  default: () => <div data-testid="convert-lead-dialog" />,
}))

vi.mock('@/components/shell/DetailDrawer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import LeadLayout from '../LeadLayout'
import type { LeadDetail } from '@/db/queries/leads'

const baseProps = {
  leads: [],
  selectedId: null,
  status: 'all' as const,
  search: '',
  detail: null,
  notes: [],
}

const sampleDetail: LeadDetail = {
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Jane Doe',
  title: null,
  company: null,
  email: 'jane@example.com',
  phone: null,
  status: 'warm',
  lead_source: null,
  next_follow_up_date: null,
  next_action_type: null,
  updated_at: '2026-04-23T00:00:00Z',
}

describe('LeadLayout — ?new=1 deep-link', () => {
  it('renders the empty-state detail panel by default (no initialMode)', () => {
    render(<LeadLayout {...baseProps} />)

    expect(screen.getByTestId('lead-detail-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('lead-form-create')).not.toBeInTheDocument()
  })

  it('opens the New Lead form on mount when initialMode="new-lead"', () => {
    render(<LeadLayout {...baseProps} initialMode="new-lead" />)

    expect(screen.getByTestId('lead-form-create')).toBeInTheDocument()
    expect(screen.queryByTestId('lead-detail')).not.toBeInTheDocument()
  })

  it('?new=1 takes precedence over ?id (form shown even when detail is populated)', () => {
    render(
      <LeadLayout
        {...baseProps}
        initialMode="new-lead"
        selectedId={sampleDetail.id}
        detail={sampleDetail}
      />,
    )

    expect(screen.getByTestId('lead-form-create')).toBeInTheDocument()
    expect(screen.queryByTestId('lead-detail')).not.toBeInTheDocument()
  })
})
