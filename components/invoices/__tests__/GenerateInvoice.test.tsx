import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { InvoiceableOrder } from '@/db/queries/invoices'

const mockPush = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())
const mockCreateInvoice = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

vi.mock('@/lib/actions/invoices', () => ({
  createInvoice: mockCreateInvoice,
  INVOICE_EXISTS_CODE: 'INVOICE_EXISTS',
}))

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: React.ReactNode }) => (
          <div {...rest}>{children}</div>
        ),
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
}))

import GenerateInvoice from '../GenerateInvoice'

function makeOrder(overrides: Partial<InvoiceableOrder> = {}): InvoiceableOrder {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    po_number: 'PO-3001',
    customer_id: '22222222-2222-2222-2222-222222222222',
    customer_name: 'Acme Industrial',
    qty_275_recon: 0,
    qty_275_rebot: 10,
    qty_275_new: 0,
    qty_330_recon: 0,
    qty_330_rebot: 0,
    qty_330_new: 0,
    price: '250.00',
    requested_delivery_date: '2026-04-10',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GenerateInvoice', () => {
  it('renders the empty state when no orders and hides Create Invoice', () => {
    render(<GenerateInvoice orders={[]} billingMonth="2026-04" />)
    expect(screen.getByText(/no completed orders for this period/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /create invoice/i })).not.toBeInTheDocument()
  })

  it('pre-checks every row and shows a draft total equal to the sum of all prices', () => {
    const orders = [
      makeOrder({ id: 'a', po_number: 'PO-3001', price: '250.00' }),
      makeOrder({ id: 'b', po_number: 'PO-3002', price: '125.50' }),
    ]
    render(<GenerateInvoice orders={orders} billingMonth="2026-04" />)
    const rowA = screen.getByRole('checkbox', { name: /include po-3001/i }) as HTMLInputElement
    const rowB = screen.getByRole('checkbox', { name: /include po-3002/i }) as HTMLInputElement
    expect(rowA.checked).toBe(true)
    expect(rowB.checked).toBe(true)
    expect(screen.getByLabelText('Draft total')).toHaveTextContent('$375.5')
  })

  it('recalculates the draft total when a row is unchecked', () => {
    const orders = [
      makeOrder({ id: 'a', po_number: 'PO-3001', price: '250.00' }),
      makeOrder({ id: 'b', po_number: 'PO-3002', price: '125.50' }),
    ]
    render(<GenerateInvoice orders={orders} billingMonth="2026-04" />)
    expect(screen.getByLabelText('Draft total')).toHaveTextContent('$375.5')
    fireEvent.click(screen.getByRole('checkbox', { name: /include po-3002/i }))
    expect(screen.getByLabelText('Draft total')).toHaveTextContent('$250')
  })

  it('navigates to the new billingMonth when the month picker changes', () => {
    render(<GenerateInvoice orders={[]} billingMonth="2026-04" />)
    fireEvent.change(screen.getByLabelText(/billing month/i), { target: { value: '2026-05' } })
    expect(mockPush).toHaveBeenCalledWith('/invoices?billingMonth=2026-05')
  })

  it('calls createInvoice with the billingMonth Date and checked orderIds', async () => {
    mockCreateInvoice.mockResolvedValueOnce({ id: 'new-inv', invoiceNumber: 'INV-0001' })
    const orders = [
      makeOrder({ id: 'a', po_number: 'PO-3001', price: '250.00' }),
      makeOrder({ id: 'b', po_number: 'PO-3002', price: '125.50' }),
    ]
    render(<GenerateInvoice orders={orders} billingMonth="2026-04" />)
    fireEvent.click(screen.getByRole('checkbox', { name: /include po-3002/i }))
    fireEvent.click(screen.getByRole('button', { name: /create invoice/i }))

    await vi.waitFor(() => expect(mockCreateInvoice).toHaveBeenCalledTimes(1))
    const [arg] = mockCreateInvoice.mock.calls[0]
    expect(arg.orderIds).toEqual(['a'])
    expect(arg.overwrite).toBe(false)
    expect(arg.billingMonth).toBeInstanceOf(Date)
    expect((arg.billingMonth as Date).getFullYear()).toBe(2026)
    expect((arg.billingMonth as Date).getMonth()).toBe(3)

    await vi.waitFor(() => expect(mockRefresh).toHaveBeenCalledOnce())
  })

  it('opens the overwrite dialog when createInvoice returns INVOICE_EXISTS, and re-calls with overwrite=true on confirm', async () => {
    mockCreateInvoice
      .mockResolvedValueOnce({ code: 'INVOICE_EXISTS', existingInvoiceNumber: 'INV-0042' })
      .mockResolvedValueOnce({ id: 'replacement', invoiceNumber: 'INV-0101' })

    const orders = [makeOrder({ id: 'a', po_number: 'PO-3001', price: '500.00' })]
    render(<GenerateInvoice orders={orders} billingMonth="2026-04" />)
    fireEvent.click(screen.getByRole('button', { name: /create invoice/i }))

    expect(await screen.findByText(/INV-0042 already covers this month/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /yes, overwrite/i }))

    await vi.waitFor(() => expect(mockCreateInvoice).toHaveBeenCalledTimes(2))
    const [, secondArgs] = mockCreateInvoice.mock.calls
    expect(secondArgs[0].overwrite).toBe(true)
    await vi.waitFor(() => expect(mockRefresh).toHaveBeenCalledOnce())
  })

  it('surfaces the server error inline when createInvoice rejects', async () => {
    mockCreateInvoice.mockResolvedValueOnce({ error: 'Order PO-3002 is already invoiced.' })
    const orders = [makeOrder({ id: 'a', po_number: 'PO-3001', price: '250.00' })]
    render(<GenerateInvoice orders={orders} billingMonth="2026-04" />)
    fireEvent.click(screen.getByRole('button', { name: /create invoice/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/already invoiced/i)
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('renders one row per order with PO number, customer name, and formatted price visible', () => {
    const orders = [
      makeOrder({ id: 'a', po_number: 'PO-3001', customer_name: 'Acme Industrial', price: '1250.00' }),
    ]
    render(<GenerateInvoice orders={orders} billingMonth="2026-04" />)
    const row = screen.getByRole('listitem')
    expect(within(row).getByText('PO-3001')).toBeInTheDocument()
    expect(within(row).getByText('Acme Industrial')).toBeInTheDocument()
    expect(within(row).getByText('$1,250')).toBeInTheDocument()
  })
})
