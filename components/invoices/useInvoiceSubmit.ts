'use client'

import { useEffect, useState } from 'react'
import { createInvoice } from '@/lib/actions/invoices'
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

/**
 * Owns the submit state for the Generate Invoice panel: `isSubmitting`,
 * the inline `error` string, the `submit(input)` call, and the
 * overwrite-confirmation flow. When `createInvoice` returns the
 * `INVOICE_EXISTS` sentinel, we surface `overwritePrompt` so the parent
 * shows the Overwrite dialog. Confirming retries with `overwrite: true`.
 */
export function useInvoiceSubmit({ clearSignal, onSuccess }: UseInvoiceSubmitArgs): UseInvoiceSubmit {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overwritePrompt, setOverwritePrompt] = useState<OverwritePrompt | null>(null)

  useEffect(() => {
    setError(null)
    setOverwritePrompt(null)
  }, [clearSignal])

  async function runSubmit(input: SubmitInput, overwrite: boolean): Promise<void> {
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
    } finally {
      setIsSubmitting(false)
    }
  }

  async function submit(input: SubmitInput): Promise<void> {
    await runSubmit(input, false)
  }

  async function confirmOverwrite(): Promise<void> {
    if (!overwritePrompt) return
    await runSubmit(
      { billingMonth: overwritePrompt.billingMonth, orderIds: overwritePrompt.orderIds },
      true,
    )
  }

  function cancelOverwrite(): void {
    setOverwritePrompt(null)
  }

  return { isSubmitting, error, overwritePrompt, submit, confirmOverwrite, cancelOverwrite }
}
