'use client'

import { useState } from 'react'
import {
  useForm,
  useFieldArray,
  type UseFormReturn,
  type UseFieldArrayReturn,
} from 'react-hook-form'
import { motion, useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import CustomerContactFields from './CustomerContactFields'
import CustomerFormBasicFields from './CustomerFormBasicFields'
import DeleteCustomerDialog from './DeleteCustomerDialog'
import {
  type CustomerFormValues,
  detailToFormValues,
  formValuesToInput,
} from './customerFormSchema'
import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from '@/lib/actions/customers'
import { useToast } from '@/lib/hooks/useToast'
import type { CustomerDetail } from '@/db/queries/customers'

interface CustomerFormProps {
  mode: 'create' | 'edit'
  initialDetail?: CustomerDetail | null
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
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
  onRequestDelete,
}: {
  isEdit: boolean
  isSubmitting: boolean
  onClose: () => void
  onRequestDelete: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-border bg-card">
      {isEdit ? (
        <Button type="button" variant="destructive" onClick={onRequestDelete} className="min-h-[44px]">
          Delete Customer
        </Button>
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" onClick={onClose} className="min-h-[44px]">
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting} className="min-h-[44px]">
          {isSubmitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Customer'}
        </Button>
      </div>
    </div>
  )
}

function FormBody({
  form,
  fieldArray,
  isEdit,
  serverError,
}: {
  form: UseFormReturn<CustomerFormValues>
  fieldArray: UseFieldArrayReturn<CustomerFormValues, 'contacts', 'key'>
  isEdit: boolean
  serverError: string | null
}) {
  const { register, setValue, watch, formState: { errors } } = form
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {serverError && (
        <div role="alert" className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">
          {serverError}
        </div>
      )}
      <CustomerFormBasicFields
        isEdit={isEdit}
        register={register}
        setValue={setValue}
        watch={watch}
        errors={errors}
      />
      <CustomerContactFields
        fieldArray={fieldArray}
        register={register}
        setValue={setValue}
        watch={watch}
        errors={errors}
      />
    </div>
  )
}

/**
 * Create-or-edit customer form. Lives in the right-hand panel of the
 * customers screen. Client-side validation mirrors the server Zod schema;
 * the server re-validates on submit. Edit mode pre-fills, exposes an
 * active/inactive status toggle, and shows a Delete button that opens the
 * destructive confirmation dialog.
 */
export default function CustomerForm({
  mode,
  initialDetail,
  onClose,
  onSaved,
  onDeleted,
}: CustomerFormProps) {
  const shouldReduceMotion = useReducedMotion()
  const { toast } = useToast()
  const [serverError, setServerError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const isEdit = mode === 'edit' && Boolean(initialDetail)
  const customerId = initialDetail?.id ?? null
  const title = isEdit ? `Edit ${initialDetail?.company_name}` : 'New Customer'

  const form = useForm<CustomerFormValues>({
    defaultValues: detailToFormValues(initialDetail),
    mode: 'onSubmit',
  })
  const fieldArray = useFieldArray({ control: form.control, name: 'contacts', keyName: 'key' })

  async function onSubmit(values: CustomerFormValues) {
    setServerError(null)
    const primaries = values.contacts.filter((c) => c.is_primary).length
    if (primaries !== 1) {
      form.setError('contacts', {
        type: 'manual',
        message: 'Exactly one contact must be marked as primary.',
      })
      return
    }
    form.clearErrors('contacts')
    const input = formValuesToInput(values)
    const result = isEdit && customerId
      ? await updateCustomer(customerId, input)
      : await createCustomer(input)
    if ('error' in result) {
      setServerError(result.error)
      return
    }
    toast(isEdit ? 'Customer updated.' : 'Customer created.', 'success')
    onSaved()
  }

  async function handleDelete() {
    if (!customerId) return { error: 'No customer to delete.' } as const
    const result = await deleteCustomer(customerId)
    if ('success' in result) {
      setDeleteOpen(false)
      toast('Customer deleted.', 'success')
      onDeleted()
    }
    return result
  }

  return (
    <motion.form
      {...(shouldReduceMotion ? {} : PANEL_ANIMATION)}
      onSubmit={form.handleSubmit(onSubmit)}
      className="h-full flex flex-col"
      aria-label={title}
    >
      <FormHeader title={title} />
      <FormBody form={form} fieldArray={fieldArray} isEdit={isEdit} serverError={serverError} />
      <FormFooter
        isEdit={isEdit}
        isSubmitting={form.formState.isSubmitting}
        onClose={onClose}
        onRequestDelete={() => setDeleteOpen(true)}
      />
      {isEdit && initialDetail && (
        <DeleteCustomerDialog
          open={deleteOpen}
          companyName={initialDetail.company_name}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={handleDelete}
        />
      )}
    </motion.form>
  )
}
