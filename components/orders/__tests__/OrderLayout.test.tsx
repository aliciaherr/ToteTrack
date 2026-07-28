import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('../OrderTable', () => ({
  default: () => <div data-testid="order-table" />,
}))

vi.mock('../OrderDetail', () => ({
  default: () => <div data-testid="order-detail" />,
}))

vi.mock('../OrderForm', () => ({
  default: ({ mode, lockedCustomerId }: { mode: 'create' | 'edit'; lockedCustomerId: string | null }) => (
    <div data-testid={`order-form-${mode}`} data-locked-customer-id={lockedCustomerId ?? ''} />
  ),
}))

vi.mock('@/components/shell/DetailDrawer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import OrderLayout from '../OrderLayout'

const baseProps = {
  orders: [],
  status: 'all' as const,
  search: '',
  selectedId: null,
  detail: null,
  customers: [],
}

describe('OrderLayout — ?new=1 deep-link regression', () => {
  it('opens the New Order form on mount when initialMode="new-order" without a lockedCustomerId', () => {
    render(
      <OrderLayout
        {...baseProps}
        initialMode="new-order"
        lockedCustomerId={null}
      />,
    )

    const form = screen.getByTestId('order-form-create')
    expect(form).toBeInTheDocument()
    expect(form.getAttribute('data-locked-customer-id')).toBe('')
    expect(screen.queryByTestId('order-detail')).not.toBeInTheDocument()
  })

  it('opens the New Order form with a lockedCustomerId when both ?new=1 and ?customerId=[uuid] are set', () => {
    render(
      <OrderLayout
        {...baseProps}
        initialMode="new-order"
        lockedCustomerId="33333333-3333-3333-3333-333333333333"
      />,
    )

    const form = screen.getByTestId('order-form-create')
    expect(form.getAttribute('data-locked-customer-id')).toBe(
      '33333333-3333-3333-3333-333333333333',
    )
  })
})
