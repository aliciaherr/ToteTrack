'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getIngestStatus, triggerIngestion, type IngestStatus } from '@/lib/actions/ingest'
import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'
import { useToast } from '@/lib/hooks/useToast'
import { pendingTotal } from '@/lib/ingest/ingest-status-display'
import { INGEST_RUN_WATCH_MS, INGEST_STATUS_POLL_MS } from '@/lib/ingest/ingest-status.constants'

/**
 * The review-queue status behind the menu badge and its drawer panel (Task 105).
 *
 * Lives in `AppShell`, not the drawer, so a "Check mail now" keeps polling
 * after the drawer closes. A check is done when `lastRunAt` moves away from a
 * baseline read from the server just before the trigger: a failed run writes
 * no state, so a check that never moves ends at `INGEST_RUN_WATCH_MS` as an
 * error rather than spinning forever.
 */

export interface IngestStatusState {
  /** The last status read, or `null` before the first read lands. */
  status: IngestStatus | null
  /** The last read failed; the badge hides and the panel offers a retry. */
  hasLoadError: boolean
  /** A "Check mail now" is in flight. */
  isChecking: boolean
  /** Re-reads the status, e.g. when the drawer opens. */
  refresh: () => Promise<void>
  /** Starts an ingestion run and waits for it to finish. A second call while one is in flight does nothing. */
  checkMail: () => Promise<void>
}

const CHECK_TIMED_OUT_MESSAGE =
  "The mail check didn't finish. Look at the last-checked time, and try again if it hasn't moved."

const BASELINE_FAILED_MESSAGE = "Couldn't read the mail status, so the check didn't start. Try again."

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * The `lastRunAt` a check is measured against, read fresh from the server.
 * Comparing server timestamps with each other (not with the iPad's clock)
 * makes client/server clock skew irrelevant, and a fresh read means neither a
 * missing mount read nor an older cron run can pass for this check finishing.
 *
 * No cached fallback: a stale cached value is exactly what lets an older run
 * pass for this one, so without a fresh read the check does not start.
 *
 * @returns `{ lastRunAt }` (`null` = never run), or `null` when the fresh read fails.
 */
async function readBaseline(
  load: () => Promise<IngestStatus | null>,
): Promise<{ lastRunAt: string | null } | null> {
  const baseline = await load()
  return baseline ? { lastRunAt: baseline.lastRunAt } : null
}

/**
 * Re-reads the status until `lastRunAt` moves past `before`, or the watch window ends.
 *
 * @returns The status that showed the finished run, or `null` on timeout or unmount.
 */
async function watchRun(
  before: string | null,
  load: () => Promise<IngestStatus | null>,
  isMounted: () => boolean,
): Promise<IngestStatus | null> {
  const deadline = Date.now() + INGEST_RUN_WATCH_MS
  while (Date.now() < deadline && isMounted()) {
    await wait(INGEST_STATUS_POLL_MS)
    const latest = await load()
    if (latest?.lastRunAt && latest.lastRunAt !== before) return latest
  }
  return null
}

/** The status read: state, the reader, and refs the check-mail flow shares. */
function useStatusLoader() {
  const [status, setStatus] = useState<IngestStatus | null>(null)
  const [hasLoadError, setHasLoadError] = useState(false)
  const isMountedRef = useRef(true)

  const load = useCallback(async (): Promise<IngestStatus | null> => {
    try {
      const result = await getIngestStatus()
      if ('error' in result) throw new Error(result.error)
      if (!isMountedRef.current) return result
      setStatus(result)
      setHasLoadError(false)
      return result
    } catch (cause) {
      // The server logged its own cause; this covers a transport failure too (EH-01).
      console.error('useIngestStatus: could not load the review queue status', { cause })
      if (isMountedRef.current) setHasLoadError(true)
      return null
    }
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- false positive: `load` only sets state after awaiting the server action, never synchronously; the mount read is the subscription to server state this effect exists for.
    void load()
    return () => {
      isMountedRef.current = false
    }
  }, [load])

  return { status, hasLoadError, load, isMountedRef }
}

/** "Check mail now": trigger, then watch `lastRunAt`, one check at a time. */
function useCheckMail(loader: ReturnType<typeof useStatusLoader>) {
  const { toast } = useToast()
  const { load, isMountedRef } = loader
  const [isChecking, setIsChecking] = useState(false)
  const isCheckingRef = useRef(false)

  const checkMail = useCallback(async () => {
    if (isCheckingRef.current) return
    isCheckingRef.current = true
    setIsChecking(true)
    try {
      const baseline = await readBaseline(load)
      if (!baseline) {
        toast(BASELINE_FAILED_MESSAGE, 'error')
        return
      }
      const started = await triggerIngestion()
      if ('error' in started) {
        toast(started.error, 'error')
        return
      }
      const finished = await watchRun(baseline.lastRunAt, load, () => isMountedRef.current)
      // Unmounted mid-check (e.g. signed out): the watch was abandoned, not timed out.
      if (!isMountedRef.current) return
      if (finished) toast(`Mail checked. ${pendingTotal(finished)} pending.`, 'success')
      else toast(CHECK_TIMED_OUT_MESSAGE, 'error')
    } catch (cause) {
      console.error('useIngestStatus: "Check mail now" failed', { cause })
      toast(GENERIC_FAILURE_MESSAGE, 'error')
    } finally {
      isCheckingRef.current = false
      if (isMountedRef.current) setIsChecking(false)
    }
  }, [load, isMountedRef, toast])

  return { isChecking, checkMail }
}

/**
 * Loads the review-queue status on mount and runs "Check mail now".
 *
 * @returns The status, its load state, and the two actions.
 */
export function useIngestStatus(): IngestStatusState {
  const loader = useStatusLoader()
  const { isChecking, checkMail } = useCheckMail(loader)
  const { load } = loader
  const refresh = useCallback(async () => {
    await load()
  }, [load])
  return { status: loader.status, hasLoadError: loader.hasLoadError, isChecking, refresh, checkMail }
}
