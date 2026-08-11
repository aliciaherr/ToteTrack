'use client'

import type { UseFormRegister, UseFormSetValue, UseFormWatch } from 'react-hook-form'
import type { PickupFormValues } from './pickupFormSchema'
import SharedAddressSelect from '@/components/shared/AddressSelect'
import type { CustomerAddressOption } from '@/db/queries/customers'

interface PickupAddressSelectProps {
  /** The selected customer's saved addresses, MRU-first (pre-sorted by the query). */
  addresses: CustomerAddressOption[]
  register: UseFormRegister<PickupFormValues>
  watch: UseFormWatch<PickupFormValues>
  setValue: UseFormSetValue<PickupFormValues>
  /** Validation message for `address`, rendered under the field. */
  error?: string
}

/**
 * The pickup form's collection-address picker: a thin adapter mapping
 * `PickupFormValues`' `address` / `address_id` onto the shared `AddressSelect`
 * the order form also mounts. Builder-requested — picking a customer now offers
 * that customer's saved addresses as a dropdown with a "+ Add new address"
 * escape hatch, instead of a bare textarea.
 *
 * No inline `validate` rule, which is the one deliberate difference from the
 * order form's adapter: an order needs a delivery address unless the customer
 * collects, a pickup from the customer's usual site needs none at all, so a
 * blank address stays valid and is normalized to NULL on write.
 */
export default function PickupAddressSelect({
  addresses,
  register,
  watch,
  setValue,
  error,
}: PickupAddressSelectProps) {
  return (
    <SharedAddressSelect
      addresses={addresses}
      label="Collection Address (optional)"
      fieldId="address"
      registered={register('address')}
      error={error}
      bridge={{
        customerId: watch('customer_id'),
        address: watch('address'),
        addressId: watch('address_id'),
        setAddress: (value) => setValue('address', value),
        setAddressId: (value) => setValue('address_id', value),
      }}
    />
  )
}
