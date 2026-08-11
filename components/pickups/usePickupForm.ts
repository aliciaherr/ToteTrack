'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  detailToPickupFormValues,
  formValuesToCreatePickupInput,
  formValuesToUpdatePickupInput,
  totalPickupQuantity,
  type PickupFormValues,
} from './pickupFormSchema'
import { createPickup, updatePickup } from '@/lib/actions/pickups'
import { useToast } from '@/lib/hooks/useToast'
import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'
import type { PickupDetail } from '@/db/queries/pickups'

interface PickupFormOptions {
  mode: 'create' | 'edit'
  initialDetail?: PickupDetail | null
  lockedCustomerId: string | null
  /** `yyyy-MM-dd` pre-filled into the date field in create mode. */
  initialPickupDate?: string | null
  onSaved: () => void
}

/**
 * Client-side mirror of the server's `requireAtLeastOneQty` superRefine
 * (lib/actions/pickups.validation.ts): a pickup that collects nothing is not a
 * pickup. Surfaced through the dedicated `qtyError` channel rather than
 * react-hook-form's `setError` because the rule spans both count fields and
 * belongs to neither — the same channel `useOrderForm` uses for its own
 * cross-field quantity rule.
 */
function firstClientValidationError(values: PickupFormValues): string | null {
  if (totalPickupQuantity(values) <= 0) return 'At least one quantity is required.'
  return null
}

interface SubmitDeps {
  isEdit: boolean
  pickupId: string | null
  mode: 'create' | 'edit'
  toast: (message: string, tone: 'success' | 'error') => void
  onSaved: () => void
  setServerError: (message: string | null) => void
  setQtyError: (message: string | null) => void
}

/**
 * Builds the form's submit handler: the client validation mirror, then the
 * create/update action. Every failure path surfaces — an `{ error }` result
 * inline via `serverError`, and a transport rejection (offline, stale action
 * id after a deploy) as `GENERIC_FAILURE_MESSAGE` instead of escaping
 * react-hook-form's `handleSubmit` unseen (EH-01).
 */
function makeSubmitHandler(deps: SubmitDeps) {
  return async (values: PickupFormValues): Promise<void> => {
    deps.setServerError(null)
    deps.setQtyError(null)
    const clientError = firstClientValidationError(values)
    if (clientError) {
      deps.setQtyError(clientError)
      return
    }
    let result: { id: string } | { success: true } | { error: string }
    try {
      result =
        deps.isEdit && deps.pickupId
          ? await updatePickup(deps.pickupId, formValuesToUpdatePickupInput(values))
          : await createPickup(formValuesToCreatePickupInput(values))
    } catch (cause) {
      console.error('usePickupForm: submit failed', {
        mode: deps.mode,
        pickupId: deps.pickupId,
        cause,
      })
      deps.setServerError(GENERIC_FAILURE_MESSAGE)
      return
    }
    if ('error' in result) {
      deps.setServerError(result.error)
      return
    }
    deps.toast(deps.isEdit ? 'Pickup updated.' : 'Pickup created.', 'success')
    deps.onSaved()
  }
}

/**
 * Form state and submit flow behind `PickupForm`. Wires react-hook-form to the
 * module-level submit factory above and owns the two error channels.
 * @param options Mode, the edit-mode detail row, the locked customer id from a
 *   `?customerId=` deep link, and the parent's post-save callback.
 * @returns The react-hook-form instance, the submit handler, both error
 *   channels (`serverError` for action failures, `qtyError` for the
 *   cross-field quantity rule) and whether the form is in edit mode.
 */
export function usePickupForm(options: PickupFormOptions) {
  const { mode, initialDetail, lockedCustomerId, initialPickupDate, onSaved } = options
  const { toast } = useToast()
  const [serverError, setServerError] = useState<string | null>(null)
  const [qtyError, setQtyError] = useState<string | null>(null)
  const isEdit = mode === 'edit' && Boolean(initialDetail)
  const pickupId = initialDetail?.id ?? null

  const form = useForm<PickupFormValues>({
    defaultValues: detailToPickupFormValues(initialDetail, lockedCustomerId, initialPickupDate),
    mode: 'onSubmit',
  })

  const onSubmit = makeSubmitHandler({
    isEdit,
    pickupId,
    mode,
    toast,
    onSaved,
    setServerError,
    setQtyError,
  })

  return { form, onSubmit, serverError, qtyError, isEdit }
}
