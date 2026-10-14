import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetQueue = vi.hoisted(() => vi.fn())
const mockGetSource = vi.hoisted(() => vi.fn())
const mockGetFields = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/review', () => ({
  getReviewQueue: mockGetQueue,
  getReviewSource: mockGetSource,
  getReviewFields: mockGetFields,
}))

import { RESIGN_AFTER_MS } from '@/components/shared/signedUrlResign.constants'
import { useReviewQueue, type SourceState } from '../useReviewQueue'
import { CUSTOMERS, reviewFields } from './reviewFields.fixture'

const FIRST = '11111111-1111-1111-1111-111111111111'
const URL_1 = 'https://example.supabase.co/sign/a.pdf?token=1'
const URL_2 = 'https://example.supabase.co/sign/a.pdf?token=2'
const START = new Date('2026-10-14T09:00:00Z').getTime()

function pdf(url: string) {
  return { source: { kind: 'pdf', url } }
}

/** Reports the page as `state` and fires `visibilitychange`. */
async function pageBecomes(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

/** Renders the queue and records every source state it shows, to catch a loading flash. */
async function renderReady() {
  const seen: SourceState['status'][] = []
  const hook = renderHook(() => {
    const state = useReviewQueue()
    seen.push(state.source.status)
    return state
  })
  await waitFor(() => expect(hook.result.current.source.status).toBe('ready'))
  await waitFor(() => expect(hook.result.current.fields.status).toBe('ready'))
  seen.length = 0
  return { ...hook, seen }
}

beforeEach(() => {
  // Only the clock is faked: waitFor keeps its real timers.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(START)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockGetQueue.mockResolvedValue({ ids: [FIRST] })
  mockGetSource.mockResolvedValue(pdf(URL_1))
  mockGetFields.mockResolvedValue({ fields: reviewFields(), customers: CUSTOMERS })
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

describe('useReviewQueue re-signs a stale source when the page becomes visible', () => {
  it('reloads the PO on screen quietly: no loading state, the new link replaces the old', async () => {
    const { result, seen } = await renderReady()
    mockGetSource.mockResolvedValue(pdf(URL_2))

    vi.setSystemTime(START + RESIGN_AFTER_MS)
    await pageBecomes('visible')

    await waitFor(() => expect(result.current.source).toEqual({ status: 'ready', source: { kind: 'pdf', url: URL_2 } }))
    expect(mockGetSource).toHaveBeenCalledTimes(2)
    expect(mockGetSource).toHaveBeenLastCalledWith(FIRST)
    expect(seen).not.toContain('loading')
    expect(mockGetFields).toHaveBeenCalledOnce()
  })

  it('leaves a fresh link alone', async () => {
    await renderReady()

    vi.setSystemTime(START + RESIGN_AFTER_MS - 1)
    await pageBecomes('visible')

    expect(mockGetSource).toHaveBeenCalledOnce()
  })

  it('does nothing when the page is hidden', async () => {
    await renderReady()

    vi.setSystemTime(START + RESIGN_AFTER_MS * 2)
    await pageBecomes('hidden')

    expect(mockGetSource).toHaveBeenCalledOnce()
  })

  it('never re-signs a source with no link (email text)', async () => {
    mockGetSource.mockResolvedValue({ source: { kind: 'text', text: 'PO 4471', truncated: false } })
    await renderReady()

    vi.setSystemTime(START + RESIGN_AFTER_MS * 2)
    await pageBecomes('visible')

    expect(mockGetSource).toHaveBeenCalledOnce()
  })

  it('starts only one re-sign when the page wakes twice while it is in flight', async () => {
    await renderReady()
    let settle!: (value: unknown) => void
    mockGetSource.mockReturnValueOnce(new Promise((resolve) => (settle = resolve)))

    vi.setSystemTime(START + RESIGN_AFTER_MS)
    await pageBecomes('visible')
    await pageBecomes('visible')
    await act(async () => settle(pdf(URL_2)))

    expect(mockGetSource).toHaveBeenCalledTimes(2)
  })

  it('shows the error and Retry, and logs, when the re-sign fails', async () => {
    const { result } = await renderReady()
    mockGetSource.mockResolvedValue({ error: 'Something went wrong. Please try again.' })

    vi.setSystemTime(START + RESIGN_AFTER_MS)
    await pageBecomes('visible')

    await waitFor(() => expect(result.current.source.status).toBe('error'))
    expect(console.error).toHaveBeenCalledWith(
      'useReviewQueue: could not load the PO source',
      expect.objectContaining({ poId: FIRST, quiet: true }),
    )
  })

  it('stops listening once the overlay closes', async () => {
    const { unmount } = await renderReady()
    unmount()

    vi.setSystemTime(START + RESIGN_AFTER_MS)
    await pageBecomes('visible')

    expect(mockGetSource).toHaveBeenCalledOnce()
  })
})
