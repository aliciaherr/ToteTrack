import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { forwardRef } from 'react'

const mockUpdateOrderStatus = vi.hoisted(() => vi.fn())
const mockRevertOrderToScheduled = vi.hoisted(() => vi.fn())

// The status block reaches two `'use server'` modules that import the postgres
// driver. Stubbed the same way `OrderStatusActions.test.tsx` does it — the
// status block itself, and both confirmation dialogs, are real.
vi.mock('@/lib/actions/orders', () => ({
  updateOrderStatus: mockUpdateOrderStatus,
}))

vi.mock('@/lib/actions/orders.revert', () => ({
  revertOrderToScheduled: mockRevertOrderToScheduled,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

vi.mock('framer-motion', () => ({
  useReducedMotion: () => false,
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  motion: {
    // `forwardRef`, not a plain function: the dialog attaches `panelRef` to its
    // panel and the focus trap is dead without it. A non-forwarding mock made
    // the focus tests pass against nothing.
    div: forwardRef<HTMLDivElement, any>(
      ({ children, initial, animate, exit, variants, transition, ...rest }, ref) => (
        <div ref={ref} {...rest}>
          {children}
        </div>
      ),
    ),
  },
}))

vi.mock('next/link', () => ({
  default: ({ href, children, className }: any) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

import ProductionCardDialog from '../ProductionCardDialog'
import type { CalendarOrderRow } from '@/db/queries/calendar'

const ORDER_ID = '11111111-1111-1111-1111-111111111111'

function makeRow(overrides: Partial<CalendarOrderRow> = {}): CalendarOrderRow {
  return {
    id: ORDER_ID,
    po_number: 'PO-1042',
    customer_id: '22222222-2222-2222-2222-222222222222',
    customer_name: 'Acme Industrial',
    status: 'scheduled',
    qty_275_recon: 12,
    qty_275_rebot: 0,
    qty_275_new: 0,
    qty_330_recon: 8,
    qty_330_rebot: 0,
    qty_330_new: 0,
    price: '4200.00',
    unit_price_275_recon: '350.00',
    unit_price_275_rebot: null,
    unit_price_275_new: null,
    unit_price_330_recon: '400.00',
    unit_price_330_rebot: null,
    unit_price_330_new: null,
    backhaul: false,
    notes: null,
    same_day_delivery: false,
    production_date: '2026-07-30',
    requested_delivery_date: '2026-07-31',
    production_sort_index: 0,
    ...overrides,
  }
}

let onClose: () => void
let onToggleBackhaul: (orderId: string, next: boolean) => Promise<void>
let onToggleSameDay: (orderId: string, next: boolean) => Promise<void>
let onRemove: (orderId: string) => Promise<void>

function renderDialog(row: CalendarOrderRow | null = makeRow(), open = true) {
  return render(
    <ProductionCardDialog
      open={open}
      row={row}
      onClose={onClose}
      onToggleBackhaul={onToggleBackhaul}
      onToggleSameDay={onToggleSameDay}
      onRemove={onRemove}
    />,
  )
}

/** The pill for one flag, by its accessible name. */
function pill(name: RegExp) {
  return screen.getByRole('switch', { name })
}

beforeEach(() => {
  vi.clearAllMocks()
  onClose = vi.fn()
  onToggleBackhaul = vi.fn(async () => {})
  onToggleSameDay = vi.fn(async () => {})
  onRemove = vi.fn(async () => {})
})

describe('ProductionCardDialog', () => {
  it('renders qty / $unit for priced cells', () => {
    renderDialog()

    expect(screen.getByText('12 / $350')).toBeInTheDocument()
    expect(screen.getByText('8 / $400')).toBeInTheDocument()
  })

  it('falls back to bare quantities when unit prices are null', () => {
    const { container } = renderDialog(
      makeRow({
        qty_275_recon: 12,
        qty_330_recon: 8,
        unit_price_275_recon: null,
        unit_price_330_recon: null,
        price: '0',
      }),
    )

    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(container.textContent).not.toContain('$null')
    expect(container.textContent).not.toContain('NaN')
  })

  it('shows the derived total with the shared currency formatter', () => {
    renderDialog(makeRow({ price: '4200.00' }))

    expect(screen.getByText('$4,200')).toBeInTheDocument()
  })

  it('same-day toggle calls the action with the next value', async () => {
    renderDialog(makeRow({ same_day_delivery: false }))

    fireEvent.click(pill(/same-day delivery/i))

    await waitFor(() => expect(onToggleSameDay).toHaveBeenCalledWith(ORDER_ID, true))
  })

  it('toggling off passes false', async () => {
    renderDialog(makeRow({ same_day_delivery: true }))

    fireEvent.click(pill(/same-day delivery/i))

    await waitFor(() => expect(onToggleSameDay).toHaveBeenCalledWith(ORDER_ID, false))
  })

  it('backhaul toggle calls its own action with the next value', async () => {
    renderDialog(makeRow({ backhaul: false }))

    fireEvent.click(pill(/backhaul/i))

    await waitFor(() => expect(onToggleBackhaul).toHaveBeenCalledWith(ORDER_ID, true))
    expect(onToggleSameDay).not.toHaveBeenCalled()
  })

  it('backhaul toggling off passes false', async () => {
    renderDialog(makeRow({ backhaul: true }))

    fireEvent.click(pill(/backhaul/i))

    await waitFor(() => expect(onToggleBackhaul).toHaveBeenCalledWith(ORDER_ID, false))
  })

  it('each pill reports the stored value, not a local guess', () => {
    renderDialog(makeRow({ backhaul: true, same_day_delivery: false }))

    expect(pill(/backhaul/i)).toHaveAttribute('aria-checked', 'true')
    expect(pill(/same-day delivery/i)).toHaveAttribute('aria-checked', 'false')
  })

  it('leaves the pill on its server value when the mutation is refused', async () => {
    // No optimistic UI (CONSTRAINT-02): the action reports the failure by toast
    // and the pill keeps showing what the database actually holds.
    onToggleSameDay = vi.fn(async () => {})
    renderDialog(makeRow({ same_day_delivery: false }))

    fireEvent.click(pill(/same-day delivery/i))

    await waitFor(() => expect(onToggleSameDay).toHaveBeenCalled())
    expect(pill(/same-day delivery/i)).toHaveAttribute('aria-checked', 'false')
  })

  it('renders backhaul once — as a pill, not also as a detail row', () => {
    renderDialog(makeRow({ backhaul: true }))

    expect(screen.getAllByRole('switch', { name: /backhaul/i })).toHaveLength(1)
    const details = screen.getByRole('region', { name: 'Order details' })
    expect(within(details).queryByText(/backhaul/i)).toBeNull()
  })

  it('remove calls clearProductionPlacement and closes', async () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: /remove from calendar/i }))

    await waitFor(() => expect(onRemove).toHaveBeenCalledWith(ORDER_ID))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('the two pills are the only writable fields', () => {
    renderDialog()

    // Two switches, and no text/number inputs, selects, or textareas at all —
    // order editing stays exclusive to the Orders tab (CONSTRAINT-19).
    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0)
    expect(screen.queryAllByRole('combobox')).toHaveLength(0)
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })

  it('links Open in Orders to the order deep link', () => {
    renderDialog()

    expect(screen.getByRole('link', { name: /open in orders/i })).toHaveAttribute(
      'href',
      `/orders?id=${ORDER_ID}`,
    )
  })

  it('shows both dates, labelled distinctly', () => {
    renderDialog(
      makeRow({ production_date: '2026-07-30', requested_delivery_date: '2026-07-31' }),
    )

    expect(screen.getByText('Production Date')).toBeInTheDocument()
    expect(screen.getByText('Requested Delivery')).toBeInTheDocument()
    expect(screen.getByText('Thu, Jul 30 2026')).toBeInTheDocument()
    expect(screen.getByText('Fri, Jul 31 2026')).toBeInTheDocument()
  })

  it('renders an em dash for a missing production date', () => {
    renderDialog(makeRow({ production_date: null }))

    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows notes when present and a placeholder when not', () => {
    const { unmount } = renderDialog(makeRow({ notes: 'Deliver to rear gate.' }))
    expect(screen.getByText('Deliver to rear gate.')).toBeInTheDocument()
    unmount()

    renderDialog(makeRow({ notes: null }))
    expect(screen.getByText('No notes.')).toBeInTheDocument()
  })

  it('closes on Escape', () => {
    renderDialog()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalled()
  })

  it('closes on a backdrop click but not on a panel click', () => {
    renderDialog()

    fireEvent.click(screen.getByTestId('production-card-dialog'))
    expect(onClose).not.toHaveBeenCalled()

    const backdrop = screen.getByRole('dialog')
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalled()
  })

  it('moves focus into the panel on open and restores it on close', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    expect(document.activeElement).toBe(trigger)

    const { unmount } = renderDialog()
    expect(screen.getByTestId('production-card-dialog').contains(document.activeElement)).toBe(
      true,
    )

    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it('keeps Tab inside the panel', () => {
    renderDialog()
    const panel = screen.getByTestId('production-card-dialog')
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])'),
    )
    const last = focusable[focusable.length - 1]

    last.focus()
    fireEvent.keyDown(window, { key: 'Tab' })

    expect(document.activeElement).toBe(focusable[0])
  })

  it('renders nothing when closed', () => {
    renderDialog(makeRow(), false)

    expect(screen.queryByTestId('production-card-dialog')).not.toBeInTheDocument()
  })

  it('renders nothing when there is no row', () => {
    renderDialog(null, true)

    expect(screen.queryByTestId('production-card-dialog')).not.toBeInTheDocument()
  })

  it('never leaves the dialog trapped when a mutation rejects', async () => {
    // Regression: `isBusy` was set without a `finally`, so a rejected mutation
    // left it true forever — buttons disabled, Escape ignored, backdrop click
    // gated. The dialog became impossible to close without reloading the page.
    //
    // The rejection is also *reported*: `useCalendarMutation` catches transport
    // failures for the real collaborator, so one reaching the dialog is a
    // broken contract, and the DOM handler discards the promise this returns.
    // Without the catch it would escape as an unhandled rejection — which,
    // under `vitest run`, fails the whole run from a passing test file.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let rejectToggle: (reason: Error) => void = () => {}
    onToggleSameDay = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectToggle = reject
        }),
    )
    renderDialog()

    const removeButton = screen.getByRole('button', { name: /remove from calendar/i })
    fireEvent.click(pill(/same-day delivery/i))

    // While the mutation is in flight the dialog is intentionally locked.
    await waitFor(() => expect(removeButton).toBeDisabled())

    await act(async () => {
      rejectToggle(new Error('action transport failed'))
      await Promise.resolve()
    })

    // …and must unlock again once it fails.
    await waitFor(() => expect(removeButton).not.toBeDisabled())
    expect(consoleError).toHaveBeenCalledWith(
      'ProductionCardDialog: same-day delivery toggle rejected',
      expect.objectContaining({ orderId: ORDER_ID, next: true }),
    )
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('logs and still closes when the remove mutation rejects', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    onRemove = vi.fn(async () => {
      throw new Error('action transport failed')
    })
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: /remove from calendar/i }))

    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        'ProductionCardDialog: remove rejected',
        expect.objectContaining({ orderId: ORDER_ID }),
      ),
    )
    expect(onClose).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

describe('ProductionCardDialog — status block', () => {
  it('offers Mark as Complete and Cancel Order below the pills on a scheduled order', () => {
    renderDialog(makeRow({ status: 'scheduled' }))

    const complete = screen.getByRole('button', { name: /mark as complete/i })
    expect(complete).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^cancel order$/i })).toBeInTheDocument()
    // Below the pill row, not above it.
    const position = pill(/backhaul/i).compareDocumentPosition(complete)
    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each(['completed', 'cancelled', 'invoiced'] as const)(
    'offers Revert to Scheduled on a %s order',
    (status) => {
      renderDialog(makeRow({ status }))

      expect(screen.getByRole('button', { name: /revert to scheduled/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /mark as complete/i })).toBeNull()
    },
  )

  it('closes the popup once the order is cancelled — the card leaves the calendar', async () => {
    mockUpdateOrderStatus.mockResolvedValueOnce({ success: true })
    renderDialog(makeRow({ status: 'scheduled' }))

    fireEvent.click(screen.getByRole('button', { name: /^cancel order$/i }))
    fireEvent.click(await screen.findByRole('button', { name: /yes, cancel/i }))

    await waitFor(() => expect(mockUpdateOrderStatus).toHaveBeenCalledWith(ORDER_ID, 'cancelled'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('Escape closes only the confirm dialog, then the popup', async () => {
    renderDialog(makeRow({ status: 'scheduled' }))
    fireEvent.click(screen.getByRole('button', { name: /^cancel order$/i }))
    expect(await screen.findByRole('button', { name: /yes, cancel/i })).toBeInTheDocument()

    // One keypress reaches both Escape listeners; only the confirm may act.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: /yes, cancel/i })).toBeNull()
    expect(screen.getByTestId('production-card-dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('hands focus back to the control that opened the confirm', async () => {
    renderDialog(makeRow({ status: 'scheduled' }))
    const trigger = screen.getByRole('button', { name: /^cancel order$/i })
    trigger.focus()
    fireEvent.click(trigger)

    // Focus is inside the confirm, on an element that is about to unmount —
    // without the hand-back it would land on <body> and the popup's tab ring
    // would have nothing to cycle.
    const confirm = await screen.findByRole('button', { name: /yes, cancel/i })
    confirm.focus()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('button', { name: /yes, cancel/i })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps Tab inside the confirm dialog while it is open', async () => {
    renderDialog(makeRow({ status: 'scheduled' }))
    fireEvent.click(screen.getByRole('button', { name: /^cancel order$/i }))
    const confirm = await screen.findByRole('button', { name: /yes, cancel/i })

    confirm.focus()
    fireEvent.keyDown(window, { key: 'Tab' })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: /keep order/i }))
  })
})
