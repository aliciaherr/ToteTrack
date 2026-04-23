'use client'

import {
  type FieldErrors,
  type UseFormRegister,
  type UseFormWatch,
} from 'react-hook-form'
import { FORM_INPUT_CLASS, type OrderFormValues } from './orderFormSchema'
import { FieldRow } from './OrderFormFields'

interface OrderLogisticsFieldsProps {
  register: UseFormRegister<OrderFormValues>
  watch: UseFormWatch<OrderFormValues>
  errors: FieldErrors<OrderFormValues>
}

/**
 * Bottom-half order-form fields: pickup-only toggle, delivery address
 * (conditionally rendered when not pickup-only), backhaul toggle, notes.
 * Split out of OrderFormFields to keep both files inside the CQ-02 200-line
 * component cap.
 */
export default function OrderLogisticsFields({
  register,
  watch,
  errors,
}: OrderLogisticsFieldsProps) {
  const isPickup = watch('pickup_only')

  return (
    <>
      <label className="flex items-center gap-2 text-sm text-foreground min-h-[44px]">
        <input type="checkbox" {...register('pickup_only')} className="h-4 w-4" />
        Pickup only (no delivery address)
      </label>

      {!isPickup && (
        <FieldRow
          label="Delivery Address"
          htmlFor="delivery_address"
          error={errors.delivery_address?.message}
        >
          <textarea
            id="delivery_address"
            rows={2}
            {...register('delivery_address', {
              validate: (value) =>
                watch('pickup_only') || value.trim().length > 0
                  ? true
                  : 'Delivery address is required when not pickup-only.',
            })}
            className={`${FORM_INPUT_CLASS} h-auto py-2`}
          />
        </FieldRow>
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
