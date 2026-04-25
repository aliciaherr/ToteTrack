'use client'

import {
  type FieldErrors,
  type UseFormRegister,
  type UseFormSetValue,
  type UseFormWatch,
} from 'react-hook-form'
import { FORM_INPUT_CLASS, type OrderFormValues } from './orderFormSchema'
import { FieldRow } from './OrderFormFields'
import { QtyGrid, type QtyGridValues } from '@/components/shared/QtyGrid'

interface OrderContainerFieldsProps {
  register: UseFormRegister<OrderFormValues>
  watch: UseFormWatch<OrderFormValues>
  setValue: UseFormSetValue<OrderFormValues>
  errors: FieldErrors<OrderFormValues>
  qtyError: string | null
}

// Exact max of the `price` column's `numeric(10, 2)` domain. Kept in sync
// with MAX_PRICE_USD in lib/actions/orders.validation.ts.
const MAX_PRICE_USD = 9_999_999.99
const MAX_PRICE_MESSAGE = `Price must be less than $${MAX_PRICE_USD.toLocaleString('en-US')}.`

const QTY_KEYS = [
  'qty_275_recon',
  'qty_275_rebot',
  'qty_275_new',
  'qty_330_recon',
  'qty_330_rebot',
  'qty_330_new',
] as const satisfies ReadonlyArray<keyof QtyGridValues>

function validatePositivePrice(value: string): true | string {
  const parsed = Number.parseFloat(value.trim())
  if (!Number.isFinite(parsed) || parsed <= 0) return 'Price must be greater than $0.'
  if (parsed > MAX_PRICE_USD) return MAX_PRICE_MESSAGE
  return true
}

/**
 * Quantity grid + price field cluster for the order form. The grid renders
 * the 6 fixed (size × type) cells via `QtyGrid` in input mode; the
 * `qty_*` form fields are bridged via watch/setValue. Price stays a single
 * user-entered total below the grid. Split out of OrderFormFields to keep
 * the parent under CONSTRAINT-14's 80-line JSX cap.
 *
 * The at-least-one-quantity invariant is enforced at form-submit time by
 * the parent OrderForm (see `totalQuantity` in orderFormSchema.ts), not
 * inline on each cell — a per-cell ≥ 1 rule would forbid the legitimate
 * "0 in this combo, qty in another" cases that are the whole point of
 * Feature 9.
 */
export default function OrderContainerFields({
  register,
  watch,
  setValue,
  errors,
  qtyError,
}: OrderContainerFieldsProps) {
  const values: QtyGridValues = {
    qty_275_recon: watch('qty_275_recon'),
    qty_275_rebot: watch('qty_275_rebot'),
    qty_275_new: watch('qty_275_new'),
    qty_330_recon: watch('qty_330_recon'),
    qty_330_rebot: watch('qty_330_rebot'),
    qty_330_new: watch('qty_330_new'),
  }

  function handleGridChange(next: QtyGridValues) {
    for (const key of QTY_KEYS) {
      if (values[key] !== next[key]) {
        setValue(key, next[key], { shouldDirty: true, shouldValidate: false })
      }
    }
  }

  // The qty error is owned by OrderForm (state, not react-hook-form errors)
  // and threaded down here. The grid is bridged via setValue/watch (not
  // standard register), so react-hook-form's setError doesn't reliably
  // notify subscribers of these programmatically-managed fields.
  return (
    <>
      <FieldRow label="Quantities (totes per combo)">
        <QtyGrid mode="input" values={values} onChange={handleGridChange} />
        {qtyError && (
          <p data-testid="qty-error" className="text-xs text-destructive mt-1">
            {qtyError}
          </p>
        )}
      </FieldRow>

      <FieldRow label="Total Price (USD)" htmlFor="price" error={errors.price?.message}>
        <input
          id="price"
          type="number"
          min={0}
          step="0.01"
          {...register('price', { validate: validatePositivePrice })}
          className={FORM_INPUT_CLASS}
        />
      </FieldRow>
    </>
  )
}
