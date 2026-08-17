'use client'

import {
  type FieldErrors,
  type UseFormRegister,
  type UseFormSetValue,
  type UseFormWatch,
} from 'react-hook-form'
import { type OrderFormValues } from './orderFormSchema'
import type { CustomerSelectOption } from '@/db/queries/customers'
import { FieldRow, FORM_INPUT_CLASS } from '@/components/shared/formFields'
import AddressSelect from './AddressSelect'
import OrderContainerFields from './OrderContainerFields'
import OrderLogisticsFields from './OrderLogisticsFields'

interface OrderFormFieldsProps {
  customers: CustomerSelectOption[]
  lockedCustomerId: string | null
  register: UseFormRegister<OrderFormValues>
  watch: UseFormWatch<OrderFormValues>
  setValue: UseFormSetValue<OrderFormValues>
  errors: FieldErrors<OrderFormValues>
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
  register: UseFormRegister<OrderFormValues>
  error?: string
}) {
  if (lockedCustomerId) {
    const locked = customers.find((c) => c.id === lockedCustomerId)
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
 * Top-half fields for the order form: PO#, customer, delivery address picker
 * (directly below the customer so picking a customer and its address is one
 * motion — builder-requested after iPad verification), container size + type,
 * quantity, price, requested delivery date. Container + quantity + price
 * grids live in `OrderContainerFields`; remaining logistics fields
 * (customer-collects, backhaul, notes) live in `OrderLogisticsFields`. Splitting
 * keeps each file under CONSTRAINT-14's 80-line JSX cap.
 */
export default function OrderFormFields({
  customers,
  lockedCustomerId,
  register,
  watch,
  setValue,
  errors,
  qtyError,
}: OrderFormFieldsProps) {
  // The address picker only offers the selected customer's saved addresses
  // (Feature 14); no customer selected yet → empty list → free-text entry.
  const watchedCustomerId = watch('customer_id')
  const selectedAddresses =
    customers.find((customer) => customer.id === watchedCustomerId)?.addresses ?? []
  // Same conditional the old logistics-section placement had: customer-collects
  // orders carry no address, so the picker unmounts entirely (values persist
  // in form state, exactly as before).
  const customerCollects = watch('customer_collects')
  return (
    <>
      <FieldRow label="PO Number" htmlFor="po_number" error={errors.po_number?.message}>
        <input
          id="po_number"
          {...register('po_number', { required: 'PO number is required.' })}
          className={FORM_INPUT_CLASS}
          autoFocus
        />
      </FieldRow>

      <CustomerDropdown
        customers={customers}
        lockedCustomerId={lockedCustomerId}
        register={register}
        error={errors.customer_id?.message}
      />

      {!customerCollects && (
        <AddressSelect
          addresses={selectedAddresses}
          register={register}
          watch={watch}
          setValue={setValue}
          error={errors.delivery_address?.message}
        />
      )}

      <OrderContainerFields
        register={register}
        watch={watch}
        setValue={setValue}
        errors={errors}
        qtyError={qtyError}
      />

      <FieldRow
        label="Requested Delivery Date (optional)"
        htmlFor="requested_delivery_date"
        error={errors.requested_delivery_date?.message}
      >
        <input
          id="requested_delivery_date"
          type="date"
          {...register('requested_delivery_date')}
          className={FORM_INPUT_CLASS}
        />
      </FieldRow>

      <OrderLogisticsFields register={register} />
    </>
  )
}
