'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { motion, useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { createLead, updateLead } from '@/lib/actions/leads'
import { useToast } from '@/lib/hooks/useToast'
import {
  type LeadFormValues,
  EMPTY_FORM_VALUES,
  detailToFormValues,
  formValuesToLeadInput,
} from './leadFormSchema'
import {
  NameField,
  CompanyTitleRow,
  ContactMethodRow,
  StatusSourceRow,
  FollowUpRow,
} from './LeadFormFields'
import type { LeadDetail } from '@/db/queries/leads'

interface LeadFormProps {
  mode: 'create' | 'edit'
  initialDetail?: LeadDetail | null
  onClose: () => void
  onSaved: () => void
}

// Design spec: modal panel open = 180ms scale 0.97→1 + fade (ease-out).
const PANEL_ANIMATION = {
  initial: { opacity: 0, scale: 0.97 },
  animate: { opacity: 1, scale: 1 },
  transition: { duration: 0.18, ease: 'easeOut' as const },
}

function FormHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center px-6 py-4 border-b border-border">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
    </div>
  )
}

function FormFooter({ isSubmitting }: { isSubmitting: boolean }) {
  return (
    <div className="px-6 py-4 border-t border-border flex justify-end">
      <Button type="submit" disabled={isSubmitting} className="min-h-[44px] bg-primary text-primary-foreground">
        {isSubmitting ? 'Saving…' : 'Save Lead'}
      </Button>
    </div>
  )
}

/**
 * Right-panel form for creating or editing a lead. Mirrors the CustomerForm
 * and OrderForm modal-animation pattern (scale 0.97→1 + fade, 180ms ease-out).
 * Success toast is wired in Task 29.
 */
export default function LeadForm({ mode, initialDetail, onClose, onSaved }: LeadFormProps) {
  const shouldReduceMotion = useReducedMotion()
  const { toast } = useToast()
  const [serverError, setServerError] = useState<string | null>(null)
  const isEdit = mode === 'edit'

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LeadFormValues>({
    defaultValues: isEdit && initialDetail ? detailToFormValues(initialDetail) : EMPTY_FORM_VALUES,
  })

  async function onSubmit(values: LeadFormValues) {
    setServerError(null)
    const input = formValuesToLeadInput(values)
    const result = isEdit && initialDetail
      ? await updateLead(initialDetail.id, input)
      : await createLead(input)

    if ('error' in result) {
      setServerError(result.error)
      return
    }
    toast(isEdit ? 'Lead updated.' : 'Lead created.', 'success')
    onSaved()
  }

  const animation = shouldReduceMotion ? {} : PANEL_ANIMATION

  return (
    <motion.form
      onSubmit={handleSubmit(onSubmit)}
      className="h-full flex flex-col bg-card"
      {...animation}
    >
      <FormHeader title={isEdit ? `Edit ${initialDetail?.name ?? 'Lead'}` : 'New Lead'} />
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {serverError && (
          <div role="alert" className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">
            {serverError}
          </div>
        )}
        <NameField register={register} errors={errors} />
        <CompanyTitleRow register={register} />
        <ContactMethodRow register={register} errors={errors} />
        <StatusSourceRow register={register} />
        <FollowUpRow register={register} />
      </div>
      <FormFooter isSubmitting={isSubmitting} />
    </motion.form>
  )
}
