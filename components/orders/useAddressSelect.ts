'use client'

import { useEffect, useRef, useState } from 'react'
import type { UseFormSetValue, UseFormWatch } from 'react-hook-form'
import type { OrderFormValues } from './orderFormSchema'
import type { CustomerAddressOption } from '@/db/queries/customers'

// Sentinel <option> values for `AddressSelect`. Real options carry a
// `customer_addresses` UUID, so neither can ever collide with one.
/** Dropdown option that swaps the picker into free-text (add-new) mode. */
export const ADD_NEW_VALUE = '__add_new__'
/** Dropdown option that restores the edit-mode address snapshot. */
export const CURRENT_VALUE = '__current__'

/** Field values captured once at mount — the edit-mode snapshot anchor. */
interface InitialValues {
  customerId: string
  address: string
  addressId: string | null
}

interface UseAddressSelectOptions {
  addresses: CustomerAddressOption[]
  watch: UseFormWatch<OrderFormValues>
  setValue: UseFormSetValue<OrderFormValues>
}

// The stored snapshot is offered only for the order's original customer and
// only while no saved row carries the identical text (an exact match renders
// as that saved option instead).
function deriveSnapshot(
  initial: InitialValues,
  customerId: string,
  addresses: CustomerAddressOption[],
): string | null {
  const applies =
    initial.addressId === null &&
    initial.address.trim() !== '' &&
    customerId === initial.customerId
  if (!applies) return null
  return addresses.some((entry) => entry.address === initial.address)
    ? null
    : initial.address
}

interface HandlerDeps {
  addresses: CustomerAddressOption[]
  initial: InitialValues
  setValue: UseFormSetValue<OrderFormValues>
  setIsCustom: (custom: boolean) => void
}

// Selection handlers, extracted so the hook body stays under the CQ-01 cap.
function makeHandlers({ addresses, initial, setValue, setIsCustom }: HandlerDeps) {
  return {
    handleSelect(value: string): void {
      if (value === ADD_NEW_VALUE) {
        setIsCustom(true)
        setValue('delivery_address', '')
        setValue('delivery_address_id', null)
        return
      }
      if (value === CURRENT_VALUE) {
        setValue('delivery_address', initial.address)
        setValue('delivery_address_id', null)
        return
      }
      const picked = addresses.find((entry) => entry.id === value)
      if (!picked) return
      setValue('delivery_address', picked.address)
      setValue('delivery_address_id', picked.id)
    },
    handleBackToSaved(): void {
      setIsCustom(false)
      const mru = addresses[0]
      if (mru) {
        setValue('delivery_address', mru.address)
        setValue('delivery_address_id', mru.id)
      } else {
        // Dropdown exists solely for the edit-mode snapshot — restore it.
        setValue('delivery_address', initial.address)
        setValue('delivery_address_id', null)
      }
    },
  }
}

/**
 * State for `AddressSelect` (Feature 14): which entry mode is active
 * (saved-address dropdown vs free-text), the dropdown's selected value, the
 * edit-mode "Current:" snapshot, and the selection handlers that bridge
 * choices into `delivery_address` / `delivery_address_id` via setValue.
 * Mode rules: zero saved addresses (and no snapshot) → free text; a real
 * customer change re-derives the mode; picking "+ Add new address" clears
 * both fields and swaps to free text.
 */
export function useAddressSelect({ addresses, watch, setValue }: UseAddressSelectOptions) {
  // Captured once at mount; anchors the edit-mode "Current:" option.
  const initialRef = useRef<InitialValues | null>(null)
  initialRef.current ??= {
    customerId: watch('customer_id'),
    address: watch('delivery_address'),
    addressId: watch('delivery_address_id'),
  }
  const initial = initialRef.current
  const [isCustom, setIsCustom] = useState(
    addresses.length === 0 && initial.address.trim() === '',
  )

  const watchedCustomerId = watch('customer_id')
  const watchedAddress = watch('delivery_address')
  const watchedAddressId = watch('delivery_address_id')
  const snapshot = deriveSnapshot(initial, watchedCustomerId, addresses)

  // Re-derive the entry mode only when the salesperson actually changes
  // customer: saved addresses (or the original snapshot) → dropdown, none →
  // textarea. A guard ref keeps re-renders from overriding an explicit
  // "+ Add new address" choice.
  const prevCustomerIdRef = useRef(watchedCustomerId)
  useEffect(() => {
    if (prevCustomerIdRef.current === watchedCustomerId) return
    prevCustomerIdRef.current = watchedCustomerId
    setIsCustom(
      addresses.length === 0 &&
        deriveSnapshot(initial, watchedCustomerId, addresses) === null,
    )
  }, [watchedCustomerId, addresses, initial])

  const textMatch = addresses.find((entry) => entry.address === watchedAddress)
  const selectValue =
    watchedAddressId ??
    (snapshot !== null && watchedAddress === snapshot ? CURRENT_VALUE : textMatch?.id ?? '')

  return {
    isCustom,
    snapshot,
    selectValue,
    canReturn: addresses.length > 0 || snapshot !== null,
    ...makeHandlers({ addresses, initial, setValue, setIsCustom }),
  }
}
