'use client'

import { useEffect, useRef, useState } from 'react'
import type { CustomerAddressOption } from '@/db/queries/customers'

// Sentinel <option> values for `AddressSelect`. Real options carry a
// `customer_addresses` UUID, so neither can ever collide with one.
/** Dropdown option that swaps the picker into free-text (add-new) mode. */
export const ADD_NEW_VALUE = '__add_new__'
/** Dropdown option that restores the edit-mode address snapshot. */
export const CURRENT_VALUE = '__current__'

/**
 * Form-agnostic bridge between the picker and whichever react-hook-form owns
 * the fields. The order form maps it onto `delivery_address` /
 * `delivery_address_id`, the pickup form onto `address` / `address_id`. The
 * picker itself never names a field, which is what lets one implementation
 * serve both forms instead of two copies drifting apart (CQ-07).
 */
export interface AddressFieldBridge {
  /** Currently selected customer id, '' when none is chosen yet. */
  customerId: string
  /** Current address text — the snapshot that will be written to the row. */
  address: string
  /** `customer_addresses` row id when a saved address is selected, else null. */
  addressId: string | null
  setAddress: (value: string) => void
  setAddressId: (value: string | null) => void
}

/** Field values captured once at mount — the edit-mode snapshot anchor. */
interface InitialValues {
  customerId: string
  address: string
  addressId: string | null
}

// The stored snapshot is offered only for the row's original customer and
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
  bridge: AddressFieldBridge
  setIsCustom: (custom: boolean) => void
}

// Selection handlers, extracted so the hook body stays under the CQ-01 cap.
function makeHandlers({ addresses, initial, bridge, setIsCustom }: HandlerDeps) {
  const apply = (address: string, addressId: string | null): void => {
    bridge.setAddress(address)
    bridge.setAddressId(addressId)
  }
  return {
    handleSelect(value: string): void {
      if (value === ADD_NEW_VALUE) {
        setIsCustom(true)
        apply('', null)
        return
      }
      if (value === CURRENT_VALUE) {
        apply(initial.address, null)
        return
      }
      const picked = addresses.find((entry) => entry.id === value)
      if (!picked) return
      apply(picked.address, picked.id)
    },
    handleBackToSaved(): void {
      setIsCustom(false)
      const mru = addresses[0]
      // Dropdown exists solely for the edit-mode snapshot when there is no
      // MRU row to fall back on — restore it rather than blanking the field.
      if (mru) apply(mru.address, mru.id)
      else apply(initial.address, null)
    },
  }
}

/**
 * State for `AddressSelect` (Feature 14): which entry mode is active
 * (saved-address dropdown vs free-text), the dropdown's selected value, the
 * edit-mode "Current:" snapshot, and the selection handlers that bridge
 * choices into the owning form's address / address-id fields.
 * Mode rules: zero saved addresses (and no snapshot) → free text; a real
 * customer change re-derives the mode; picking "+ Add new address" clears
 * both fields and swaps to free text.
 * @param options The customer's saved addresses (MRU-first) and the field
 *   bridge into the owning react-hook-form instance.
 * @returns Entry mode, dropdown value, snapshot label and both handlers.
 */
export function useAddressSelect({
  addresses,
  bridge,
}: {
  addresses: CustomerAddressOption[]
  bridge: AddressFieldBridge
}) {
  const { customerId, address, addressId } = bridge
  // Captured once at mount; anchors the edit-mode "Current:" option.
  const initialRef = useRef<InitialValues | null>(null)
  initialRef.current ??= { customerId, address, addressId }
  const initial = initialRef.current
  const [isCustom, setIsCustom] = useState(
    addresses.length === 0 && initial.address.trim() === '',
  )

  const snapshot = deriveSnapshot(initial, customerId, addresses)

  // Re-derive the entry mode only when the salesperson actually changes
  // customer: saved addresses (or the original snapshot) → dropdown, none →
  // textarea. A guard ref keeps re-renders from overriding an explicit
  // "+ Add new address" choice.
  const prevCustomerIdRef = useRef(customerId)
  useEffect(() => {
    if (prevCustomerIdRef.current === customerId) return
    prevCustomerIdRef.current = customerId
    setIsCustom(
      addresses.length === 0 && deriveSnapshot(initial, customerId, addresses) === null,
    )
  }, [customerId, addresses, initial])

  const textMatch = addresses.find((entry) => entry.address === address)
  const selectValue =
    addressId ??
    (snapshot !== null && address === snapshot ? CURRENT_VALUE : textMatch?.id ?? '')

  return {
    isCustom,
    snapshot,
    selectValue,
    canReturn: addresses.length > 0 || snapshot !== null,
    ...makeHandlers({ addresses, initial, bridge, setIsCustom }),
  }
}
