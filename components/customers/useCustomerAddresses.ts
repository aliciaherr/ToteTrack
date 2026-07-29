'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  addCustomerAddress,
  deleteCustomerAddress,
  updateCustomerAddress,
} from '@/lib/actions/customer-addresses'
import { useToast } from '@/lib/hooks/useToast'
import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'

/**
 * Which (single) inline editor the Delivery Addresses section has open.
 * Only one row can be in add/edit/delete-confirm state at a time — opening
 * another closes the current one, which keeps the panel unambiguous on iPad.
 */
export type AddressSectionMode =
  | { type: 'idle' }
  | { type: 'adding' }
  | { type: 'editing'; id: string }
  | { type: 'confirming-delete'; id: string }

const IDLE: AddressSectionMode = { type: 'idle' }

type ActionResult = { id: string } | { success: true } | { error: string }

/**
 * State and handlers behind `CustomerAddresses`: inline add/edit/delete of a
 * customer's saved delivery addresses. Success paths toast and refresh the
 * route (the actions already `revalidatePath`); `{ error }` results land in
 * `errorMessage` for the inline alert. A transport-level rejection is logged
 * with context and surfaced as the generic failure message (EH-01) — never
 * swallowed.
 * @param customerId UUID of the customer whose addresses are being managed.
 */
export function useCustomerAddresses(customerId: string) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [isSaving, setIsSaving] = useState(false)
  const [mode, setMode] = useState<AddressSectionMode>(IDLE)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  function openMode(next: AddressSectionMode): void {
    setErrorMessage(null)
    setMode(next)
  }

  async function run(action: () => Promise<ActionResult>, successMessage: string): Promise<void> {
    setErrorMessage(null)
    setIsSaving(true)
    try {
      const result = await action()
      if ('error' in result) {
        setErrorMessage(result.error)
        return
      }
      setMode(IDLE)
      toast(successMessage, 'success')
      startTransition(() => router.refresh())
    } catch (cause) {
      console.error('useCustomerAddresses: action failed', { customerId, cause })
      setErrorMessage(GENERIC_FAILURE_MESSAGE)
    } finally {
      setIsSaving(false)
    }
  }

  return {
    mode,
    errorMessage,
    isBusy: isSaving || isPending,
    openAdd: () => openMode({ type: 'adding' }),
    openEdit: (id: string) => openMode({ type: 'editing', id }),
    requestDelete: (id: string) => openMode({ type: 'confirming-delete', id }),
    cancel: () => openMode(IDLE),
    submitAdd: (text: string) =>
      run(() => addCustomerAddress(customerId, text), 'Address saved.'),
    submitEdit: (id: string, text: string) =>
      run(() => updateCustomerAddress(id, text), 'Address updated.'),
    confirmDelete: (id: string) =>
      run(() => deleteCustomerAddress(id), 'Address deleted.'),
  }
}

/** Return type of `useCustomerAddresses` — the props contract for row/editor
 * sub-components in `CustomerAddresses.tsx`. */
export type CustomerAddressesState = ReturnType<typeof useCustomerAddresses>
