import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import OrderStatusActions from '../OrderStatusActions'

const mockUpdateOrderStatus = vi.hoisted(() => vi.fn())
const mockRevertOrderToScheduled = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/orders', () => ({
  updateOrderStatus: mockUpdateOrderStatus,
}))

vi.mock('@/lib/actions/orders.revert', () => ({
  revertOrderToScheduled: mockRevertOrderToScheduled,
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
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

const ORDER_ID = '33333333-3333-3333-3333-333333333333'
const PO_NUMBER = 'PO-2001'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OrderStatusActions', () => {
  it('renders "Mark as Complete" and "Cancel Order" for a scheduled order', () => {
    render(
      <OrderStatusActions
        orderId={ORDER_ID}
        poNumber={PO_NUMBER}
        currentStatus="scheduled"
      />,
    )
    expect(screen.getByRole('button', { name: /mark as complete/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel order/i })).toBeInTheDocument()
  })

  it('renders "Revert to Scheduled" for a completed order', () => {
    render(
      <OrderStatusActions
        orderId={ORDER_ID}
        poNumber={PO_NUMBER}
        currentStatus="completed"
      />,
    )
    expect(screen.getByRole('button', { name: /revert to scheduled/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mark as complete/i })).toBeNull()
  })

  it('renders "Revert to Scheduled" for a cancelled order', () => {
    render(
      <OrderStatusActions
        orderId={ORDER_ID}
        poNumber={PO_NUMBER}
        currentStatus="cancelled"
      />,
    )
    expect(screen.getByRole('button', { name: /revert to scheduled/i })).toBeInTheDocument()
  })

  it('renders "Revert to Scheduled" for an invoiced order', () => {
    render(
      <OrderStatusActions
        orderId={ORDER_ID}
        poNumber={PO_NUMBER}
        currentStatus="invoiced"
      />,
    )
    expect(screen.getByRole('button', { name: /revert to scheduled/i })).toBeInTheDocument()
  })

  it('invokes revertOrderToScheduled and notifies the parent when the user confirms the revert dialog', async () => {
    mockRevertOrderToScheduled.mockResolvedValueOnce({ success: true })
    const onStatusChange = vi.fn()
    render(
      <OrderStatusActions
        orderId={ORDER_ID}
        poNumber={PO_NUMBER}
        currentStatus="invoiced"
        onStatusChange={onStatusChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /revert to scheduled/i }))
    fireEvent.click(await screen.findByRole('button', { name: /yes, revert/i }))
    await vi.waitFor(() => {
      expect(mockRevertOrderToScheduled).toHaveBeenCalledWith(ORDER_ID)
    })
    await vi.waitFor(() => expect(onStatusChange).toHaveBeenCalledOnce())
  })

  it('invokes updateOrderStatus(completed) and notifies the parent on a successful advance', async () => {
    mockUpdateOrderStatus.mockResolvedValueOnce({ success: true })
    const onStatusChange = vi.fn()
    render(
      <OrderStatusActions
        orderId={ORDER_ID}
        poNumber={PO_NUMBER}
        currentStatus="scheduled"
        onStatusChange={onStatusChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /mark as complete/i }))
    await vi.waitFor(() => {
      expect(mockUpdateOrderStatus).toHaveBeenCalledWith(ORDER_ID, 'completed')
    })
    await vi.waitFor(() => expect(onStatusChange).toHaveBeenCalledOnce())
  })

  it('reports its confirm dialog opening and closing to a host that asks', () => {
    const onDialogOpenChange = vi.fn()
    render(
      <OrderStatusActions
        orderId={ORDER_ID}
        poNumber={PO_NUMBER}
        currentStatus="scheduled"
        onDialogOpenChange={onDialogOpenChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /cancel order/i }))
    expect(onDialogOpenChange).toHaveBeenLastCalledWith(true)

    fireEvent.click(screen.getByRole('button', { name: /keep order/i }))
    expect(onDialogOpenChange).toHaveBeenLastCalledWith(false)
  })

  it('reports the confirm closing after a successful confirmation too', async () => {
    mockRevertOrderToScheduled.mockResolvedValueOnce({ success: true })
    const onDialogOpenChange = vi.fn()
    render(
      <OrderStatusActions
        orderId={ORDER_ID}
        poNumber={PO_NUMBER}
        currentStatus="completed"
        onDialogOpenChange={onDialogOpenChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /revert to scheduled/i }))
    fireEvent.click(await screen.findByRole('button', { name: /yes, revert/i }))

    await vi.waitFor(() => expect(onDialogOpenChange).toHaveBeenLastCalledWith(false))
  })

  it('works unchanged when no host is listening — the Orders tab passes nothing', async () => {
    mockUpdateOrderStatus.mockResolvedValueOnce({ success: true })
    render(
      <OrderStatusActions orderId={ORDER_ID} poNumber={PO_NUMBER} currentStatus="scheduled" />,
    )

    fireEvent.click(screen.getByRole('button', { name: /cancel order/i }))
    fireEvent.click(await screen.findByRole('button', { name: /yes, cancel/i }))

    await vi.waitFor(() =>
      expect(mockUpdateOrderStatus).toHaveBeenCalledWith(ORDER_ID, 'cancelled'),
    )
  })

  it('surfaces a server error inline and does not notify the parent on failure', async () => {
    mockUpdateOrderStatus.mockResolvedValueOnce({ error: 'Something went wrong.' })
    const onStatusChange = vi.fn()
    render(
      <OrderStatusActions
        orderId={ORDER_ID}
        poNumber={PO_NUMBER}
        currentStatus="scheduled"
        onStatusChange={onStatusChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /mark as complete/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /something went wrong/i,
    )
    expect(onStatusChange).not.toHaveBeenCalled()
  })

  it('recovers the cancel dialog with a generic error when the action rejects in transit', async () => {
    // A rejection (offline, stale action id after a deploy) previously escaped
    // the confirm handler: isSubmitting stayed true forever, Escape and
    // backdrop-close are gated on it, and no message appeared — a wedged modal.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockUpdateOrderStatus.mockRejectedValueOnce(new Error('network down'))
    render(
      <OrderStatusActions orderId={ORDER_ID} poNumber={PO_NUMBER} currentStatus="scheduled" />,
    )
    fireEvent.click(screen.getByRole('button', { name: /cancel order/i }))
    fireEvent.click(await screen.findByRole('button', { name: /yes, cancel/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(screen.getByRole('button', { name: /yes, cancel/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /keep order/i })).toBeEnabled()
    consoleError.mockRestore()
  })

  it('recovers the revert dialog with a generic error when the action rejects in transit', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockRevertOrderToScheduled.mockRejectedValueOnce(new Error('stale action id'))
    render(
      <OrderStatusActions orderId={ORDER_ID} poNumber={PO_NUMBER} currentStatus="invoiced" />,
    )
    fireEvent.click(screen.getByRole('button', { name: /revert to scheduled/i }))
    fireEvent.click(await screen.findByRole('button', { name: /yes, revert/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(screen.getByRole('button', { name: /yes, revert/i })).toBeEnabled()
    consoleError.mockRestore()
  })

  it('shows a generic error and re-enables the buttons when mark-complete rejects in transit', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockUpdateOrderStatus.mockRejectedValueOnce(new Error('offline'))
    const onStatusChange = vi.fn()
    render(
      <OrderStatusActions
        orderId={ORDER_ID}
        poNumber={PO_NUMBER}
        currentStatus="scheduled"
        onStatusChange={onStatusChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /mark as complete/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(onStatusChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /mark as complete/i })).toBeEnabled()
    consoleError.mockRestore()
  })
})
