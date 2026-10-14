'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getReviewFields, getReviewQueue, getReviewSource } from '@/lib/actions/review'
import type { ReviewCustomer, ReviewFields } from '@/lib/review/review-fields.types'
import type { ReviewSource } from '@/lib/review/review-source'

/**
 * The review overlay's data (Tasks 106 and 118): the queue, loaded on open,
 * then the row on screen's source and fields, loaded in parallel, each with
 * its own loading, error and retry. After a decision (Task 120), `advance`
 * reloads the queue and loads its first row: every decision removes the row or
 * sends it to the back, so the row on screen is always the queue's first.
 */

export type QueueState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'empty' }
  | { status: 'ready'; ids: string[] }

export type SourceState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; source: ReviewSource }

export type FieldsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; fields: ReviewFields; customers: ReviewCustomer[] }

export interface ReviewQueueState {
  queue: QueueState
  source: SourceState
  fields: FieldsState
  /** Reloads whatever failed: the queue, or the current row's source. */
  retry: () => void
  /** Reloads the current row's fields. */
  retryFields: () => void
  /** The document loaded a URL but the browser could not draw it. */
  markSourceFailed: () => void
  /** After a decision: reloads the queue and loads its (new) first row. */
  advance: () => void
}

/** `open` shows the whole-queue spinner; `advance` keeps the header and blanks only the two panes. */
type LoadMode = 'open' | 'advance'

/** Loads the queue on mount, then the first row's source and fields in parallel. */
export function useReviewQueue(): ReviewQueueState {
  const [queue, setQueue] = useState<QueueState>({ status: 'loading' })
  const [source, setSource] = useState<SourceState>({ status: 'loading' })
  const [fields, setFields] = useState<FieldsState>({ status: 'loading' })
  const isMountedRef = useRef(true)

  const loadFields = useCallback(async (poId: string) => {
    setFields({ status: 'loading' })
    try {
      const result = await getReviewFields(poId)
      if (!isMountedRef.current) return
      if ('error' in result) throw new Error(result.error)
      setFields({ status: 'ready', fields: result.fields, customers: result.customers })
    } catch (cause) {
      // The server logged its own cause; this covers a transport failure too (EH-01).
      console.error('useReviewQueue: could not load the PO fields', { poId, cause })
      if (isMountedRef.current) setFields({ status: 'error' })
    }
  }, [])

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

  const loadQueue = useCallback(async (mode: LoadMode = 'open') => {
    if (mode === 'open') {
      setQueue({ status: 'loading' })
    } else {
      // The decided row's form unmounts at once, so its buttons cannot be tapped again.
      setSource({ status: 'loading' })
      setFields({ status: 'loading' })
    }
    try {
      const result = await getReviewQueue()
      if (!isMountedRef.current) return
      if ('error' in result) throw new Error(result.error)
      if (result.ids.length === 0) {
        setQueue({ status: 'empty' })
        return
      }
      setQueue({ status: 'ready', ids: result.ids })
      await Promise.all([loadSource(result.ids[0]), loadFields(result.ids[0])])
    } catch (cause) {
      console.error('useReviewQueue: could not load the review queue', { cause })
      if (isMountedRef.current) setQueue({ status: 'error' })
    }
  }, [loadSource, loadFields])

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
    else void loadQueue('open')
  }, [queue, loadQueue, loadSource])

  const retryFields = useCallback(() => {
    if (queue.status === 'ready') void loadFields(queue.ids[0])
  }, [queue, loadFields])

  const markSourceFailed = useCallback(() => {
    console.error('useReviewQueue: the browser could not draw the signed document')
    setSource({ status: 'error' })
  }, [])

  const advance = useCallback(() => {
    void loadQueue('advance')
  }, [loadQueue])

  return { queue, source, fields, retry, retryFields, markSourceFailed, advance }
}
