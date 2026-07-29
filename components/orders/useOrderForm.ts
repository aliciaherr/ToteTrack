'use client'

import { useEffect, useRef, useState } from 'react'
import { useForm, type UseFormReturn } from 'react-hook-form'
import {
  detailToFormValues,
  firstUnitPriceCouplingError,
  formValuesToCreateInput,
  formValuesToUpdateInput,
  totalQuantity,
  type OrderFormValues,
} from './orderFormSchema'
import { createOrder, updateOrder } from '@/lib/actions/orders'
import { useToast } from '@/lib/hooks/useToast'
import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'
import type { OrderDetail } from '@/db/queries/orders'
import type { CustomerSelectOption } from '@/db/queries/customers'

interface OrderFormOptions {
  mode: 'create' | 'edit'
  initialDetail?: OrderDetail | null
  customers: CustomerSelectOption[]
  lockedCustomerId: string | null
  /** Build-day override, create mode only — see `OrderForm`'s prop doc. */
  productionDate?: string | null
  onSaved: () => void
}

/**
 * Client-side mirror of the server's `requireAtLeastOneQty` superRefine and
 * `requireUnitPriceCoupling` (lib/actions/orders.validation.ts; PRD Feature 10
 * AC requires the coupling check to also fail client-side). Both surface
 * through the `qtyError` channel rather than react-hook-form's setError: the
 * qty and unit-price fields are bridged through setValue/watch (controlled by
 * QtyGrid), and setError doesn't reliably re-render subscribers for
 * programmatically-managed fields.
 */
function firstClientValidationError(values: OrderFormValues): string | null {
  if (totalQuantity(values) <= 0) return 'At least one quantity is required.'
  return firstUnitPriceCouplingError(values)
}

/**
 * Resets the address selection whenever the salesperson actually changes the
 * customer, then pre-selects the new customer's most-recently-used address —
 * `addresses` arrives MRU-first from `getActiveCustomersForSelect`, so index 0
 * is it (Feature 14; replaces the Feature-4 `useDeliveryAddressAutofill`,
 * which read the now-deprecated `default_delivery_address`). A customer with
 * no saved addresses clears both fields. Edit mode: the guard ref starts at
 * the order's own customer, so mount never overwrites the stored address
 * snapshot — only a real dropdown change re-derives the field. Create mode:
 * the ref starts empty, so a locked-customer deep link pre-selects on mount.
 */
export function useMruAddressPreselect(
  form: UseFormReturn<OrderFormValues>,
  mode: 'create' | 'edit',
  customers: CustomerSelectOption[],
) {
  const watchedCustomerId = form.watch('customer_id')
  const prevCustomerIdRef = useRef<string | null>(
    mode === 'edit' ? watchedCustomerId : null,
  )
  useEffect(() => {
    if (prevCustomerIdRef.current === watchedCustomerId) return
    prevCustomerIdRef.current = watchedCustomerId
    const picked = customers.find((c) => c.id === watchedCustomerId)
    const mru = picked?.addresses[0] ?? null
    form.setValue('delivery_address', mru?.address ?? '')
    form.setValue('delivery_address_id', mru?.id ?? null)
  }, [watchedCustomerId, customers, form])
}

interface SubmitDeps {
  isEdit: boolean
  orderId: string | null
  productionDate?: string | null
  mode: 'create' | 'edit'
  toast: (message: string, tone: 'success' | 'error') => void
  onSaved: () => void
  setServerError: (message: string | null) => void
  setQtyError: (message: string | null) => void
}

/**
 * Builds the form's submit handler: client validation mirrors, then the
 * create/update action. Every failure path surfaces — an `{ error }` result
 * inline via `serverError`, and a transport rejection (offline, stale action
 * id after a deploy) as `GENERIC_FAILURE_MESSAGE` instead of escaping
 * react-hook-form's handleSubmit unseen (EH-01).
 */
function makeSubmitHandler(deps: SubmitDeps) {
  return async (values: OrderFormValues): Promise<void> => {
    deps.setServerError(null)
    deps.setQtyError(null)
    const clientError = firstClientValidationError(values)
    if (clientError) {
      deps.setQtyError(clientError)
      return
    }
    let result: { id: string } | { success: true } | { error: string }
    try {
      result = deps.isEdit && deps.orderId
        ? await updateOrder(deps.orderId, formValuesToUpdateInput(values))
        : await createOrder(formValuesToCreateInput(values, deps.productionDate))
    } catch (cause) {
      console.error('useOrderForm: submit failed', {
        mode: deps.mode,
        orderId: deps.orderId,
        cause,
      })
      deps.setServerError(GENERIC_FAILURE_MESSAGE)
      return
    }
    if ('error' in result) {
      deps.setServerError(result.error)
      return
    }
    deps.toast(deps.isEdit ? 'Order updated.' : 'Order created.', 'success')
    deps.onSaved()
  }
}

/**
 * Form state and submit flow behind `OrderForm`. The submit handler and the
 * MRU address pre-selection are built by the module-level pieces above; this
 * hook only wires react-hook-form and the two error channels to them.
 */
export function useOrderForm(options: OrderFormOptions) {
  const { mode, initialDetail, customers, lockedCustomerId, productionDate, onSaved } = options
  const { toast } = useToast()
  const [serverError, setServerError] = useState<string | null>(null)
  const [qtyError, setQtyError] = useState<string | null>(null)
  const isEdit = mode === 'edit' && Boolean(initialDetail)
  const orderId = initialDetail?.id ?? null

  const form = useForm<OrderFormValues>({
    defaultValues: detailToFormValues(initialDetail, lockedCustomerId),
    mode: 'onSubmit',
  })

  useMruAddressPreselect(form, mode, customers)

  const onSubmit = makeSubmitHandler({
    isEdit,
    orderId,
    productionDate,
    mode,
    toast,
    onSaved,
    setServerError,
    setQtyError,
  })

  return { form, onSubmit, serverError, qtyError, isEdit }
}
