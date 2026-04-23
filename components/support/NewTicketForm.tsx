'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { motion, useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import {
  TitleField,
  CategoryPriorityRow,
  DescriptionField,
  AttachmentsField,
} from './NewTicketFormFields'
import { useTicketSubmit, type TicketSubmitOutcome } from './useTicketSubmit'
import { useAttachments } from './useAttachments'
import { useToast } from '@/lib/hooks/useToast'
import { EMPTY_TICKET_FORM_VALUES, type TicketFormValues } from './ticketFormSchema'

// Design spec: modal panel open = 180ms scale 0.97→1 + fade (ease-out).
const PANEL_ANIMATION = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1 },
  transition: { duration: 0.18, ease: 'easeOut' as const },
}

function partialFailureMessage(failed: string[]): string {
  const noun = failed.length === 1 ? 'attachment' : 'attachments'
  return `Ticket submitted, but ${failed.length} ${noun} failed to upload.`
}

function FormHeader() {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-border">
      <h2 className="text-lg font-semibold text-foreground">Log New Issue</h2>
    </div>
  )
}

function FormFooter({ isSubmitting, onReset }: { isSubmitting: boolean; onReset: () => void }) {
  return (
    <div className="px-6 py-4 border-t border-border flex justify-end gap-2">
      <Button type="button" variant="ghost" className="min-h-[44px]" onClick={onReset}>
        Cancel
      </Button>
      <Button
        type="submit"
        disabled={isSubmitting}
        className="min-h-[44px] bg-primary text-primary-foreground"
      >
        {isSubmitting ? 'Submitting…' : 'Submit Issue'}
      </Button>
    </div>
  )
}

/**
 * Right-panel form for logging a new support ticket. Validates title,
 * category, priority, description, and up to 3 attachments (PNG/JPG/PDF,
 * ≤5MB each) before calling the `createTicket` + per-file
 * `uploadTicketAttachment` flow. Success / partial-failure surface as
 * inline notices until Task 29 wires ToastProvider.
 */
export default function NewTicketForm() {
  const shouldReduceMotion = useReducedMotion()
  const { toast } = useToast()
  const { isSubmitting, submit } = useTicketSubmit()
  const attachments = useAttachments()
  const [serverError, setServerError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<TicketFormValues>({ defaultValues: EMPTY_TICKET_FORM_VALUES })

  function resetAll() {
    reset(EMPTY_TICKET_FORM_VALUES)
    attachments.reset()
    setServerError(null)
    setNotice(null)
  }

  async function onSubmit(values: TicketFormValues) {
    setServerError(null)
    setNotice(null)
    const outcome: TicketSubmitOutcome = await submit(values, attachments.files)
    if (outcome.status === 'error') {
      setServerError(outcome.message)
      return
    }
    if (outcome.status === 'partial') {
      const message = partialFailureMessage(outcome.failedFiles)
      setNotice(message)
      toast(message, 'error')
    } else {
      toast('Issue submitted.', 'success')
    }
    reset(EMPTY_TICKET_FORM_VALUES)
    attachments.reset()
  }

  const animation = shouldReduceMotion ? {} : PANEL_ANIMATION

  return (
    <motion.form
      onSubmit={handleSubmit(onSubmit)}
      className="h-full flex flex-col bg-card"
      {...animation}
    >
      <FormHeader />
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {serverError && (
          <div role="alert" className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">
            {serverError}
          </div>
        )}
        {notice && (
          <div role="status" className="rounded-md bg-primary/10 text-primary text-sm px-3 py-2">
            {notice}
          </div>
        )}
        <TitleField register={register} errors={errors} />
        <CategoryPriorityRow register={register} />
        <DescriptionField register={register} errors={errors} />
        <AttachmentsField
          files={attachments.files}
          onAdd={attachments.addFiles}
          onRemove={attachments.removeFile}
          error={attachments.error}
        />
      </div>
      <FormFooter isSubmitting={isSubmitting} onReset={resetAll} />
    </motion.form>
  )
}
