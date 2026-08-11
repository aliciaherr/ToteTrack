import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetCustomers = vi.hoisted(() => vi.fn())
const mockGetCustomerDetail = vi.hoisted(() => vi.fn())
const mockGetCustomerOrders = vi.hoisted(() => vi.fn())
const mockGetCustomerVolumeOverview = vi.hoisted(() => vi.fn())
const mockGetCustomerPickups = vi.hoisted(() => vi.fn())

// Hoisted alongside the mocks — `vi.mock` factories run before module-scope
// consts are initialised, so a plain const here is a TDZ error.
const EMPTY_VOLUME_OVERVIEW = vi.hoisted(() => ({
  gal275: { rebottled: 0, reconditioned: 0, brandNew: 0, totalAvg: 0 },
  gal330: { rebottled: 0, reconditioned: 0, brandNew: 0, totalAvg: 0 },
}))

vi.mock('@/db/queries/customers', () => ({
  getCustomers: mockGetCustomers,
  getCustomerDetail: mockGetCustomerDetail,
  getCustomerOrders: mockGetCustomerOrders,
  getCustomerVolumeOverview: mockGetCustomerVolumeOverview,
  EMPTY_VOLUME_OVERVIEW,
}))

vi.mock('@/db/queries/pickups', () => ({
  getCustomerPickups: mockGetCustomerPickups,
}))

vi.mock('@/components/shell/PageTransition', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/customers/CustomerLayout', () => ({
  default: ({
    window,
    pickupWindow,
    pickups,
  }: {
    window: string
    pickupWindow: string
    pickups: unknown[]
  }) => (
    <div
      data-testid="customer-layout"
      data-window={window}
      data-pickup-window={pickupWindow}
      data-pickup-count={pickups.length}
    />
  ),
}))

import CustomersPage from '../page'

const VALID_UUID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCustomers.mockResolvedValue([])
  mockGetCustomerDetail.mockResolvedValue({ id: VALID_UUID })
  mockGetCustomerOrders.mockResolvedValue([])
  mockGetCustomerVolumeOverview.mockResolvedValue(EMPTY_VOLUME_OVERVIEW)
  mockGetCustomerPickups.mockResolvedValue([])
})

async function renderPage(
  searchParams: Record<string, string | string[] | undefined> = {},
) {
  render(await CustomersPage({ searchParams }))
  return screen.getByTestId('customer-layout')
}

describe('app/(app)/customers/page — ?pwindow= boundary validation', () => {
  it('passes a whitelisted pwindow straight through to getCustomerPickups', async () => {
    const layout = await renderPage({ id: VALID_UUID, pwindow: '1Y' })

    expect(mockGetCustomerPickups).toHaveBeenCalledWith(VALID_UUID, '1Y')
    expect(layout.getAttribute('data-pickup-window')).toBe('1Y')
  })

  it.each(["' OR 1=1 --", '1m', '2Y', '', 'YTD '])(
    'falls back to the default window for the un-whitelisted pwindow %j',
    async (pwindow) => {
      // SEC-02 — `db/queries/pickups.ts` does no validation at its own
      // boundary, so a raw param must never reach `computeWindowStartDate`.
      await renderPage({ id: VALID_UUID, pwindow })
      expect(mockGetCustomerPickups).toHaveBeenCalledWith(VALID_UUID, '1M')
    },
  )

  it('survives a repeated pwindow param arriving as an array', async () => {
    // Next.js hands `?pwindow=1M&pwindow=3M` through as `string[]`. A `?.trim()`
    // style guard would throw here — `?.` guards null, not the wrong type
    // (T78-L01). The whitelist check must simply reject it.
    const layout = await renderPage({ id: VALID_UUID, pwindow: ['1M', '3M'] })

    expect(mockGetCustomerPickups).toHaveBeenCalledWith(VALID_UUID, '1M')
    expect(layout.getAttribute('data-pickup-window')).toBe('1M')
  })

  it('keeps the two window params independent', async () => {
    const layout = await renderPage({ id: VALID_UUID, window: '6M', pwindow: '3M' })

    expect(mockGetCustomerOrders).toHaveBeenCalledWith(VALID_UUID, '6M')
    expect(mockGetCustomerPickups).toHaveBeenCalledWith(VALID_UUID, '3M')
    expect(layout.getAttribute('data-window')).toBe('6M')
    expect(layout.getAttribute('data-pickup-window')).toBe('3M')
  })

  it('never queries pickups when no customer is selected', async () => {
    const layout = await renderPage({ pwindow: '3M' })

    expect(mockGetCustomerPickups).not.toHaveBeenCalled()
    expect(layout.getAttribute('data-pickup-count')).toBe('0')
  })

  it('never queries pickups for a malformed uuid id param', async () => {
    await renderPage({ id: 'not-a-uuid', pwindow: '3M' })

    expect(mockGetCustomerPickups).not.toHaveBeenCalled()
  })
})
