'use client'

import { type FieldErrors, type UseFormRegister } from 'react-hook-form'
import { FieldRow } from '@/components/orders/OrderFormFields'
import { FORM_INPUT_CLASS, type PickupFormValues } from './pickupFormSchema'
import type { CustomerSelectOption } from '@/db/queries/customers'

interface PickupFormFieldsProps {
  customers: CustomerSelectOption[]
  lockedCustomerId: string | null
  register: UseFormRegister<PickupFormValues>
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
 * The address is a free-text field rather than the order form's saved-address
 * picker: `AddressSelect` is typed against `OrderFormValues` and its
 * `delivery_address_id` bridge, which a pickup has no column for. A typed
 * address is still remembered — `createPickup` upserts it into the customer's
 * address book through the same `recordDeliveryAddressUsage` path.
 */
export default function PickupFormFields({
  customers,
  lockedCustomerId,
  register,
  errors,
  qtyError,
}: PickupFormFieldsProps) {
  return (
    <>
      <CustomerDropdown
        customers={customers}
        lockedCustomerId={lockedCustomerId}
        register={register}
        error={errors.customer_id?.message}
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

      <FieldRow label="Collection Address (optional)" htmlFor="address">
        <textarea
          id="address"
          rows={2}
          {...register('address')}
          className={`${FORM_INPUT_CLASS} h-auto py-2`}
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
