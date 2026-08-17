'use client'

import { useState } from 'react'
import { useResetOnChange } from '@/components/shared/useResetOnChange'
import { createInvoice } from '@/lib/actions/invoices'
import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'
import { INVOICE_EXISTS_CODE } from '@/lib/actions/invoices.constants'

// Local-time Date for the first of the month — avoids the "ISO string parses
// as UTC in some browsers, local in others" parsing trap.
function billingMonthToDate(billingMonth: string): Date {
  const [year, month] = billingMonth.split('-').map(Number)
  return new Date(year, month - 1, 1)
}

interface SubmitInput {
  billingMonth: string
  orderIds: string[]
}

interface OverwritePrompt {
  billingMonth: string
  orderIds: string[]
  existingInvoiceNumber: string
}

interface UseInvoiceSubmitArgs {
  clearSignal: unknown
  onSuccess: () => void
}

interface UseInvoiceSubmit {
  isSubmitting: boolean
  error: string | null
  overwritePrompt: OverwritePrompt | null
  submit: (input: SubmitInput) => Promise<void>
  confirmOverwrite: () => Promise<void>
  cancelOverwrite: () => void
}

/** The three setters plus the success callback `runSubmit` writes through. */
interface RunSubmitDeps {
  setError: (value: string | null) => void
  setIsSubmitting: (value: boolean) => void
  setOverwritePrompt: (value: OverwritePrompt | null) => void
  onSuccess: () => void
}

// Hoisted out of the hook body rather than nested inside it: nested function
// bodies count toward the enclosing function's length, and the hook was over
// the 50-line cap that non-component functions carry.
async function runSubmit(
  input: SubmitInput,
  overwrite: boolean,
  { setError, setIsSubmitting, setOverwritePrompt, onSuccess }: RunSubmitDeps,
): Promise<void> {
  setError(null)
  setIsSubmitting(true)
  try {
    const result = await createInvoice({
      billingMonth: billingMonthToDate(input.billingMonth),
      orderIds: input.orderIds,
      overwrite,
    })
    if ('error' in result) {
      setError(result.error)
      return
    }
    if ('code' in result && result.code === INVOICE_EXISTS_CODE) {
      setOverwritePrompt({
        billingMonth: input.billingMonth,
        orderIds: input.orderIds,
        existingInvoiceNumber: result.existingInvoiceNumber,
      })
      return
    }
    setOverwritePrompt(null)
    onSuccess()
  } catch (cause) {
    // `submit` / `confirmOverwrite` are called from onClick handlers that
    // discard the returned promise, so without this a transport-level
    // rejection would vanish entirely: nothing logged, no inline error, and
    // the button silently re-enabling — indistinguishable from a no-op to
    // the salesperson (EH-01).
    console.error('useInvoiceSubmit: createInvoice failed in transit', {
      billingMonth: input.billingMonth,
      orderCount: input.orderIds.length,
      overwrite,
      cause,
    })
    setError(GENERIC_FAILURE_MESSAGE)
  } finally {
    setIsSubmitting(false)
  }
}

/**
 * Owns the submit state for the Generate Invoice panel: `isSubmitting`,
 * the inline `error` string, the `submit(input)` call, and the
 * overwrite-confirmation flow. When `createInvoice` returns the
 * `INVOICE_EXISTS` sentinel, we surface `overwritePrompt` so the parent
 * shows the Overwrite dialog. Confirming retries with `overwrite: true`.
 * @param clearSignal Any value whose *identity* change means "the panel moved
 *   on" — it clears `error` and `overwritePrompt`. Compared with `Object.is`,
 *   never deep-equality, so it must be referentially stable between real
 *   changes. A caller passing a freshly-built array or object on every render
 *   would wipe the error the user is currently reading. The only caller passes
 *   the server-rendered `orders` prop, which is stable by construction.
 * @param onSuccess Fired after a successful create or overwrite.
 * @returns Submit state plus the overwrite-confirmation handlers.
 */
export function useInvoiceSubmit({ clearSignal, onSuccess }: UseInvoiceSubmitArgs): UseInvoiceSubmit {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overwritePrompt, setOverwritePrompt] = useState<OverwritePrompt | null>(null)

  // Drop a stale error / overwrite prompt when the caller signals the panel has
  // moved on.
  useResetOnChange(clearSignal, () => {
    setError(null)
    setOverwritePrompt(null)
  })

  const deps: RunSubmitDeps = { setError, setIsSubmitting, setOverwritePrompt, onSuccess }

  async function submit(input: SubmitInput): Promise<void> {
    await runSubmit(input, false, deps)
  }

  async function confirmOverwrite(): Promise<void> {
    if (!overwritePrompt) return
    await runSubmit(
      { billingMonth: overwritePrompt.billingMonth, orderIds: overwritePrompt.orderIds },
      true,
      deps,
    )
  }

  function cancelOverwrite(): void {
    setOverwritePrompt(null)
  }

  return { isSubmitting, error, overwritePrompt, submit, confirmOverwrite, cancelOverwrite }
}
