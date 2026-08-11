import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUpdatePickupStatus = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/pickups', () => ({
  updatePickupStatus: mockUpdatePickupStatus,
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ toast: mockToast }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

import { PickupStatusBlock } from '../PickupDetailParts'
import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'
import type { PickupDetail, PickupStatus } from '@/db/queries/pickups'

const PICKUP_ID = '11111111-1111-1111-1111-111111111111'

function makeDetail(status: PickupStatus = 'scheduled'): PickupDetail {
  return {
    id: PICKUP_ID,
    customer_id: '22222222-2222-2222-2222-222222222222',
    customer_name: 'Northside Bottling',
    status,
    qty_275: 12,
    qty_330: 4,
    pickup_date: '2026-08-14',
    address: '500 Dock Road',
    notes: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// `useStatusTransition` is module-private, so it is exercised through the
// exported block that mounts it — the same surface the detail page renders.
describe('PickupStatusBlock — useStatusTransition', () => {
  it('offers Complete + Cancel on a scheduled pickup and Reopen on a terminal one', () => {
    const { unmount } = render(<PickupStatusBlock detail={makeDetail('scheduled')} />)
    expect(screen.getByRole('button', { name: /mark as complete/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel pickup/i })).toBeInTheDocument()
    unmount()

    render(<PickupStatusBlock detail={makeDetail('cancelled')} />)
    expect(screen.getByRole('button', { name: /reopen pickup/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /mark as complete/i })).toBeNull()
  })

  it('calls updatePickupStatus with the target status, toasts and refreshes on success', async () => {
    mockUpdatePickupStatus.mockResolvedValueOnce({ success: true })
    render(<PickupStatusBlock detail={makeDetail('scheduled')} />)

    fireEvent.click(screen.getByRole('button', { name: /mark as complete/i }))

    await vi.waitFor(() => expect(mockUpdatePickupStatus).toHaveBeenCalledTimes(1))
    // Assert the call, not just the rendering: the id and the target status are
    // the whole payload of this write path.
    expect(mockUpdatePickupStatus).toHaveBeenCalledWith(PICKUP_ID, 'completed')
    await vi.waitFor(() => expect(mockToast).toHaveBeenCalledWith('Pickup marked as complete.', 'success'))
    await vi.waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('sends the cancel transition from the destructive button', async () => {
    mockUpdatePickupStatus.mockResolvedValueOnce({ success: true })
    render(<PickupStatusBlock detail={makeDetail('scheduled')} />)

    fireEvent.click(screen.getByRole('button', { name: /cancel pickup/i }))

    await vi.waitFor(() =>
      expect(mockUpdatePickupStatus).toHaveBeenCalledWith(PICKUP_ID, 'cancelled'),
    )
    expect(mockToast).toHaveBeenCalledWith('Pickup cancelled.', 'success')
  })

  it('renders a server { error } in the alert region and does not toast or refresh', async () => {
    // A rejected business rule comes back as data, not a throw — it must reach
    // the salesperson verbatim rather than being replaced by the generic text.
    mockUpdatePickupStatus.mockResolvedValueOnce({ error: 'Pickup is already completed.' })
    render(<PickupStatusBlock detail={makeDetail('scheduled')} />)

    fireEvent.click(screen.getByRole('button', { name: /mark as complete/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Pickup is already completed.')
    expect(mockToast).not.toHaveBeenCalled()
    expect(mockRefresh).not.toHaveBeenCalled()
    // The buttons re-enable so the salesperson can retry (EH-01).
    expect(screen.getByRole('button', { name: /mark as complete/i })).toBeEnabled()
  })

  it('logs with context and surfaces the generic message when the action rejects in transit', async () => {
    // Offline, or a stale action id after a deploy: the rejection escapes the
    // action's own error channel entirely and would otherwise be silent (EH-02).
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockUpdatePickupStatus.mockRejectedValueOnce(new Error('network down'))
    render(<PickupStatusBlock detail={makeDetail('scheduled')} />)

    fireEvent.click(screen.getByRole('button', { name: /cancel pickup/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(GENERIC_FAILURE_MESSAGE)
    expect(mockUpdatePickupStatus).toHaveBeenCalledWith(PICKUP_ID, 'cancelled')
    expect(consoleError).toHaveBeenCalledWith(
      'PickupDetail: status transition failed',
      expect.objectContaining({
        operation: 'updatePickupStatus',
        pickupId: PICKUP_ID,
        target: 'cancelled',
        cause: expect.any(Error),
      }),
    )
    expect(mockToast).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('clears a previous error when the next attempt succeeds', async () => {
    mockUpdatePickupStatus.mockResolvedValueOnce({ error: 'Pickup is already completed.' })
    render(<PickupStatusBlock detail={makeDetail('scheduled')} />)

    fireEvent.click(screen.getByRole('button', { name: /mark as complete/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    mockUpdatePickupStatus.mockResolvedValueOnce({ success: true })
    fireEvent.click(screen.getByRole('button', { name: /mark as complete/i }))

    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})
