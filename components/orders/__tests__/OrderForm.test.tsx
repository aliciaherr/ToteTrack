import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCreateOrder = vi.hoisted(() => vi.fn())
const mockUpdateOrder = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/orders', () => ({
  createOrder: mockCreateOrder,
  updateOrder: mockUpdateOrder,
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
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

import OrderForm from '../OrderForm'
import type { OrderDetail } from '@/db/queries/orders'
import type { CustomerSelectOption } from '@/db/queries/customers'

const customers: CustomerSelectOption[] = [
  { id: '22222222-2222-2222-2222-222222222222', company_name: 'Acme Industrial', default_delivery_address: null },
  { id: '33333333-3333-3333-3333-333333333333', company_name: 'Beta Co', default_delivery_address: null },
]

const sampleDetail: OrderDetail = {
  id: '44444444-4444-4444-4444-444444444444',
  po_number: 'PO-2001',
  customer_id: '22222222-2222-2222-2222-222222222222',
  customer_name: 'Acme Industrial',
  status: 'scheduled',
  container_size: '275',
  container_type: 'rebottled',
  quantity: 12,
  price: '300.00',
  pickup_only: false,
  delivery_address: '123 Main Street',
  requested_delivery_date: '2026-05-01',
  backhaul: true,
  document_url: null,
  notes: 'Deliver before noon.',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OrderForm', () => {
  it('renders "New Order" in create mode with an empty PO# field', () => {
    render(
      <OrderForm
        mode="create"
        customers={customers}
        lockedCustomerId={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { name: /new order/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/PO Number/i)).toHaveValue('')
  })

  it('pre-fills all fields in edit mode from the supplied OrderDetail', () => {
    render(
      <OrderForm
        mode="edit"
        initialDetail={sampleDetail}
        customers={customers}
        lockedCustomerId={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    expect(
      screen.getByRole('heading', { name: /edit PO-2001/i }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText(/PO Number/i)).toHaveValue('PO-2001')
    expect(screen.getByLabelText(/Quantity/i)).toHaveValue(12)
    expect(screen.getByLabelText(/^Delivery Address$/i)).toHaveValue('123 Main Street')
  })

  it('locks the customer field to a read-only display when lockedCustomerId is set', () => {
    render(
      <OrderForm
        mode="create"
        customers={customers}
        lockedCustomerId={customers[0].id}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    expect(
      screen.getByLabelText(/customer \(pre-selected\)/i),
    ).toHaveTextContent('Acme Industrial')
    expect(screen.queryByLabelText(/^Customer$/i)).toBeNull()
  })

  it('hides the delivery address field when pickup_only is toggled on', () => {
    render(
      <OrderForm
        mode="create"
        customers={customers}
        lockedCustomerId={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/^Delivery Address$/i)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/pickup only/i))
    expect(screen.queryByLabelText(/^Delivery Address$/i)).toBeNull()
  })

  it('blocks submit and surfaces the PO number error when empty', async () => {
    render(
      <OrderForm
        mode="create"
        customers={customers}
        lockedCustomerId={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /create order/i }))
    expect(await screen.findByText(/PO number is required/i)).toBeInTheDocument()
    expect(mockCreateOrder).not.toHaveBeenCalled()
  })

  it('passes a parsed payload to createOrder on valid submit', async () => {
    mockCreateOrder.mockResolvedValueOnce({ id: 'new-order-id' })
    const onSaved = vi.fn()
    render(
      <OrderForm
        mode="create"
        customers={customers}
        lockedCustomerId={customers[0].id}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    )
    fireEvent.change(screen.getByLabelText(/PO Number/i), {
      target: { value: 'PO-9999' },
    })
    fireEvent.change(screen.getByLabelText(/Quantity/i), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText(/Price/i), { target: { value: '199.50' } })
    fireEvent.change(screen.getByLabelText(/^Delivery Address$/i), {
      target: { value: '456 Oak Ave' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create order/i }))

    await vi.waitFor(() => {
      expect(mockCreateOrder).toHaveBeenCalledTimes(1)
    })
    const [arg] = mockCreateOrder.mock.calls[0]
    expect(arg).toMatchObject({
      po_number: 'PO-9999',
      customer_id: customers[0].id,
      quantity: 8,
      price: 199.5,
      pickup_only: false,
      delivery_address: '456 Oak Ave',
    })
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })
})
