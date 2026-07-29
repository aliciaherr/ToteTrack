'use client'

import type {
  UseFormRegister,
  UseFormRegisterReturn,
  UseFormSetValue,
  UseFormWatch,
} from 'react-hook-form'
import { FORM_INPUT_CLASS, type OrderFormValues } from './orderFormSchema'
import { FieldRow } from './OrderFormFields'
import { ADD_NEW_VALUE, CURRENT_VALUE, useAddressSelect } from './useAddressSelect'
import { DELIVERY_ADDRESS_MAX } from '@/lib/actions/orders.validation'
import type { CustomerAddressOption } from '@/db/queries/customers'

interface AddressSelectProps {
  /** The selected customer's saved addresses, MRU-first (pre-sorted by the query). */
  addresses: CustomerAddressOption[]
  register: UseFormRegister<OrderFormValues>
  watch: UseFormWatch<OrderFormValues>
  setValue: UseFormSetValue<OrderFormValues>
  /** Validation message for `delivery_address`, rendered under the field. */
  error?: string
}

function SavedAddressPicker({
  value,
  snapshot,
  addresses,
  onSelect,
  error,
  hiddenInput,
}: {
  value: string
  snapshot: string | null
  addresses: CustomerAddressOption[]
  onSelect: (value: string) => void
  error?: string
  hiddenInput: React.ReactNode
}) {
  return (
    <FieldRow label="Delivery Address" htmlFor="delivery_address" error={error}>
      {hiddenInput}
      <select
        id="delivery_address"
        value={value}
        onChange={(event) => onSelect(event.target.value)}
        className={FORM_INPUT_CLASS}
      >
        {value === '' && <option value="">Select an address…</option>}
        {snapshot !== null && <option value={CURRENT_VALUE}>Current: {snapshot}</option>}
        {addresses.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.address}
          </option>
        ))}
        <option value={ADD_NEW_VALUE}>+ Add new address</option>
      </select>
    </FieldRow>
  )
}

function NewAddressEntry({
  registered,
  error,
  canReturn,
  onBack,
}: {
  registered: UseFormRegisterReturn<'delivery_address'>
  error?: string
  canReturn: boolean
  onBack: () => void
}) {
  return (
    <FieldRow label="Delivery Address" htmlFor="delivery_address" error={error}>
      <textarea
        id="delivery_address"
        rows={2}
        maxLength={DELIVERY_ADDRESS_MAX}
        {...registered}
        className={`${FORM_INPUT_CLASS} h-auto py-2`}
      />
      {canReturn && (
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] text-xs text-muted-foreground underline underline-offset-2"
        >
          Use a saved address
        </button>
      )}
    </FieldRow>
  )
}

/**
 * Delivery-address picker for the order form (Feature 14). Two modes, run by
 * `useAddressSelect`: a dropdown of the customer's saved addresses (MRU-first)
 * plus a "+ Add new address" option, or a free-text textarea for a fresh
 * address. Picking a saved address writes its text into `delivery_address`
 * and its row id into `delivery_address_id`; typed text keeps the id null.
 * A customer with zero saved addresses goes straight to the textarea. Edit
 * mode: the order's stored snapshot (which may match no saved row) shows as
 * a "Current:" option with the id kept null, so an unchanged resubmit never
 * links or duplicates an address-book row.
 */
export default function AddressSelect({
  addresses,
  register,
  watch,
  setValue,
  error,
}: AddressSelectProps) {
  const state = useAddressSelect({ addresses, watch, setValue })

  // Same inline rule the pre-Feature-14 textarea carried, in both modes: in
  // dropdown mode it rides on a hidden input so submit-time validation and
  // the error channel keep working.
  const registered = register('delivery_address', {
    validate: (value) =>
      watch('pickup_only') || value.trim().length > 0
        ? true
        : 'Delivery address is required when not pickup-only.',
  })

  if (state.isCustom) {
    return (
      <NewAddressEntry
        registered={registered}
        error={error}
        canReturn={state.canReturn}
        onBack={state.handleBackToSaved}
      />
    )
  }

  return (
    <SavedAddressPicker
      value={state.selectValue}
      snapshot={state.snapshot}
      addresses={addresses}
      onSelect={state.handleSelect}
      error={error}
      hiddenInput={<input type="hidden" {...registered} />}
    />
  )
}
