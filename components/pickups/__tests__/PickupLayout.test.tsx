import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('../PickupTable', () => ({
  default: () => <div data-testid="pickup-table" />,
}))

vi.mock('../PickupDetail', () => ({
  default: () => <div data-testid="pickup-detail" />,
}))

vi.mock('../PickupForm', () => ({
  default: ({
    mode,
    lockedCustomerId,
  }: {
    mode: 'create' | 'edit'
    lockedCustomerId: string | null
  }) => (
    <div data-testid={`pickup-form-${mode}`} data-locked-customer-id={lockedCustomerId ?? ''} />
  ),
}))

vi.mock('@/components/shell/DetailDrawer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import PickupLayout from '../PickupLayout'

const baseProps = {
  pickups: [],
  status: 'all' as const,
  search: '',
  selectedId: null,
  detail: null,
  customers: [],
}

describe('PickupLayout — ?new=1 / ?customerId= deep links', () => {
  it('opens the New Pickup form on mount when initialMode="new-pickup"', () => {
    render(<PickupLayout {...baseProps} initialMode="new-pickup" lockedCustomerId={null} />)

    const form = screen.getByTestId('pickup-form-create')
    expect(form).toBeInTheDocument()
    expect(form.getAttribute('data-locked-customer-id')).toBe('')
    expect(screen.queryByTestId('pickup-detail')).not.toBeInTheDocument()
  })

  it('passes the locked customer through when both ?new=1 and ?customerId=[uuid] are set', () => {
    render(
      <PickupLayout
        {...baseProps}
        initialMode="new-pickup"
        lockedCustomerId="33333333-3333-3333-3333-333333333333"
      />,
    )

    expect(
      screen.getByTestId('pickup-form-create').getAttribute('data-locked-customer-id'),
    ).toBe('33333333-3333-3333-3333-333333333333')
  })

  it('renders the detail panel, not the form, when initialMode="detail"', () => {
    render(<PickupLayout {...baseProps} initialMode="detail" lockedCustomerId={null} />)

    expect(screen.getByTestId('pickup-detail')).toBeInTheDocument()
    expect(screen.queryByTestId('pickup-form-create')).not.toBeInTheDocument()
  })

  it('sizes the two-panel grid against svh, never vh (CONSTRAINT-23)', () => {
    const { container } = render(
      <PickupLayout {...baseProps} initialMode="detail" lockedCustomerId={null} />,
    )

    const shell = container.firstElementChild as HTMLElement
    expect(shell.className).toContain('100svh')
    expect(shell.className).not.toMatch(/\b(h-screen|min-h-screen)\b/)
    expect(shell.className).not.toMatch(/\d+vh/)
  })
})
