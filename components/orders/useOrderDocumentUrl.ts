'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getOrderDocumentUrl } from '@/lib/actions/order-document'

/**
 * The order's PO document as a short-lived signed URL (Task 121), fetched when
 * the slot mounts rather than on tap: iPad Safari blocks a new tab opened after
 * an await, so the link must already hold the URL when it is tapped.
 */

export type OrderDocumentUrlState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; url: string }

const FALLBACK_ERROR = "Couldn't load the PO document."

export function useOrderDocumentUrl(orderId: string): {
  state: OrderDocumentUrlState
  retry: () => void
} {
  const [state, setState] = useState<OrderDocumentUrlState>({ status: 'loading' })
  const isMountedRef = useRef(true)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      const result = await getOrderDocumentUrl(orderId)
      if (!isMountedRef.current) return
      if ('error' in result) {
        // The server logged its own cause; only the order id is logged here (SEC-05).
        console.error('useOrderDocumentUrl: could not sign the PO document', { orderId })
        setState({ status: 'error', message: result.error || FALLBACK_ERROR })
        return
      }
      setState({ status: 'ready', url: result.url })
    } catch (cause) {
      // Transport failure: the server never answered (EH-01).
      console.error('useOrderDocumentUrl: could not reach the server', { orderId, cause })
      if (isMountedRef.current) setState({ status: 'error', message: FALLBACK_ERROR })
    }
  }, [orderId])

  useEffect(() => {
    isMountedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- signing on mount is the subscription to server state this effect exists for; state is set only after awaiting the action.
    void load()
    return () => {
      isMountedRef.current = false
    }
  }, [load])

  const retry = useCallback(() => {
    void load()
  }, [load])

  return { state, retry }
}
