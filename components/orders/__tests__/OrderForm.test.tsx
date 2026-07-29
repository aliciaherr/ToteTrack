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
  { id: '22222222-2222-2222-2222-222222222222', company_name: 'Acme Industrial', addresses: [] },
  { id: '33333333-3333-3333-3333-333333333333', company_name: 'Beta Co', addresses: [] },
]

// Feature 14 variant: Acme carries two saved addresses (MRU-first, as the
// query pre-sorts them); Beta still has none.
const customersWithAddresses: CustomerSelectOption[] = [
  {
    id: customers[0].id,
    company_name: 'Acme Industrial',
    addresses: [
      { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', address: '500 MRU Boulevard' },
      { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', address: '9 Older Lane' },
    ],
  },
  customers[1],
]

const sampleDetail: OrderDetail = {
  id: '44444444-4444-4444-4444-444444444444',
  po_number: 'PO-2001',
  customer_id: '22222222-2222-2222-2222-222222222222',
  customer_name: 'Acme Industrial',
  status: 'scheduled',
  qty_275_recon: 0,
  qty_275_rebot: 12,
  qty_275_new: 0,
  qty_330_recon: 0,
  qty_330_rebot: 0,
  qty_330_new: 5,
  // Feature 10: prices only on the two non-zero combos; qty-0 cells are null.
  // Derived total = 12 × 25 + 5 × 60 = 600.00.
  unit_price_275_recon: null,
  unit_price_275_rebot: '25.00',
  unit_price_275_new: null,
  unit_price_330_recon: null,
  unit_price_330_rebot: null,
  unit_price_330_new: '60.00',
  price: '600.00',
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

  it('renders the 2×3 quantity grid with 6 input cells in create mode', () => {
    render(
      <OrderForm
        mode="create"
        customers={customers}
        lockedCustomerId={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    const cells = [
      '275 gal Rebottled quantity',
      '275 gal Reconditioned quantity',
      '275 gal Brand New quantity',
      '330 gal Rebottled quantity',
      '330 gal Reconditioned quantity',
      '330 gal Brand New quantity',
    ]
    for (const label of cells) {
      expect(screen.getByLabelText(new RegExp(label, 'i'))).toBeInTheDocument()
    }
    expect(screen.getByLabelText(/Total Price/i)).toBeInTheDocument()
  })

  it('pre-fills all fields in edit mode from the supplied OrderDetail (6 qty cells + price + other fields)', () => {
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
    // Two non-zero cells from sampleDetail: 275 Rebottled = 12, 330 Brand New = 5.
    expect(screen.getByLabelText(/275 gal Rebottled quantity/i)).toHaveValue(12)
    expect(screen.getByLabelText(/330 gal Brand New quantity/i)).toHaveValue(5)
    // A zero cell renders as empty (placeholder "0").
    expect(screen.getByLabelText(/275 gal Reconditioned quantity/i)).toHaveValue(null)
    // Feature 14: the stored snapshot matches no saved address, so it shows
    // as the selected "Current:" option — displayed, never corrupted.
    expect(screen.getByLabelText(/^Delivery Address$/i)).toHaveDisplayValue(
      'Current: 123 Main Street',
    )
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

  it('renders the delivery address picker directly below the customer field', () => {
    render(
      <OrderForm
        mode="create"
        customers={customers}
        lockedCustomerId={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    // Builder-requested layout: customer → address, as one motion. The picker
    // sits after the customer dropdown and before the quantity grid.
    const customerField = screen.getByLabelText(/^Customer$/i)
    const addressField = screen.getByLabelText(/^Delivery Address$/i)
    const firstQtyCell = screen.getByLabelText(/275 gal Rebottled quantity/i)
    expect(
      customerField.compareDocumentPosition(addressField) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      addressField.compareDocumentPosition(firstQtyCell) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
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

  it('hides the saved-address dropdown too when pickup_only is toggled on (Feature 14 regression)', () => {
    render(
      <OrderForm
        mode="create"
        customers={customersWithAddresses}
        lockedCustomerId={customersWithAddresses[0].id}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    // Locked customer with saved addresses → the picker is the dropdown variant.
    expect(screen.getByLabelText(/^Delivery Address$/i)).toHaveDisplayValue('500 MRU Boulevard')
    fireEvent.click(screen.getByLabelText(/pickup only/i))
    expect(screen.queryByLabelText(/^Delivery Address$/i)).toBeNull()
  })

  it('resets the address selection when the customer changes', async () => {
    render(
      <OrderForm
        mode="create"
        customers={customersWithAddresses}
        lockedCustomerId={null}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    // Picking Acme pre-selects its MRU address in the dropdown — no typing.
    fireEvent.change(screen.getByLabelText(/^Customer$/i), {
      target: { value: customersWithAddresses[0].id },
    })
    expect(await screen.findByLabelText(/^Delivery Address$/i)).toHaveDisplayValue(
      '500 MRU Boulevard',
    )
    // Switching to Beta (no saved addresses) clears it back to an empty textarea.
    fireEvent.change(screen.getByLabelText(/^Customer$/i), {
      target: { value: customersWithAddresses[1].id },
    })
    const textarea = await screen.findByLabelText(/^Delivery Address$/i)
    expect(textarea.tagName).toBe('TEXTAREA')
    expect(textarea).toHaveValue('')
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

  it('blocks submit with "At least one quantity is required." when all 6 cells are zero', async () => {
    render(
      <OrderForm
        mode="create"
        customers={customers}
        lockedCustomerId={customers[0].id}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(/PO Number/i), { target: { value: 'PO-9999' } })
    fireEvent.change(screen.getByLabelText(/^Delivery Address$/i), {
      target: { value: '456 Oak Ave' },
    })
    // All 6 grid cells stay at 0 (default).
    fireEvent.click(screen.getByRole('button', { name: /create order/i }))
    const errorEl = await screen.findByTestId('qty-error', undefined, { timeout: 3000 })
    expect(errorEl).toHaveTextContent('At least one quantity is required.')
    expect(mockCreateOrder).not.toHaveBeenCalled()
  })

  it('passes a multi-combo payload to createOrder on valid submit', async () => {
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
    // Fill two combos: 275 Rebottled = 8 @ $25 and 330 Brand New = 3 @ $40.
    fireEvent.change(screen.getByLabelText(/275 gal Rebottled quantity/i), {
      target: { value: '8' },
    })
    fireEvent.change(screen.getByLabelText(/275 gal Rebottled unit price/i), {
      target: { value: '25' },
    })
    fireEvent.change(screen.getByLabelText(/330 gal Brand New quantity/i), {
      target: { value: '3' },
    })
    fireEvent.change(screen.getByLabelText(/330 gal Brand New unit price/i), {
      target: { value: '40' },
    })
    fireEvent.change(screen.getByLabelText(/^Delivery Address$/i), {
      target: { value: '456 Oak Ave' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create order/i }))

    await vi.waitFor(() => {
      expect(mockCreateOrder).toHaveBeenCalledTimes(1)
    })
    const [arg] = mockCreateOrder.mock.calls[0]
    // No `price` is sent — the server derives it. Client sends the 6 unit
    // prices, null on the empty combos.
    expect(arg).toMatchObject({
      po_number: 'PO-9999',
      customer_id: customers[0].id,
      qty_275_recon: 0,
      qty_275_rebot: 8,
      qty_275_new: 0,
      qty_330_recon: 0,
      qty_330_rebot: 0,
      qty_330_new: 3,
      unit_price_275_recon: null,
      unit_price_275_rebot: 25,
      unit_price_275_new: null,
      unit_price_330_recon: null,
      unit_price_330_rebot: null,
      unit_price_330_new: 40,
      pickup_only: false,
      delivery_address: '456 Oak Ave',
      // Typed fresh (no saved addresses) → no saved-address id rides along.
      delivery_address_id: null,
    })
    expect(arg).not.toHaveProperty('price')
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it('passes the new 6-qty payload to updateOrder when editing an existing PO', async () => {
    mockUpdateOrder.mockResolvedValueOnce({ success: true })
    const onSaved = vi.fn()
    render(
      <OrderForm
        mode="edit"
        initialDetail={sampleDetail}
        customers={customers}
        lockedCustomerId={null}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    )
    // Bump 275 Rebottled from 12 → 15.
    fireEvent.change(screen.getByLabelText(/275 gal Rebottled quantity/i), {
      target: { value: '15' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await vi.waitFor(() => {
      expect(mockUpdateOrder).toHaveBeenCalledTimes(1)
    })
    const [orderId, arg] = mockUpdateOrder.mock.calls[0]
    expect(orderId).toBe(sampleDetail.id)
    // Unit prices carry over from the prefilled detail (25 / 60); no `price`.
    expect(arg).toMatchObject({
      qty_275_recon: 0,
      qty_275_rebot: 15,
      qty_275_new: 0,
      qty_330_recon: 0,
      qty_330_rebot: 0,
      qty_330_new: 5,
      unit_price_275_rebot: 25,
      unit_price_330_new: 60,
    })
    expect(arg).not.toHaveProperty('price')
    // Edits keep snapshot semantics: the saved-address id never reaches
    // updateOrder (Feature 14 backfill happens only through createOrder).
    expect(arg).not.toHaveProperty('delivery_address_id')
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it('live-computes the read-only total as Σ(qty × unit price) as cells are filled', () => {
    render(
      <OrderForm
        mode="create"
        customers={customers}
        lockedCustomerId={customers[0].id}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    // Total starts at $0 with no quantities entered.
    expect(screen.getByLabelText(/Total Price/i)).toHaveTextContent('$0')
    // 275 Rebottled: 4 @ $10 = 40; 330 Brand New: 2 @ $5 = 10; Σ = $50.
    fireEvent.change(screen.getByLabelText(/275 gal Rebottled quantity/i), {
      target: { value: '4' },
    })
    fireEvent.change(screen.getByLabelText(/275 gal Rebottled unit price/i), {
      target: { value: '10' },
    })
    fireEvent.change(screen.getByLabelText(/330 gal Brand New quantity/i), {
      target: { value: '2' },
    })
    fireEvent.change(screen.getByLabelText(/330 gal Brand New unit price/i), {
      target: { value: '5' },
    })
    expect(screen.getByLabelText(/Total Price/i)).toHaveTextContent('$50')
  })

  it('pre-fills per-combo unit prices in edit mode from the supplied OrderDetail', () => {
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
    // The two non-zero combos carry their prices; a zero combo is blank.
    expect(screen.getByLabelText(/275 gal Rebottled unit price/i)).toHaveValue(25)
    expect(screen.getByLabelText(/330 gal Brand New unit price/i)).toHaveValue(60)
    expect(screen.getByLabelText(/275 gal Reconditioned unit price/i)).toHaveValue(null)
    // Derived total reflects the prefilled prices: 12 × 25 + 5 × 60 = $600.
    expect(screen.getByLabelText(/Total Price/i)).toHaveTextContent('$600')
  })

  it('blocks submit client-side when a combo has qty > 0 but a blank unit price', async () => {
    render(
      <OrderForm
        mode="create"
        customers={customers}
        lockedCustomerId={customers[0].id}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByLabelText(/PO Number/i), { target: { value: 'PO-9999' } })
    fireEvent.change(screen.getByLabelText(/^Delivery Address$/i), {
      target: { value: '456 Oak Ave' },
    })
    // Qty entered but unit price left blank — coupling violation.
    fireEvent.change(screen.getByLabelText(/275 gal Rebottled quantity/i), {
      target: { value: '5' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create order/i }))
    const errorEl = await screen.findByTestId('qty-error', undefined, { timeout: 3000 })
    expect(errorEl).toHaveTextContent(/Unit price for 275 gal Rebottled is required/i)
    expect(mockCreateOrder).not.toHaveBeenCalled()
  })

  it('shows a generic error when the submit action rejects in transit', async () => {
    // A rejected server action (offline, stale action id after a deploy) used
    // to escape react-hook-form's handleSubmit unseen — no message, the form
    // simply did nothing (EH-01).
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCreateOrder.mockRejectedValueOnce(new Error('network down'))
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
    fireEvent.change(screen.getByLabelText(/PO Number/i), { target: { value: 'PO-9999' } })
    fireEvent.change(screen.getByLabelText(/275 gal Rebottled quantity/i), {
      target: { value: '8' },
    })
    fireEvent.change(screen.getByLabelText(/275 gal Rebottled unit price/i), {
      target: { value: '25' },
    })
    fireEvent.change(screen.getByLabelText(/^Delivery Address$/i), {
      target: { value: '456 Oak Ave' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create order/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(onSaved).not.toHaveBeenCalled()
    // isSubmitting reset by react-hook-form — the salesperson can retry.
    expect(screen.getByRole('button', { name: /create order/i })).toBeEnabled()
    consoleError.mockRestore()
  })
})
