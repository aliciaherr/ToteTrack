'use client'

import type { UseFormRegisterReturn } from 'react-hook-form'
import { FieldRow, FORM_INPUT_CLASS } from './formFields'
import {
  ADD_NEW_VALUE,
  CURRENT_VALUE,
  useAddressSelect,
  type AddressFieldBridge,
} from './useAddressSelect'
import { DELIVERY_ADDRESS_MAX } from '@/lib/actions/orders.validation'
import type { CustomerAddressOption } from '@/db/queries/customers'

interface AddressSelectProps {
  /** The selected customer's saved addresses, MRU-first (pre-sorted by the query). */
  addresses: CustomerAddressOption[]
  /** Bridge onto the owning form's address / address-id fields. */
  bridge: AddressFieldBridge
  /**
   * The already-registered address field. Registration stays with the caller
   * so each form keeps its own field name and its own inline `validate` rule —
   * an order needs an address unless the customer collects, a pickup never
   * needs one at all.
   */
  registered: UseFormRegisterReturn
  /** Visible label, e.g. "Delivery Address" / "Collection Address (optional)". */
  label: string
  /** DOM id tying the label to whichever control the active mode renders. */
  fieldId: string
  /** Validation message rendered under the field. */
  error?: string
}

function SavedAddressPicker({
  value,
  snapshot,
  addresses,
  onSelect,
  label,
  fieldId,
  error,
  hiddenInput,
}: {
  value: string
  snapshot: string | null
  addresses: CustomerAddressOption[]
  onSelect: (value: string) => void
  label: string
  fieldId: string
  error?: string
  hiddenInput: React.ReactNode
}) {
  return (
    <FieldRow label={label} htmlFor={fieldId} error={error}>
      {hiddenInput}
      <select
        id={fieldId}
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
  label,
  fieldId,
  error,
  canReturn,
  onBack,
}: {
  registered: UseFormRegisterReturn
  label: string
  fieldId: string
  error?: string
  canReturn: boolean
  onBack: () => void
}) {
  return (
    <FieldRow label={label} htmlFor={fieldId} error={error}>
      <textarea
        id={fieldId}
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
 * Saved-address picker, shared by the order and pickup forms (Feature 14, and
 * the Feature 15 pickup form on builder request). Two modes, run by
 * `useAddressSelect`: a dropdown of the selected customer's saved addresses
 * (MRU-first) plus a "+ Add new address" option, or a free-text textarea for a
 * fresh address. Picking a saved address writes its text into the form's
 * address field and its row id into the address-id field; typed text keeps the
 * id null. A customer with zero saved addresses goes straight to the textarea.
 * Edit mode: the row's stored snapshot (which may match no saved row) shows as
 * a "Current:" option with the id kept null, so an unchanged resubmit never
 * links or duplicates an address-book row (CONSTRAINT-21).
 *
 * In dropdown mode the caller's registered field rides on a hidden input, so
 * submit-time validation and the error channel keep working in both modes.
 */
export default function AddressSelect({
  addresses,
  bridge,
  registered,
  label,
  fieldId,
  error,
}: AddressSelectProps) {
  const state = useAddressSelect({ addresses, bridge })

  if (state.isCustom) {
    return (
      <NewAddressEntry
        registered={registered}
        label={label}
        fieldId={fieldId}
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
      label={label}
      fieldId={fieldId}
      error={error}
      hiddenInput={<input type="hidden" {...registered} />}
    />
  )
}
