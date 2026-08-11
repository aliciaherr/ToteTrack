'use client'

import { type UseFormReturn } from 'react-hook-form'
import { motion, useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import PickupFormFields from './PickupFormFields'
import { type PickupFormValues } from './pickupFormSchema'
import { usePickupForm } from './usePickupForm'
import type { PickupDetail } from '@/db/queries/pickups'
import type { CustomerSelectOption } from '@/db/queries/customers'

interface PickupFormProps {
  mode: 'create' | 'edit'
  initialDetail?: PickupDetail | null
  customers: CustomerSelectOption[]
  lockedCustomerId: string | null
  /**
   * `yyyy-MM-dd` pre-filled into the date field in create mode — the calendar
   * column whose `+ Add → Add Pickup` opened this form. Visible and editable,
   * because a pickup's date *is* its calendar placement (CONSTRAINT-25).
   */
  initialPickupDate?: string | null
  onClose: () => void
  onSaved: () => void
}

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

function FormFooter({
  isEdit,
  isSubmitting,
  onClose,
}: {
  isEdit: boolean
  isSubmitting: boolean
  onClose: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-card">
      <Button type="button" variant="ghost" onClick={onClose} className="min-h-[44px]">
        Cancel
      </Button>
      <Button type="submit" disabled={isSubmitting} className="min-h-[44px]">
        {isSubmitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Pickup'}
      </Button>
    </div>
  )
}

function FormBody({
  form,
  customers,
  lockedCustomerId,
  serverError,
  qtyError,
}: {
  form: UseFormReturn<PickupFormValues>
  customers: CustomerSelectOption[]
  lockedCustomerId: string | null
  serverError: string | null
  qtyError: string | null
}) {
  const {
    register,
    formState: { errors },
  } = form
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {serverError && (
        <div
          role="alert"
          className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2"
        >
          {serverError}
        </div>
      )}
      <PickupFormFields
        customers={customers}
        lockedCustomerId={lockedCustomerId}
        register={register}
        errors={errors}
        qtyError={qtyError}
      />
    </div>
  )
}

/**
 * Create-or-edit tote pickup form. Lives in the right-hand panel of the
 * pickups screen. Client-side validation mirrors the server Zod schema; the
 * server re-validates on submit (SEC-02). Edit mode pre-fills from the
 * selected pickup. There is no status field in either mode — transitions are
 * owned by `PickupDetail`'s status block via `updatePickupStatus`.
 */
export default function PickupForm({
  mode,
  initialDetail,
  customers,
  lockedCustomerId,
  initialPickupDate,
  onClose,
  onSaved,
}: PickupFormProps) {
  const shouldReduceMotion = useReducedMotion()
  const { form, onSubmit, serverError, qtyError, isEdit } = usePickupForm({
    mode,
    initialDetail,
    lockedCustomerId,
    initialPickupDate,
    onSaved,
  })
  const title = isEdit ? 'Edit Pickup' : 'New Pickup'

  return (
    <motion.form
      {...(shouldReduceMotion ? {} : PANEL_ANIMATION)}
      onSubmit={form.handleSubmit(onSubmit)}
      className="h-full flex flex-col"
      aria-label={title}
    >
      <FormHeader title={title} />
      <FormBody
        form={form}
        customers={customers}
        lockedCustomerId={lockedCustomerId}
        serverError={serverError}
        qtyError={qtyError}
      />
      <FormFooter
        isEdit={isEdit}
        isSubmitting={form.formState.isSubmitting}
        onClose={onClose}
      />
    </motion.form>
  )
}
