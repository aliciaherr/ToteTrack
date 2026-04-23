'use client'

import {
  type FieldErrors,
  type UseFormRegister,
} from 'react-hook-form'
import { FORM_INPUT_CLASS, type OrderFormValues } from './orderFormSchema'
import { FieldRow } from './OrderFormFields'

interface OrderContainerFieldsProps {
  register: UseFormRegister<OrderFormValues>
  errors: FieldErrors<OrderFormValues>
}

// Exact max of the `price` column's `numeric(10, 2)` domain. Kept in sync
// with MAX_PRICE_USD in lib/actions/orders.ts — client-side mirroring is the
// project pattern since action files are `'use server'` (their value exports
// are not importable from client bundles).
const MAX_PRICE_USD = 9_999_999.99
const MAX_PRICE_MESSAGE = `Price must be less than $${MAX_PRICE_USD.toLocaleString('en-US')}.`

function validatePositiveInt(value: string): true | string {
  const parsed = Number.parseInt(value.trim(), 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 'Quantity must be at least 1.'
  return true
}

function validatePositivePrice(value: string): true | string {
  const parsed = Number.parseFloat(value.trim())
  if (!Number.isFinite(parsed) || parsed <= 0) return 'Price must be greater than $0.'
  if (parsed > MAX_PRICE_USD) return MAX_PRICE_MESSAGE
  return true
}

/**
 * Container + quantity + price field cluster for the order form. Size/type
 * selects are paired; quantity/price are paired. Split out of OrderFormFields
 * to keep the parent under CONSTRAINT-14's 80-line JSX cap.
 */
export default function OrderContainerFields({
  register,
  errors,
}: OrderContainerFieldsProps) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldRow label="Container Size" htmlFor="container_size">
          <select id="container_size" {...register('container_size')} className={FORM_INPUT_CLASS}>
            <option value="275">275 gal</option>
            <option value="330">330 gal</option>
          </select>
        </FieldRow>
        <FieldRow label="Container Type" htmlFor="container_type">
          <select id="container_type" {...register('container_type')} className={FORM_INPUT_CLASS}>
            <option value="rebottled">Rebottled</option>
            <option value="reconditioned">Reconditioned</option>
            <option value="brand_new">Brand New</option>
          </select>
        </FieldRow>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldRow label="Quantity" htmlFor="quantity" error={errors.quantity?.message}>
          <input
            id="quantity"
            type="number"
            min={1}
            step={1}
            {...register('quantity', { validate: validatePositiveInt })}
            className={FORM_INPUT_CLASS}
          />
        </FieldRow>
        <FieldRow label="Price (USD)" htmlFor="price" error={errors.price?.message}>
          <input
            id="price"
            type="number"
            min={0}
            step="0.01"
            {...register('price', { validate: validatePositivePrice })}
            className={FORM_INPUT_CLASS}
          />
        </FieldRow>
      </div>
    </>
  )
}
