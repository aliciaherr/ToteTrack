'use client'

import { type UseFormReturn } from 'react-hook-form'
import { motion, useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import OrderFormFields from './OrderFormFields'
import { type OrderFormValues } from './orderFormSchema'
import { useOrderForm } from './useOrderForm'
import type { OrderDetail } from '@/db/queries/orders'
import type { CustomerSelectOption } from '@/db/queries/customers'

interface OrderFormProps {
  mode: 'create' | 'edit'
  initialDetail?: OrderDetail | null
  customers: CustomerSelectOption[]
  lockedCustomerId: string | null
  /**
   * Build-day override as `yyyy-MM-dd`, create mode only. Set when the form is
   * opened from a production-calendar day column so the new PO lands in that
   * column whatever delivery date is entered (CONSTRAINT-19). Omitted on the
   * Orders tab, where the server keeps deriving the default from the delivery
   * date.
   */
  productionDate?: string | null
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
        {isSubmitting ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Order'}
      </Button>
    </div>
  )
}

function FormBody({
  mode,
  form,
  customers,
  lockedCustomerId,
  serverError,
  qtyError,
}: {
  mode: 'create' | 'edit'
  form: UseFormReturn<OrderFormValues>
  customers: CustomerSelectOption[]
  lockedCustomerId: string | null
  serverError: string | null
  qtyError: string | null
}) {
  const { register, watch, setValue, formState: { errors } } = form
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-4">
      {serverError && (
        <div role="alert" className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2">
          {serverError}
        </div>
      )}
      <OrderFormFields
        mode={mode}
        customers={customers}
        lockedCustomerId={lockedCustomerId}
        register={register}
        watch={watch}
        setValue={setValue}
        errors={errors}
        qtyError={qtyError}
      />
    </div>
  )
}

/**
 * Create-or-edit purchase order form. Lives in the right-hand panel of the
 * orders screen. Client-side validation mirrors the server Zod schema; the
 * server re-validates on submit (SEC-02). Edit mode pre-fills; the
 * `initial_status` field is only shown in create mode because status
 * transitions are owned by `OrderStatusActions` (Task 18).
 */
export default function OrderForm({
  mode,
  initialDetail,
  customers,
  lockedCustomerId,
  productionDate,
  onClose,
  onSaved,
}: OrderFormProps) {
  const shouldReduceMotion = useReducedMotion()
  const { form, onSubmit, serverError, qtyError, isEdit } = useOrderForm({
    mode,
    initialDetail,
    customers,
    lockedCustomerId,
    productionDate,
    onSaved,
  })
  const title = isEdit ? `Edit ${initialDetail?.po_number}` : 'New Order'

  return (
    <motion.form
      {...(shouldReduceMotion ? {} : PANEL_ANIMATION)}
      onSubmit={form.handleSubmit(onSubmit)}
      className="h-full flex flex-col"
      aria-label={title}
    >
      <FormHeader title={title} />
      <FormBody
        mode={mode}
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
