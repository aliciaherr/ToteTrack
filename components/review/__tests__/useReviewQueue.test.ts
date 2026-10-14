import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetQueue = vi.hoisted(() => vi.fn())
const mockGetSource = vi.hoisted(() => vi.fn())
const mockGetFields = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/review', () => ({
  getReviewQueue: mockGetQueue,
  getReviewSource: mockGetSource,
  getReviewFields: mockGetFields,
}))

import { useReviewQueue } from '../useReviewQueue'
import { CUSTOMERS, reviewFields } from './reviewFields.fixture'

const FIRST = '11111111-1111-1111-1111-111111111111'
const SECOND = '22222222-2222-2222-2222-222222222222'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockGetQueue.mockResolvedValue({ ids: [FIRST, SECOND] })
  mockGetSource.mockResolvedValue({ source: { kind: 'text', text: 'PO 4471' } })
  mockGetFields.mockResolvedValue({ fields: reviewFields(), customers: CUSTOMERS })
})

afterEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
})

async function renderReady() {
  const hook = renderHook(() => useReviewQueue())
  await waitFor(() => expect(hook.result.current.fields.status).toBe('ready'))
  return hook
}

describe('useReviewQueue advance', () => {
  it("reloads the queue and loads its new first row's source and fields", async () => {
    const { result } = await renderReady()
    mockGetQueue.mockResolvedValue({ ids: [SECOND] })

    act(() => result.current.advance())

    // The decided row's panes blank at once; the queue never drops to its own spinner.
    expect(result.current.fields.status).toBe('loading')
    expect(result.current.source.status).toBe('loading')
    expect(result.current.queue.status).toBe('ready')
    await waitFor(() => expect(result.current.queue).toEqual({ status: 'ready', ids: [SECOND] }))
    await waitFor(() => expect(result.current.fields.status).toBe('ready'))
    expect(mockGetQueue).toHaveBeenCalledTimes(2)
    expect(mockGetSource).toHaveBeenLastCalledWith(SECOND)
    expect(mockGetFields).toHaveBeenLastCalledWith(SECOND)
  })

  it('ends empty when the reloaded queue has nothing left', async () => {
    const { result } = await renderReady()
    mockGetQueue.mockResolvedValue({ ids: [] })

    act(() => result.current.advance())

    await waitFor(() => expect(result.current.queue.status).toBe('empty'))
    expect(mockGetSource).toHaveBeenCalledOnce()
  })

  it('shows the queue error, with its retry, when the reload fails', async () => {
    const { result } = await renderReady()
    mockGetQueue.mockResolvedValueOnce({ error: 'Something went wrong. Please try again.' })

    act(() => result.current.advance())

    await waitFor(() => expect(result.current.queue.status).toBe('error'))
    act(() => result.current.retry())
    await waitFor(() => expect(result.current.fields.status).toBe('ready'))
    expect(mockGetQueue).toHaveBeenCalledTimes(3)
  })
})
