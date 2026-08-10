'use client'

import { type UseFormRegister } from 'react-hook-form'
import { FORM_INPUT_CLASS, type OrderFormValues } from './orderFormSchema'
import { FieldRow } from './OrderFormFields'

interface OrderLogisticsFieldsProps {
  register: UseFormRegister<OrderFormValues>
}

/**
 * Bottom-half order-form fields: customer-collects toggle, backhaul toggle, notes.
 * The delivery address picker moved up next to the customer dropdown in
 * `OrderFormFields` (builder-requested after iPad verification); the
 * customer-collects checkbox registered here still controls whether it renders —
 * `OrderFormFields` watches the flag. Split out of OrderFormFields to keep
 * both files inside the CQ-02 200-line component cap.
 */
export default function OrderLogisticsFields({ register }: OrderLogisticsFieldsProps) {
  return (
    <>
      <label className="flex items-center gap-2 text-sm text-foreground min-h-[44px]">
        <input type="checkbox" {...register('customer_collects')} className="h-4 w-4" />
        Customer Collects (no delivery address)
      </label>

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
