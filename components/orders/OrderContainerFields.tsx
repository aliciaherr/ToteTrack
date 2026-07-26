'use client'

import {
  type FieldErrors,
  type UseFormRegister,
  type UseFormSetValue,
  type UseFormWatch,
} from 'react-hook-form'
import { FORM_INPUT_CLASS, computeFormTotal, type OrderFormValues } from './orderFormSchema'
import { FieldRow } from './OrderFormFields'
import { QtyGrid } from '@/components/shared/QtyGrid'
import {
  type QtyGridValues,
  type UnitPriceValues,
} from '@/components/shared/qtyGridValues'
import { formatCurrency } from '@/lib/format-currency'

interface OrderContainerFieldsProps {
  register: UseFormRegister<OrderFormValues>
  watch: UseFormWatch<OrderFormValues>
  setValue: UseFormSetValue<OrderFormValues>
  errors: FieldErrors<OrderFormValues>
  qtyError: string | null
}

const QTY_KEYS = [
  'qty_275_recon',
  'qty_275_rebot',
  'qty_275_new',
  'qty_330_recon',
  'qty_330_rebot',
  'qty_330_new',
] as const satisfies ReadonlyArray<keyof QtyGridValues>

const UNIT_PRICE_KEYS = [
  'unit_price_275_recon',
  'unit_price_275_rebot',
  'unit_price_275_new',
  'unit_price_330_recon',
  'unit_price_330_rebot',
  'unit_price_330_new',
] as const satisfies ReadonlyArray<keyof UnitPriceValues>

/**
 * Quantity grid + derived-total cluster for the order form. The grid renders
 * the 6 fixed (size × type) cells via `QtyGrid` in input mode with a paired
 * per-cell `$` unit-price input (Feature 10); both the `qty_*` and
 * `unit_price_*` form fields are bridged via watch/setValue. The total price
 * is NOT an input — it is a read-only, live-computed preview of the
 * server-owned Σ(qty × unit price) so the salesperson always sees the same
 * number the server will persist. Split out of OrderFormFields to keep the
 * parent under CONSTRAINT-14's 80-line JSX cap.
 *
 * The at-least-one-quantity invariant and the qty↔unit-price coupling rule are
 * both enforced at form-submit time by the parent OrderForm (see
 * `totalQuantity` / `firstUnitPriceCouplingError` in orderFormSchema.ts), not
 * inline on each cell — a per-cell rule would forbid the legitimate "0 in this
 * combo, qty in another" cases that are the whole point of Feature 9.
 */
export default function OrderContainerFields({
  watch,
  setValue,
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

  const unitPrices: UnitPriceValues = {
    unit_price_275_recon: watch('unit_price_275_recon'),
    unit_price_275_rebot: watch('unit_price_275_rebot'),
    unit_price_275_new: watch('unit_price_275_new'),
    unit_price_330_recon: watch('unit_price_330_recon'),
    unit_price_330_rebot: watch('unit_price_330_rebot'),
    unit_price_330_new: watch('unit_price_330_new'),
  }

  function handleGridChange(next: QtyGridValues) {
    for (const key of QTY_KEYS) {
      if (values[key] !== next[key]) {
        setValue(key, next[key], { shouldDirty: true, shouldValidate: false })
      }
    }
  }

  function handleUnitPriceChange(next: UnitPriceValues) {
    for (const key of UNIT_PRICE_KEYS) {
      if (unitPrices[key] !== next[key]) {
        // QtyGrid emits `string | null`; the form field type matches.
        setValue(key, (next[key] ?? null) as string | null, {
          shouldDirty: true,
          shouldValidate: false,
        })
      }
    }
  }

  const total = computeFormTotal({ ...values, ...unitPrices })

  // The qty/coupling error is owned by OrderForm (state, not react-hook-form
  // errors) and threaded down here. The grid is bridged via setValue/watch
  // (not standard register), so react-hook-form's setError doesn't reliably
  // notify subscribers of these programmatically-managed fields.
  return (
    <>
      <FieldRow label="Quantities & unit prices (per combo)">
        <QtyGrid
          mode="input"
          values={values}
          onChange={handleGridChange}
          unitPrices={unitPrices}
          onUnitPriceChange={handleUnitPriceChange}
        />
        {qtyError && (
          <p data-testid="qty-error" className="text-xs text-destructive mt-1">
            {qtyError}
          </p>
        )}
      </FieldRow>

      <FieldRow label="Total Price (USD)">
        <div
          aria-label="Total Price"
          className={`${FORM_INPUT_CLASS} flex items-center bg-muted font-semibold tabular-nums text-foreground`}
        >
          {formatCurrency(total)}
        </div>
      </FieldRow>
    </>
  )
}
