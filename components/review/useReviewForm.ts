'use client'

import { useCallback, useEffect } from 'react'
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form'
import type { OrderFormValues } from '@/components/orders/orderFormSchema'
import type { CustomerAddressOption } from '@/db/queries/customers'
import type { ReviewCustomer, ReviewFields } from '@/lib/review/review-fields.types'

/** A field a one-tap option can fill. */
export type OptionField = 'po_number' | 'requested_delivery_date'

export interface ReviewForm {
  form: UseFormReturn<OrderFormValues>
  /** The selected customer's saved addresses, MRU-first; [] when none is chosen. */
  addresses: CustomerAddressOption[]
  chooseCustomer: (customerId: string) => void
  chooseOption: (field: OptionField, value: string) => void
  /** Fills the delivery address with a saved address of the selected customer. */
  fillSavedAddress: (address: CustomerAddressOption) => void
}

const EDIT = { shouldDirty: true } as const

/**
 * The review pane's form (Task 118): the order form's own values, pre-filled
 * from the PO's extraction, reset whenever a new row's fields arrive. Edits
 * live only here, so closing the overlay loses them (saving is Task 108).
 *
 * Unlike New Order, choosing a customer does **not** pre-select its most
 * recent address: the PO's own ship-to is the better guess, and it stays in
 * the field as typed text. Only a saved address picked for the previous
 * customer is cleared, because its row id belongs to that customer (SEC-03).
 *
 * @param fields The row's pre-filled values, from `getReviewFields`.
 * @param customers Every customer the pane can pick, each with its saved addresses.
 */
export function useReviewForm(fields: ReviewFields, customers: ReviewCustomer[]): ReviewForm {
  const form = useForm<OrderFormValues>({ defaultValues: fields.values, mode: 'onSubmit' })
  const { reset, setValue, getValues, control } = form

  useEffect(() => {
    reset(fields.values)
  }, [fields, reset])

  const chooseCustomer = useCallback(
    (customerId: string) => {
      if (getValues('customer_id') === customerId) return
      setValue('customer_id', customerId, EDIT)
      if (getValues('delivery_address_id') !== null) {
        setValue('delivery_address', '', EDIT)
        setValue('delivery_address_id', null, EDIT)
      }
    },
    [getValues, setValue],
  )

  const chooseOption = useCallback(
    (field: OptionField, value: string) => setValue(field, value, EDIT),
    [setValue],
  )

  const fillSavedAddress = useCallback(
    (address: CustomerAddressOption) => {
      setValue('delivery_address', address.address, EDIT)
      setValue('delivery_address_id', address.id, EDIT)
    },
    [setValue],
  )

  const customerId = useWatch({ control, name: 'customer_id' })
  const addresses = customers.find((customer) => customer.id === customerId)?.addresses ?? []

  return { form, addresses, chooseCustomer, chooseOption, fillSavedAddress }
}
