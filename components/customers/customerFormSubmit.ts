'use client'

import type { UseFormReturn } from 'react-hook-form'
import { type CustomerFormValues, formValuesToInput } from './customerFormSchema'
import { createCustomer, updateCustomer } from '@/lib/actions/customers'
import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'

/**
 * Everything the submit handler reads and writes through, so it can live at
 * module level instead of nested inside `CustomerForm` — nested function
 * bodies count toward the enclosing component's length, and the try/catch
 * below took that component past CONSTRAINT-14's 80-line cap. Same `*Deps`
 * shape as `useInvoiceSubmit`'s `RunSubmitDeps` and `DeleteCustomerDialog`'s
 * `DeleteDeps`.
 */
export interface CustomerSubmitDeps {
  isEdit: boolean
  customerId: string | null
  form: UseFormReturn<CustomerFormValues>
  toast: (message: string, tone: 'success' | 'error') => void
  onSaved: () => void
  setServerError: (message: string | null) => void
}

/**
 * Builds `CustomerForm`'s submit handler: the client mirror of the server's
 * exactly-one-primary-contact rule, then the create/update action. Every
 * failure path surfaces — an `{ error }` result inline via `serverError`, and
 * a transport rejection (offline, stale action id after a deploy) as
 * `GENERIC_FAILURE_MESSAGE` instead of escaping react-hook-form's
 * `handleSubmit` unseen (EH-01). Copied from `makeSubmitHandler` in
 * `components/orders/useOrderForm.ts`.
 */
export function makeCustomerSubmitHandler(deps: CustomerSubmitDeps) {
  return async (values: CustomerFormValues): Promise<void> => {
    deps.setServerError(null)
    const primaries = values.contacts.filter((c) => c.is_primary).length
    if (primaries !== 1) {
      deps.form.setError('contacts', {
        type: 'manual',
        message: 'Exactly one contact must be marked as primary.',
      })
      return
    }
    deps.form.clearErrors('contacts')
    const input = formValuesToInput(values)
    let result: { id: string } | { success: true } | { error: string }
    try {
      result = deps.isEdit && deps.customerId
        ? await updateCustomer(deps.customerId, input)
        : await createCustomer(input)
    } catch (cause) {
      // Identifiers and the cause only. This form carries customer contact
      // names, emails and phone numbers; none of them may reach the console
      // or a log sink (SEC-01), so `input` and `values` are never logged.
      console.error('CustomerForm: submit failed in transit', {
        mode: deps.isEdit ? 'edit' : 'create',
        customerId: deps.customerId,
        cause,
      })
      deps.setServerError(GENERIC_FAILURE_MESSAGE)
      return
    }
    if ('error' in result) {
      deps.setServerError(result.error)
      return
    }
    deps.toast(deps.isEdit ? 'Customer updated.' : 'Customer created.', 'success')
    deps.onSaved()
  }
}
