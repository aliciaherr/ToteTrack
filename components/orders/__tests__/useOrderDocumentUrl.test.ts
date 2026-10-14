import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/actions/order-document', () => ({
  getOrderDocumentUrl: vi.fn(),
}))

import { getOrderDocumentUrl } from '@/lib/actions/order-document'
import { RESIGN_AFTER_MS, useOrderDocumentUrl } from '../useOrderDocumentUrl'

const mockedGetUrl = vi.mocked(getOrderDocumentUrl)
const ORDER_A = '33333333-3333-3333-3333-333333333333'
const ORDER_B = '44444444-4444-4444-4444-444444444444'
const URL_1 = 'https://example.supabase.co/sign/a.pdf?token=1'
const URL_2 = 'https://example.supabase.co/sign/a.pdf?token=2'

/** Advances the fake clock by `ms`, flushing the sign replies it triggers. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

/** Fires `visibilitychange` with the page reported as visible. */
async function becomeVisible() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
  })
}

/** Renders the hook for `orderId` and lets the first sign land. */
async function mounted(orderId = ORDER_A) {
  const hook = renderHook(({ id }) => useOrderDocumentUrl(id), { initialProps: { id: orderId } })
  await advance(0)
  return hook
}

beforeEach(() => {
  vi.useFakeTimers()
  mockedGetUrl.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useOrderDocumentUrl — keeping the link fresh', () => {
  it('re-signs before the link expires, keeping the current link meanwhile', async () => {
    mockedGetUrl.mockResolvedValueOnce({ url: URL_1 })
    let resolveSecond: (value: { url: string }) => void = () => {}
    mockedGetUrl.mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)))
    const { result } = await mounted()
    expect(result.current.state).toEqual({ status: 'ready', url: URL_1 })

    await advance(RESIGN_AFTER_MS - 1)
    expect(mockedGetUrl).toHaveBeenCalledTimes(1)
    await advance(1)
    expect(mockedGetUrl).toHaveBeenCalledTimes(2)
    // No flash to loading while the re-sign is in flight.
    expect(result.current.state).toEqual({ status: 'ready', url: URL_1 })

    await act(async () => resolveSecond({ url: URL_2 }))
    expect(result.current.state).toEqual({ status: 'ready', url: URL_2 })
  })

  it('re-signs when the page becomes visible after the threshold (timers suspended in sleep)', async () => {
    mockedGetUrl.mockResolvedValueOnce({ url: URL_1 }).mockResolvedValueOnce({ url: URL_2 })
    const { result } = await mounted()

    // Simulate a sleep: wall clock moves on, the scheduled timer has not fired.
    vi.setSystemTime(Date.now() + RESIGN_AFTER_MS + 60_000)
    await becomeVisible()

    expect(mockedGetUrl).toHaveBeenCalledTimes(2)
    expect(result.current.state).toEqual({ status: 'ready', url: URL_2 })
  })

  it('does not re-sign on visibility while the link is still fresh', async () => {
    mockedGetUrl.mockResolvedValue({ url: URL_1 })
    await mounted()

    await advance(RESIGN_AFTER_MS / 2)
    await becomeVisible()

    expect(mockedGetUrl).toHaveBeenCalledTimes(1)
  })

  it('shows the error when a background re-sign fails', async () => {
    mockedGetUrl.mockResolvedValueOnce({ url: URL_1 }).mockResolvedValueOnce({ error: 'Could not open.' })
    const { result } = await mounted()

    await advance(RESIGN_AFTER_MS)

    expect(result.current.state).toEqual({ status: 'error', message: 'Could not open.' })
  })
})

describe('useOrderDocumentUrl — races and cleanup', () => {
  it('ignores a late reply for the previous order', async () => {
    let resolveA: (value: { url: string }) => void = () => {}
    mockedGetUrl.mockImplementation((id) =>
      id === ORDER_A ? new Promise((resolve) => (resolveA = resolve)) : Promise.resolve({ url: URL_2 }),
    )
    const { result, rerender } = await mounted(ORDER_A)

    rerender({ id: ORDER_B })
    await advance(0)
    expect(result.current.state).toEqual({ status: 'ready', url: URL_2 })

    await act(async () => resolveA({ url: URL_1 }))
    expect(result.current.state).toEqual({ status: 'ready', url: URL_2 })
  })

  it('clears the re-sign timer and the visibility listener on unmount', async () => {
    mockedGetUrl.mockResolvedValue({ url: URL_1 })
    const removeListener = vi.spyOn(document, 'removeEventListener')
    const { unmount } = await mounted()

    unmount()
    await advance(RESIGN_AFTER_MS * 2)

    expect(mockedGetUrl).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(removeListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
  })
})
