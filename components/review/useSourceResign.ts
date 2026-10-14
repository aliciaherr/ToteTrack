'use client'

import { useEffect } from 'react'
import { RESIGN_AFTER_MS } from '@/components/shared/signedUrlResign.constants'

/** Reloads one PO's source; `quiet` keeps the current view on screen until the reply lands. */
export type LoadSource = (poId: string, options?: { quiet?: boolean }) => Promise<void>

/**
 * Keeps the review source's signed link usable (the "Open the file" link and
 * the image or PDF behind it expire an hour after signing). When the page
 * becomes visible again and the source was signed `RESIGN_AFTER_MS` ago or
 * longer, the PO on screen's source is reloaded quietly: no spinner, the drawn
 * pages stay. A sleeping iPad suspends timers, so the page becoming visible is
 * the moment the link is most likely stale.
 *
 * @param currentPoIdRef The PO on screen; `null` while none is.
 * @param signedAtRef When the source on screen was signed (client clock), or
 *   `null` when it holds no link (text, refusal, loading, error) or a re-sign
 *   is already in flight.
 * @param loadSource The queue's source loader, which drops replies for any other PO.
 */
export function useSourceResign(
  currentPoIdRef: React.RefObject<string | null>,
  signedAtRef: React.RefObject<number | null>,
  loadSource: LoadSource,
): void {
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      const poId = currentPoIdRef.current
      const signedAt = signedAtRef.current
      if (poId === null || signedAt === null || Date.now() - signedAt < RESIGN_AFTER_MS) return
      // Cleared first, so a second wake while this reload is in flight does not start another.
      signedAtRef.current = null
      void loadSource(poId, { quiet: true })
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [currentPoIdRef, signedAtRef, loadSource])
}
