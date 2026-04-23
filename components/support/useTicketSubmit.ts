'use client'

import { useState } from 'react'
import {
  createTicket,
  uploadTicketAttachment,
  type CreateTicketInput,
} from '@/lib/actions/support'

export type TicketSubmitOutcome =
  | { status: 'success' }
  | { status: 'partial'; failedFiles: string[] }
  | { status: 'error'; message: string }

interface UseTicketSubmit {
  isSubmitting: boolean
  submit: (input: CreateTicketInput, files: File[]) => Promise<TicketSubmitOutcome>
}

/**
 * Owns the submit state for the New Ticket form. Orchestrates the two-step
 * flow the plan defines: `createTicket` first, then `uploadTicketAttachment`
 * per file. Partial failure (ticket saved, some uploads failed) returns
 * `{ status: 'partial', failedFiles }` so the caller can show the
 * write-up-preserved message — never retried as an "error" because the
 * ticket itself succeeded.
 *
 * Files are uploaded serially so the server-side per-ticket quota check
 * reflects each prior insert.
 *
 * Extracted from `NewTicketForm.tsx` to keep the component body within
 * CONSTRAINT-14's 50-line non-JSX cap — same pattern as `useInvoiceSubmit`.
 */
export function useTicketSubmit(): UseTicketSubmit {
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function submit(
    input: CreateTicketInput,
    files: File[],
  ): Promise<TicketSubmitOutcome> {
    setIsSubmitting(true)
    try {
      const ticketResult = await createTicket(input)
      if ('error' in ticketResult) {
        return { status: 'error', message: ticketResult.error }
      }

      const failedFiles: string[] = []
      for (const file of files) {
        const uploadResult = await uploadTicketAttachment(ticketResult.id, file)
        if ('error' in uploadResult) failedFiles.push(file.name)
      }

      if (failedFiles.length === 0) return { status: 'success' }
      return { status: 'partial', failedFiles }
    } finally {
      // `finally` guarantees the submitting state resets even if a runtime
      // or transport error throws — otherwise the button stays stuck on
      // "Submitting…" with no recovery path (EH-01).
      setIsSubmitting(false)
    }
  }

  return { isSubmitting, submit }
}
