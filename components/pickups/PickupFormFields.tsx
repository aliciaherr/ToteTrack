'use client'

import {
  type FieldErrors,
  type UseFormRegister,
  type UseFormSetValue,
  type UseFormWatch,
} from 'react-hook-form'
import { FieldRow, FORM_INPUT_CLASS } from '@/components/shared/formFields'
import { type PickupFormValues } from './pickupFormSchema'
import PickupAddressSelect from './PickupAddressSelect'
import type { CustomerSelectOption } from '@/db/queries/customers'

interface PickupFormFieldsProps {
  customers: CustomerSelectOption[]
  lockedCustomerId: string | null
  register: UseFormRegister<PickupFormValues>
  watch: UseFormWatch<PickupFormValues>
  setValue: UseFormSetValue<PickupFormValues>
  errors: FieldErrors<PickupFormValues>
  qtyError: string | null
}

function CustomerDropdown({
  customers,
  lockedCustomerId,
  register,
  error,
}: {
  customers: CustomerSelectOption[]
  lockedCustomerId: string | null
  register: UseFormRegister<PickupFormValues>
  error?: string
}) {
  if (lockedCustomerId) {
    const locked = customers.find((customer) => customer.id === lockedCustomerId)
    return (
      <FieldRow label="Customer">
        <input type="hidden" {...register('customer_id')} value={lockedCustomerId} readOnly />
        <div
          aria-label="Customer (pre-selected)"
          className={`${FORM_INPUT_CLASS} flex items-center bg-muted text-foreground`}
        >
          {locked?.company_name ?? 'Selected customer'}
        </div>
      </FieldRow>
    )
  }
  return (
    <FieldRow label="Customer" htmlFor="customer_id" error={error}>
      <select
        id="customer_id"
        {...register('customer_id', { required: 'Please choose a customer.' })}
        className={FORM_INPUT_CLASS}
      >
        <option value="">Select a customer…</option>
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.company_name}
          </option>
        ))}
      </select>
    </FieldRow>
  )
}

/**
 * The two tote counts, side by side. A pickup has no type dimension
 * (CONSTRAINT-25 — no rebottled/recon/new split, so no `QtyGrid`), just a
 * count per size. The cross-field "at least one" rule belongs to neither
 * field, so it renders once below the pair.
 */
function TotalCountFields({
  register,
  qtyError,
}: {
  register: UseFormRegister<PickupFormValues>
  qtyError: string | null
}) {
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-2 gap-3">
        <FieldRow label="275 gal totes" htmlFor="qty_275">
          <input
            id="qty_275"
            type="number"
            min={0}
            step={1}
            placeholder="0"
            {...register('qty_275')}
            className={FORM_INPUT_CLASS}
          />
        </FieldRow>
        <FieldRow label="330 gal totes" htmlFor="qty_330">
          <input
            id="qty_330"
            type="number"
            min={0}
            step={1}
            placeholder="0"
            {...register('qty_330')}
            className={FORM_INPUT_CLASS}
          />
        </FieldRow>
      </div>
      {qtyError && (
        <p data-testid="pickup-qty-error" className="text-xs text-destructive">
          {qtyError}
        </p>
      )}
    </div>
  )
}

/**
 * Field set for the pickup form: customer, the 275/330 counts, the optional
 * pickup date, the optional collection address and notes. There is no price,
 * PO number, backhaul flag or document — a pickup carries none of them
 * (CONSTRAINT-25).
 *
 * The address is the same saved-address picker the order form uses (shared
 * `AddressSelect`, bound here by `PickupAddressSelect`): choosing a customer
 * offers that customer's saved addresses as a dropdown with a "+ Add new
 * address" escape hatch. It sits directly below the customer dropdown, for the
 * same reason it does on the order form — picking a customer and its address
 * should be one motion. A typed address is still snapshotted on the row and
 * remembered: `createPickup` upserts it into the customer's address book
 * through the same `recordDeliveryAddressUsage` path (CONSTRAINT-21).
 */
export default function PickupFormFields({
  customers,
  lockedCustomerId,
  register,
  watch,
  setValue,
  errors,
  qtyError,
}: PickupFormFieldsProps) {
  // The picker only offers the selected customer's saved addresses; no customer
  // selected yet → empty list → free-text entry, exactly as on the order form.
  const watchedCustomerId = watch('customer_id')
  const selectedAddresses =
    customers.find((customer) => customer.id === watchedCustomerId)?.addresses ?? []
  return (
    <>
      <CustomerDropdown
        customers={customers}
        lockedCustomerId={lockedCustomerId}
        register={register}
        error={errors.customer_id?.message}
      />

      <PickupAddressSelect
        addresses={selectedAddresses}
        register={register}
        watch={watch}
        setValue={setValue}
        error={errors.address?.message}
      />

      <TotalCountFields register={register} qtyError={qtyError} />

      <FieldRow
        label="Pickup Date (optional)"
        htmlFor="pickup_date"
        error={errors.pickup_date?.message}
      >
        <input
          id="pickup_date"
          type="date"
          {...register('pickup_date')}
          className={FORM_INPUT_CLASS}
        />
      </FieldRow>

      <FieldRow label="Notes" htmlFor="notes">
        <textarea
          id="notes"
          rows={3}
          {...register('notes')}
          className={`${FORM_INPUT_CLASS} h-auto py-2`}
        />
      </FieldRow>
    </>
  )
}
