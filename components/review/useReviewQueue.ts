'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getReviewQueue, getReviewSource } from '@/lib/actions/review'
import type { ReviewSource } from '@/lib/review/review-source'

/**
 * The review overlay's data (Task 106): the queue, loaded on open, and the
 * source of the row on screen. Only the first row for now; next and skip
 * arrive with Tasks 108 and 109.
 */

export type QueueState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'empty' }
  | { status: 'ready'; ids: string[] }

export type SourceState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; source: ReviewSource }

export interface ReviewQueueState {
  queue: QueueState
  source: SourceState
  /** Reloads whatever failed: the queue, or the current row's source. */
  retry: () => void
  /** The document loaded a URL but the browser could not draw it. */
  markSourceFailed: () => void
}

/** Loads the queue on mount and the first row's source after it. */
export function useReviewQueue(): ReviewQueueState {
  const [queue, setQueue] = useState<QueueState>({ status: 'loading' })
  const [source, setSource] = useState<SourceState>({ status: 'loading' })
  const isMountedRef = useRef(true)

  const loadSource = useCallback(async (poId: string) => {
    setSource({ status: 'loading' })
    try {
      const result = await getReviewSource(poId)
      if (!isMountedRef.current) return
      if ('error' in result) throw new Error(result.error)
      setSource({ status: 'ready', source: result.source })
    } catch (cause) {
      // The server logged its own cause; this covers a transport failure too (EH-01).
      console.error('useReviewQueue: could not load the PO source', { poId, cause })
      if (isMountedRef.current) setSource({ status: 'error' })
    }
  }, [])

  const loadQueue = useCallback(async () => {
    setQueue({ status: 'loading' })
    try {
      const result = await getReviewQueue()
      if (!isMountedRef.current) return
      if ('error' in result) throw new Error(result.error)
      if (result.ids.length === 0) {
        setQueue({ status: 'empty' })
        return
      }
      setQueue({ status: 'ready', ids: result.ids })
      await loadSource(result.ids[0])
    } catch (cause) {
      console.error('useReviewQueue: could not load the review queue', { cause })
      if (isMountedRef.current) setQueue({ status: 'error' })
    }
  }, [loadSource])

  useEffect(() => {
    isMountedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the open read is the subscription to server state this effect exists for; state is set only after awaiting the action.
    void loadQueue()
    return () => {
      isMountedRef.current = false
    }
  }, [loadQueue])

  const retry = useCallback(() => {
    if (queue.status === 'ready') void loadSource(queue.ids[0])
    else void loadQueue()
  }, [queue, loadQueue, loadSource])

  const markSourceFailed = useCallback(() => {
    console.error('useReviewQueue: the browser could not draw the signed document')
    setSource({ status: 'error' })
  }, [])

  return { queue, source, retry, markSourceFailed }
}
