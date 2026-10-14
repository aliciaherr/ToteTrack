'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getReviewFields, getReviewQueue, getReviewSource } from '@/lib/actions/review'
import type { ReviewCustomer, ReviewFields } from '@/lib/review/review-fields.types'
import type { ReviewSource } from '@/lib/review/review-source'
import { useSourceResign, type LoadSource } from './useSourceResign'

/**
 * The review overlay's data (Tasks 106 and 118): the queue, loaded on open,
 * then the row on screen's source and fields, loaded in parallel, each with
 * its own loading, error and retry. After a decision (Task 120), `advance`
 * reloads the queue and loads its first row: every decision removes the row or
 * sends it to the back, so the row on screen is always the queue's first.
 * Replies are matched to the PO on screen: a late one for an earlier PO (a
 * retry still in flight when a decision moved on) is dropped. A signed source
 * is re-signed quietly when the page becomes visible after its link has gone
 * stale (`useSourceResign`).
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

/**
 * The row on screen's two panes. `currentPoIdRef` names the PO they belong to:
 * a source or fields reply for any other id arrived late, after a decision
 * moved on, and is dropped so it cannot land beside the wrong PO.
 * `signedAtRef` is when the source on screen was signed, for its re-sign.
 */
function usePoPanes(isMountedRef: React.RefObject<boolean>) {
  const [source, setSource] = useState<SourceState>({ status: 'loading' })
  const [fields, setFields] = useState<FieldsState>({ status: 'loading' })
  const currentPoIdRef = useRef<string | null>(null)
  const signedAtRef = useRef<number | null>(null)
  const isCurrent = useCallback((poId: string) => isMountedRef.current && currentPoIdRef.current === poId, [isMountedRef])

  const loadFields = useCallback(async (poId: string) => {
    setFields({ status: 'loading' })
    try {
      const result = await getReviewFields(poId)
      if (!isCurrent(poId)) return
      if ('error' in result) throw new Error(result.error)
      setFields({ status: 'ready', fields: result.fields, customers: result.customers })
    } catch (cause) {
      // The server logged its own cause; this covers a transport failure too (EH-01).
      console.error('useReviewQueue: could not load the PO fields', { poId, cause })
      if (isCurrent(poId)) setFields({ status: 'error' })
    }
  }, [isCurrent])

  // `quiet` (a re-sign) keeps the current view until the reply lands; only a failure replaces it.
  const loadSource = useCallback<LoadSource>(async (poId, { quiet = false } = {}) => {
    signedAtRef.current = null
    if (!quiet) setSource({ status: 'loading' })
    try {
      const result = await getReviewSource(poId)
      if (!isCurrent(poId)) return
      if ('error' in result) throw new Error(result.error)
      const { source: next } = result
      signedAtRef.current = next.kind === 'pdf' || next.kind === 'image' ? Date.now() : null
      setSource({ status: 'ready', source: next })
    } catch (cause) {
      // The server logged its own cause; this covers a transport failure too (EH-01).
      console.error('useReviewQueue: could not load the PO source', { poId, quiet, cause })
      if (isCurrent(poId)) setSource({ status: 'error' })
    }
  }, [isCurrent])

  const blank = useCallback(() => {
    setSource({ status: 'loading' })
    setFields({ status: 'loading' })
  }, [])

  useSourceResign(currentPoIdRef, signedAtRef, loadSource)

  return { source, fields, setSource, currentPoIdRef, loadSource, loadFields, blank }
}

/** The panes' own recovery: reload the current PO's fields, or mark its document undrawable. */
function usePaneRecovery(
  currentPoIdRef: React.RefObject<string | null>,
  loadFields: (poId: string) => Promise<void>,
  setSource: (state: SourceState) => void,
) {
  const retryFields = useCallback(() => {
    if (currentPoIdRef.current) void loadFields(currentPoIdRef.current)
  }, [currentPoIdRef, loadFields])

  const markSourceFailed = useCallback(() => {
    console.error('useReviewQueue: the browser could not draw the signed document')
    setSource({ status: 'error' })
  }, [setSource])

  return { retryFields, markSourceFailed }
}

/** Loads the queue on mount, then the first row's source and fields in parallel. */
export function useReviewQueue(): ReviewQueueState {
  const [queue, setQueue] = useState<QueueState>({ status: 'loading' })
  const isMountedRef = useRef(true)
  const { source, fields, setSource, currentPoIdRef, loadSource, loadFields, blank } = usePoPanes(isMountedRef)

  const loadQueue = useCallback(async (mode: LoadMode = 'open') => {
    // No PO is current until the reloaded queue names one.
    currentPoIdRef.current = null
    // `advance` blanks the decided row's form at once, so its buttons cannot be tapped again.
    if (mode === 'open') setQueue({ status: 'loading' })
    else blank()
    try {
      const result = await getReviewQueue()
      if (!isMountedRef.current) return
      if ('error' in result) throw new Error(result.error)
      if (result.ids.length === 0) {
        setQueue({ status: 'empty' })
        return
      }
      currentPoIdRef.current = result.ids[0]
      setQueue({ status: 'ready', ids: result.ids })
      await Promise.all([loadSource(result.ids[0]), loadFields(result.ids[0])])
    } catch (cause) {
      console.error('useReviewQueue: could not load the review queue', { cause })
      if (isMountedRef.current) setQueue({ status: 'error' })
    }
  }, [currentPoIdRef, blank, loadSource, loadFields])

  useEffect(() => {
    isMountedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the open read is the subscription to server state this effect exists for; state is set only after awaiting the action.
    void loadQueue()
    return () => {
      isMountedRef.current = false
    }
  }, [loadQueue])

  const retry = useCallback(() => {
    if (queue.status !== 'ready') void loadQueue('open')
    else if (currentPoIdRef.current) void loadSource(currentPoIdRef.current)
  }, [queue.status, currentPoIdRef, loadQueue, loadSource])

  const { retryFields, markSourceFailed } = usePaneRecovery(currentPoIdRef, loadFields, setSource)

  const advance = useCallback(() => {
    void loadQueue('advance')
  }, [loadQueue])

  return { queue, source, fields, retry, retryFields, markSourceFailed, advance }
}
