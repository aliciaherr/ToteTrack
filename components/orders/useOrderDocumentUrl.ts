'use client'

import { useCallback, useEffect, useState } from 'react'
import { getOrderDocumentUrl } from '@/lib/actions/order-document'
import { RESIGN_AFTER_MS } from '@/components/shared/signedUrlResign.constants'

/**
 * The order's PO document as a short-lived signed URL (Task 121), fetched when
 * the slot mounts rather than on tap: iPad Safari blocks a new tab opened after
 * an await, so the link must already hold the URL when it is tapped.
 *
 * The link is re-signed before it expires, and again when the page becomes
 * visible after a long absence: a sleeping iPad suspends timers, so the
 * scheduled re-sign alone can wake up too late. A re-sign keeps the current
 * link on screen; only a failure replaces it (with the error and Retry).
 */

export type OrderDocumentUrlState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; url: string }

const FALLBACK_ERROR = "Couldn't load the PO document."
const LOADING: OrderDocumentUrlState = { status: 'loading' }

// Re-exported so existing callers and tests keep one import site.
export { RESIGN_AFTER_MS, RESIGN_SAFETY_MARGIN_MS } from '@/components/shared/signedUrlResign.constants'

type SetState = (state: OrderDocumentUrlState) => void

/** One sign request; logs and returns the state to show. */
async function signOnce(orderId: string): Promise<OrderDocumentUrlState> {
  try {
    const result = await getOrderDocumentUrl(orderId)
    if ('error' in result) {
      // The server logged its own cause; only the order id is logged here (SEC-05).
      console.error('useOrderDocumentUrl: could not sign the PO document', { orderId })
      return { status: 'error', message: result.error || FALLBACK_ERROR }
    }
    return { status: 'ready', url: result.url }
  } catch (cause) {
    // Transport failure: the server never answered (EH-01).
    console.error('useOrderDocumentUrl: could not reach the server', { orderId, cause })
    return { status: 'error', message: FALLBACK_ERROR }
  }
}

/**
 * Signs `orderId`'s link now and keeps it fresh until the returned cleanup
 * runs. Each call owns its own `cancelled` flag, so a late reply for an
 * earlier order or attempt can never overwrite the current one.
 *
 * @returns Cleanup: ignores in-flight replies, clears the timer and listener.
 */
function keepSigned(orderId: string, setState: SetState): () => void {
  let cancelled = false
  let inFlight = false
  let signedAt: number | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const sign = async () => {
    if (inFlight) return
    inFlight = true
    clearTimeout(timer)
    const next = await signOnce(orderId)
    inFlight = false
    if (cancelled) return
    setState(next)
    if (next.status !== 'ready') return
    signedAt = Date.now()
    timer = setTimeout(() => void sign(), RESIGN_AFTER_MS)
  }

  const onVisibilityChange = () => {
    if (document.visibilityState !== 'visible' || signedAt === null) return
    if (Date.now() - signedAt >= RESIGN_AFTER_MS) void sign()
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  void sign()
  return () => {
    cancelled = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

/**
 * The signed link for one order, kept fresh while the slot is mounted.
 *
 * @param orderId The order whose stored PO document to sign.
 * @returns The link state, and `retry` to start again after an error.
 */
export function useOrderDocumentUrl(orderId: string): {
  state: OrderDocumentUrlState
  retry: () => void
} {
  // Tagged with its order, so a new orderId shows loading, never the last order's link.
  const [entry, setEntry] = useState<{ orderId: string; state: OrderDocumentUrlState }>({
    orderId,
    state: LOADING,
  })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => keepSigned(orderId, (next) => setEntry({ orderId, state: next })), [orderId, attempt])

  const retry = useCallback(() => {
    setEntry({ orderId, state: LOADING })
    setAttempt((n) => n + 1)
  }, [orderId])

  const state = entry.orderId === orderId ? entry.state : LOADING
  return { state, retry }
}
