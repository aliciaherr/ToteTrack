'use client'

import { useCallback, useRef, useState } from 'react'
import { approveReviewPo, discardReviewPo, skipReviewPo } from '@/lib/actions/review-decisions'
import type { CreateOrderInput } from '@/lib/actions/orders.validation'
import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'
import { useToast } from '@/lib/hooks/useToast'

/**
 * The server's reply when the PO left the queue first (another tab, another
 * device). Mirrors `ALREADY_HANDLED_MESSAGE` in `lib/actions/review-decisions.ts`,
 * which a `'use server'` module cannot export as a value.
 */
export const ALREADY_HANDLED_MESSAGE = 'This PO was already handled.'

/** The three decisions a reviewer can take on a queued PO. */
export type ReviewDecision = 'approve' | 'skip' | 'discard'

type DecisionResult = { error: string } | { success: true } | { orderId: string; reactivated: boolean }

const SUCCESS_TOAST: Record<ReviewDecision, string> = {
  approve: 'Order created.',
  skip: 'Skipped.',
  discard: 'Deleted.',
}

/** What a finished call means for the pane: move on, or show an error inline. */
type Outcome = { kind: 'decided'; toast: boolean } | { kind: 'error'; message: string }

function outcomeOf(result: DecisionResult): Outcome {
  if (!('error' in result)) return { kind: 'decided', toast: true }
  // Someone else already decided it: reload the queue rather than report it.
  if (result.error === ALREADY_HANDLED_MESSAGE) return { kind: 'decided', toast: false }
  return { kind: 'error', message: result.error }
}

/** State and handlers returned by `useReviewDecisions`. */
export interface ReviewDecisions {
  /** The decision in flight, or null when idle. */
  busy: ReviewDecision | null
  /** The last action's user-facing error, kept until the next action starts. */
  error: string | null
  approve: (input: CreateOrderInput) => Promise<void>
  skip: () => Promise<void>
  discard: () => Promise<void>
}

/**
 * Runs Approve, Skip and Delete for one queued PO (Task 120), one at a time:
 * a second tap while one is in flight is ignored. Success toasts and calls
 * `onDecided` so the queue loads the next PO; "already handled" calls
 * `onDecided` silently; any other `{ error }` is kept for the pane to show,
 * with the reviewer's edits untouched. A call that rejects in transit is
 * logged with the PO id and shown as the generic message (EH-01).
 *
 * @param poId The `inbound_pos.id` on screen.
 * @param onDecided Asks the queue to reload and load its next PO.
 */
export function useReviewDecisions(poId: string, onDecided: () => void): ReviewDecisions {
  const { toast } = useToast()
  const [busy, setBusy] = useState<ReviewDecision | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A ref, not the state: two taps inside one render would both read `busy` as null.
  const inFlight = useRef(false)

  const run = useCallback(
    async (decision: ReviewDecision, call: () => Promise<DecisionResult>) => {
      if (inFlight.current) return
      inFlight.current = true
      setBusy(decision)
      setError(null)
      let outcome: Outcome
      try {
        outcome = outcomeOf(await call())
      } catch (cause) {
        console.error(`useReviewDecisions: ${decision} rejected in transit`, { poId, cause })
        outcome = { kind: 'error', message: GENERIC_FAILURE_MESSAGE }
      } finally {
        inFlight.current = false
        setBusy(null)
      }
      if (outcome.kind === 'error') {
        setError(outcome.message)
        return
      }
      if (outcome.toast) toast(SUCCESS_TOAST[decision], 'success')
      onDecided()
    },
    [poId, onDecided, toast],
  )

  const approve = useCallback(
    (input: CreateOrderInput) => run('approve', () => approveReviewPo(poId, input)),
    [run, poId],
  )
  const skip = useCallback(() => run('skip', () => skipReviewPo(poId)), [run, poId])
  const discard = useCallback(() => run('discard', () => discardReviewPo(poId)), [run, poId])

  return { busy, error, approve, skip, discard }
}
