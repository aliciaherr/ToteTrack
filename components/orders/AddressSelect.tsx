'use client'

import type { UseFormRegister, UseFormSetValue, UseFormWatch } from 'react-hook-form'
import type { OrderFormValues } from './orderFormSchema'
import SharedAddressSelect from '@/components/shared/AddressSelect'
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

/**
 * The order form's delivery-address picker: a thin adapter that maps
 * `OrderFormValues`' `delivery_address` / `delivery_address_id` onto the shared
 * `AddressSelect` (which the pickup form mounts the same way, against its own
 * two fields). All picker behaviour — dropdown vs free-text mode, the
 * "Current:" edit snapshot, the "+ Add new address" escape hatch — lives in
 * `components/shared/AddressSelect`; only the field names, the label and the
 * order-specific required rule are decided here.
 */
export default function AddressSelect({
  addresses,
  register,
  watch,
  setValue,
  error,
}: AddressSelectProps) {
  // Same inline rule the pre-Feature-14 textarea carried, in both modes: in
  // dropdown mode it rides on a hidden input so submit-time validation and
  // the error channel keep working.
  const registered = register('delivery_address', {
    validate: (value) =>
      watch('customer_collects') || value.trim().length > 0
        ? true
        : 'Delivery address is required unless the customer collects.',
  })

  return (
    <SharedAddressSelect
      addresses={addresses}
      label="Delivery Address"
      fieldId="delivery_address"
      registered={registered}
      error={error}
      bridge={{
        customerId: watch('customer_id'),
        address: watch('delivery_address'),
        addressId: watch('delivery_address_id'),
        setAddress: (value) => setValue('delivery_address', value),
        setAddressId: (value) => setValue('delivery_address_id', value),
      }}
    />
  )
}
