'use client'

import { useEffect, useRef } from 'react'
import type { CustomerSelectOption } from '@/db/queries/customers'

interface MruAddressPreselectOptions {
  /** The form's currently selected customer id. */
  customerId: string
  customers: CustomerSelectOption[]
  mode: 'create' | 'edit'
  setAddress: (value: string) => void
  setAddressId: (value: string | null) => void
}

/**
 * Resets the address selection whenever the salesperson actually changes the
 * customer, then pre-selects the new customer's most-recently-used address —
 * `addresses` arrives MRU-first from `getActiveCustomersForSelect`, so index 0
 * is it (Feature 14). A customer with no saved addresses clears both fields.
 *
 * The reset is the load-bearing half: without it, switching customer would
 * leave the previous customer's address text *and* row id in the form, and the
 * server's SEC-03 ownership gate would reject the submit.
 *
 * Edit mode: the guard ref starts at the row's own customer, so mount never
 * overwrites the stored address snapshot — only a real dropdown change
 * re-derives the field. Create mode: the ref starts empty, so a locked-customer
 * deep link pre-selects on mount.
 *
 * @param options The watched customer id, the customer list carrying each
 *   customer's saved addresses, the form mode, and the two field setters.
 */
export function useMruAddressPreselect({
  customerId,
  customers,
  mode,
  setAddress,
  setAddressId,
}: MruAddressPreselectOptions) {
  const prevCustomerIdRef = useRef<string | null>(mode === 'edit' ? customerId : null)
  useEffect(() => {
    if (prevCustomerIdRef.current === customerId) return
    prevCustomerIdRef.current = customerId
    const picked = customers.find((customer) => customer.id === customerId)
    const mru = picked?.addresses[0] ?? null
    setAddress(mru?.address ?? '')
    setAddressId(mru?.id ?? null)
  }, [customerId, customers, setAddress, setAddressId])
}
