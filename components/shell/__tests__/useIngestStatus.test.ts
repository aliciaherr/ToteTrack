import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { IngestStatus } from '@/lib/actions/ingest'
import { INGEST_RUN_WATCH_MS, INGEST_STATUS_POLL_MS } from '@/lib/ingest/ingest-status.constants'

const mockGetIngestStatus = vi.hoisted(() => vi.fn())
const mockTriggerIngestion = vi.hoisted(() => vi.fn())
const mockToast = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/ingest', () => ({
  getIngestStatus: mockGetIngestStatus,
  triggerIngestion: mockTriggerIngestion,
}))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ toast: mockToast }) }))

import { useIngestStatus } from '../useIngestStatus'

const BEFORE_RUN = '2026-10-12T11:04:00.000Z'
const AFTER_RUN = '2026-10-12T19:31:00.000Z'

function statusOf(lastRunAt: string | null, toReview = 1): IngestStatus {
  return { toReview, beingRead: 0, lastRunAt, failingCount: 0 }
}

/** Renders the hook and lets the mount read land. */
async function mounted() {
  const hook = renderHook(() => useIngestStatus())
  await act(async () => {})
  return hook
}

/** Advances the poll clock by `ms`, flushing each read. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockGetIngestStatus.mockResolvedValue(statusOf(BEFORE_RUN))
  mockTriggerIngestion.mockResolvedValue({ accepted: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useIngestStatus — loading', () => {
  it('reads the status on mount', async () => {
    const { result } = await mounted()

    expect(result.current.status).toEqual(statusOf(BEFORE_RUN))
    expect(result.current.hasLoadError).toBe(false)
  })

  it('flags a failed read, from an error result or a rejected call', async () => {
    mockGetIngestStatus.mockResolvedValueOnce({ error: 'Something went wrong. Please try again.' })
    const { result } = await mounted()
    expect(result.current.hasLoadError).toBe(true)

    mockGetIngestStatus.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.hasLoadError).toBe(true)
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('could not load'), expect.anything())
  })
})

describe('useIngestStatus — check mail', () => {
  it('spins until the last run moves, then refreshes and confirms', async () => {
    const { result } = await mounted()
    mockGetIngestStatus.mockResolvedValueOnce(statusOf(BEFORE_RUN)).mockResolvedValue(statusOf(AFTER_RUN, 4))

    let check: Promise<void> = Promise.resolve()
    act(() => {
      check = result.current.checkMail()
    })
    expect(result.current.isChecking).toBe(true)

    await advance(INGEST_STATUS_POLL_MS)
    expect(result.current.isChecking).toBe(true)
    await advance(INGEST_STATUS_POLL_MS)
    await act(async () => {
      await check
    })

    expect(result.current.isChecking).toBe(false)
    expect(result.current.status?.lastRunAt).toBe(AFTER_RUN)
    expect(mockToast).toHaveBeenCalledWith('Mail checked. 4 pending.', 'success')
  })

  it('gives up with an error when the last run never moves', async () => {
    const { result } = await mounted()

    let check: Promise<void> = Promise.resolve()
    act(() => {
      check = result.current.checkMail()
    })
    await advance(INGEST_RUN_WATCH_MS + INGEST_STATUS_POLL_MS)
    await act(async () => {
      await check
    })

    expect(result.current.isChecking).toBe(false)
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("didn't finish"), 'error')
  })

  it('stops at once and shows the error when the trigger is refused', async () => {
    mockTriggerIngestion.mockResolvedValue({ error: 'You are not signed in.' })
    const { result } = await mounted()

    await act(async () => {
      await result.current.checkMail()
    })

    expect(result.current.isChecking).toBe(false)
    expect(mockToast).toHaveBeenCalledWith('You are not signed in.', 'error')
  })

  it('ignores a second tap while a check is in flight', async () => {
    const { result } = await mounted()

    act(() => {
      void result.current.checkMail()
      void result.current.checkMail()
    })
    await act(async () => {})

    expect(mockTriggerIngestion).toHaveBeenCalledTimes(1)
  })
})
