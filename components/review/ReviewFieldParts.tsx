'use client'

import type { UseFormReturn } from 'react-hook-form'
import AddressSelect from '@/components/orders/AddressSelect'
import type { OrderFormValues } from '@/components/orders/orderFormSchema'
import type { CustomerAddressOption } from '@/db/queries/customers'
import { FieldRow, FORM_INPUT_CLASS } from '@/components/shared/formFields'
import type { LabelledOption } from '@/lib/review/review-fields.types'
import OptionChips from './OptionChips'
import type { OptionField } from './useReviewForm'

/**
 * The review pane's own field groups (Task 119): the fields the review adds a
 * one-tap choice to. No commentary: every issue is listed in the "To check"
 * section above the form.
 */

interface OptionFieldProps {
  form: UseFormReturn<OrderFormValues>
  field: OptionField
  label: string
  type: 'text' | 'date'
  options: LabelledOption[]
  onChoose: (field: OptionField, value: string) => void
}

/** A text or date field with the document's labelled options under it (PO number, delivery date). */
export function OptionFieldGroup({ form, field, label, type, options, onChoose }: OptionFieldProps) {
  const id = `review_${field}`
  return (
    <>
      <FieldRow label={label} htmlFor={id}>
        <input id={id} type={type} {...form.register(field)} className={FORM_INPUT_CLASS} />
      </FieldRow>
      <OptionChips
        label={`${label} options`}
        options={options}
        value={form.watch(field)}
        onChoose={(value) => onChoose(field, value)}
      />
    </>
  )
}

interface AddressGroupProps {
  form: UseFormReturn<OrderFormValues>
  addresses: CustomerAddressOption[]
  /** The PO has no ship-to: offer the customer's most recent saved address as one tap. */
  offersSavedAddress: boolean
  onFill: (address: CustomerAddressOption) => void
}

/**
 * The order form's own address picker, remounted per customer so the PO's
 * ship-to shows as its "Current:" text for whichever customer is chosen.
 */
export function AddressGroup({ form, addresses, offersSavedAddress, onFill }: AddressGroupProps) {
  const { register, watch, setValue } = form
  const saved = addresses[0]
  const showFill = offersSavedAddress && saved !== undefined && watch('delivery_address_id') !== saved.id
  return (
    <>
      <AddressSelect key={watch('customer_id')} addresses={addresses} register={register} watch={watch} setValue={setValue} />
      {showFill && (
        <button
          type="button"
          onClick={() => onFill(saved)}
          className="block min-h-[44px] w-full rounded-md border border-primary px-3 py-2 text-left text-sm text-primary"
        >
          Use saved address: {saved.address}
        </button>
      )}
    </>
  )
}
