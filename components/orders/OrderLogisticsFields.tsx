'use client'

import {
  type FieldErrors,
  type UseFormRegister,
  type UseFormSetValue,
  type UseFormWatch,
} from 'react-hook-form'
import { FORM_INPUT_CLASS, type OrderFormValues } from './orderFormSchema'
import { FieldRow } from './OrderFormFields'
import AddressSelect from './AddressSelect'
import type { CustomerAddressOption } from '@/db/queries/customers'

interface OrderLogisticsFieldsProps {
  register: UseFormRegister<OrderFormValues>
  watch: UseFormWatch<OrderFormValues>
  setValue: UseFormSetValue<OrderFormValues>
  errors: FieldErrors<OrderFormValues>
  /** Saved addresses of the currently selected customer, MRU-first (Feature 14). */
  addresses: CustomerAddressOption[]
}

/**
 * Bottom-half order-form fields: pickup-only toggle, delivery address picker
 * (conditionally rendered when not pickup-only — Feature 14's `AddressSelect`
 * replaces the old plain textarea), backhaul toggle, notes. Split out of
 * OrderFormFields to keep both files inside the CQ-02 200-line component cap.
 */
export default function OrderLogisticsFields({
  register,
  watch,
  setValue,
  errors,
  addresses,
}: OrderLogisticsFieldsProps) {
  const isPickup = watch('pickup_only')

  return (
    <>
      <label className="flex items-center gap-2 text-sm text-foreground min-h-[44px]">
        <input type="checkbox" {...register('pickup_only')} className="h-4 w-4" />
        Pickup only (no delivery address)
      </label>

      {!isPickup && (
        <AddressSelect
          addresses={addresses}
          register={register}
          watch={watch}
          setValue={setValue}
          error={errors.delivery_address?.message}
        />
      )}

      <label className="flex items-center gap-2 text-sm text-foreground min-h-[44px]">
        <input type="checkbox" {...register('backhaul')} className="h-4 w-4" />
        Backhaul pickup
      </label>

      <FieldRow label="Notes" htmlFor="notes">
        <textarea
          id="notes"
          rows={3}
          {...register('notes')}
          className={`${FORM_INPUT_CLASS} h-auto py-2`}
        />
      </FieldRow>
    </>
  )
}
