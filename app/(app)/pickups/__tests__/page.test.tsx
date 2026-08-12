import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetPickups = vi.hoisted(() => vi.fn())
const mockGetPickupDetail = vi.hoisted(() => vi.fn())
const mockGetCustomers = vi.hoisted(() => vi.fn())

vi.mock('@/db/queries/pickups', () => ({
  getPickups: mockGetPickups,
  getPickupDetail: mockGetPickupDetail,
}))

vi.mock('@/db/queries/customers', () => ({
  getActiveCustomersForSelect: mockGetCustomers,
}))

vi.mock('@/components/shell/PageTransition', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/pickups/PickupLayout', () => ({
  default: ({
    status,
    search,
    selectedId,
    lockedCustomerId,
    initialMode,
  }: {
    status: string
    search: string
    selectedId: string | null
    lockedCustomerId: string | null
    initialMode: string
  }) => (
    <div
      data-testid="pickup-layout"
      data-status={status}
      data-search={search}
      data-selected-id={selectedId ?? ''}
      data-locked-customer-id={lockedCustomerId ?? ''}
      data-initial-mode={initialMode}
    />
  ),
}))

import PickupsPage from '../page'
import { PickupNotFoundError } from '@/lib/errors'

const VALID_UUID = '55555555-5555-5555-5555-555555555555'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetPickups.mockResolvedValue({ rows: [] })
  mockGetCustomers.mockResolvedValue([])
  mockGetPickupDetail.mockResolvedValue(null)
})

async function renderPage(searchParams: Record<string, string | undefined> = {}) {
  render(await PickupsPage({ searchParams: Promise.resolve(searchParams) }))
  return screen.getByTestId('pickup-layout')
}

describe('app/(app)/pickups/page — SEC-02 boundary validation', () => {
  it('falls back to the "all" filter for a status param outside the whitelist', async () => {
    // `?status=invoiced` is a real order status but not a pickup one. Forwarded
    // raw it would reach `AND p.status = $1`, Postgres could not cast it to the
    // `pickup_status` enum, and the route would 500 (T77-L02). It must be
    // dropped here instead.
    const layout = await renderPage({ status: 'invoiced' })

    expect(mockGetPickups).toHaveBeenCalledWith({ status: 'all', search: '' })
    expect(layout.getAttribute('data-status')).toBe('all')
  })

  it.each(["' OR 1=1 --", 'INVOICED', 'scheduled ', ''])(
    'rejects the hostile or malformed status %j down to "all"',
    async (status) => {
      await renderPage({ status })
      expect(mockGetPickups).toHaveBeenCalledWith({ status: 'all', search: '' })
    },
  )

  it('passes a whitelisted status straight through', async () => {
    const layout = await renderPage({ status: 'cancelled' })

    expect(mockGetPickups).toHaveBeenCalledWith({ status: 'cancelled', search: '' })
    expect(layout.getAttribute('data-status')).toBe('cancelled')
  })

  it('never calls getPickupDetail for a malformed uuid id param', async () => {
    // A non-UUID `?id=` would fail the `uuid` cast in `WHERE p.id = $1` and
    // 500 the route rather than showing "no selection".
    const layout = await renderPage({ id: 'not-a-uuid' })

    expect(mockGetPickupDetail).not.toHaveBeenCalled()
    expect(layout.getAttribute('data-selected-id')).toBe('')
  })

  it('drops a malformed customerId param instead of locking the form to it', async () => {
    const layout = await renderPage({ new: '1', customerId: '../../etc/passwd' })

    expect(layout.getAttribute('data-locked-customer-id')).toBe('')
    expect(layout.getAttribute('data-initial-mode')).toBe('new-pickup')
  })

  it('loads the detail for a well-formed uuid id param', async () => {
    mockGetPickupDetail.mockResolvedValueOnce({ id: VALID_UUID })
    const layout = await renderPage({ id: VALID_UUID })

    expect(mockGetPickupDetail).toHaveBeenCalledWith(VALID_UUID)
    expect(layout.getAttribute('data-selected-id')).toBe(VALID_UUID)
  })

  it('renders "no selection" rather than throwing when the id is valid but gone', async () => {
    mockGetPickupDetail.mockRejectedValueOnce(new PickupNotFoundError(VALID_UUID))

    await expect(renderPage({ id: VALID_UUID })).resolves.toBeDefined()
  })

  it('lets a non-not-found query failure bubble to the error boundary', async () => {
    mockGetPickupDetail.mockRejectedValueOnce(new Error('connection reset'))

    await expect(PickupsPage({ searchParams: Promise.resolve({ id: VALID_UUID }) })).rejects.toThrow(
      'connection reset',
    )
  })

  it('trims the search term before it reaches the query', async () => {
    await renderPage({ search: '  acme  ' })

    expect(mockGetPickups).toHaveBeenCalledWith({ status: 'all', search: 'acme' })
  })
})
