'use client'

import { formatCurrency } from '@/lib/format-currency'

// Mirrors QUANTITY_MAX in lib/actions/orders.validation.ts.
export const QTY_INPUT_MAX = 100_000

// Unit price is a per-tote dollar amount; cents precision is enough.
export const UNIT_PRICE_STEP = 0.01

export function clampQty(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  if (value > QTY_INPUT_MAX) return QTY_INPUT_MAX
  return Math.floor(value)
}

// A unit price counts as "present" only when it parses to a finite number.
// null / undefined / '' all fall back to the plain-qty rendering so display
// consumers that pass no prices (e.g. the volume overview) are unchanged.
function hasUnitPrice(unitPrice: UnitPrice): boolean {
  if (unitPrice === null || unitPrice === undefined || unitPrice === '') return false
  return Number.isFinite(Number(unitPrice))
}

export type UnitPrice = string | number | null | undefined

export function DisplayCell({
  value,
  showEmptyAsDash,
  unitPrice,
}: {
  value: number
  showEmptyAsDash: boolean
  unitPrice?: UnitPrice
}) {
  if (value === 0 && showEmptyAsDash) {
    return (
      <span className="text-muted-foreground" aria-label="No quantity">
        —
      </span>
    )
  }
  const label =
    value !== 0 && hasUnitPrice(unitPrice)
      ? `${value} / ${formatCurrency(unitPrice)}`
      : String(value)
  return <span className="font-semibold tabular-nums text-foreground">{label}</span>
}

const QTY_INPUT_CLASS =
  'w-full h-11 min-h-[44px] px-2 rounded-md border border-border bg-card text-center text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-primary'

export function InputCell({
  value,
  onChange,
  ariaLabel,
  unitPrice,
  onUnitPriceChange,
  unitPriceAriaLabel,
}: {
  value: number
  onChange: (next: number) => void
  ariaLabel: string
  unitPrice?: UnitPrice
  onUnitPriceChange?: (next: string | null) => void
  unitPriceAriaLabel?: string
}) {
  return (
    <div className="flex w-full flex-col gap-1">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={QTY_INPUT_MAX}
        step={1}
        value={value === 0 ? '' : String(value)}
        placeholder="0"
        aria-label={ariaLabel}
        onChange={(event) => {
          const raw = event.target.value
          if (raw === '') {
            onChange(0)
            return
          }
          onChange(clampQty(Number(raw)))
        }}
        className={QTY_INPUT_CLASS}
      />
      {onUnitPriceChange && (
        <div className="flex h-11 min-h-[44px] items-center justify-center gap-1 rounded-md border border-border bg-card focus-within:ring-2 focus-within:ring-primary">
          <span aria-hidden="true" className="text-sm text-muted-foreground">
            $
          </span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={UNIT_PRICE_STEP}
            value={unitPrice === null || unitPrice === undefined ? '' : String(unitPrice)}
            placeholder="0.00"
            aria-label={unitPriceAriaLabel}
            onChange={(event) => {
              const raw = event.target.value
              onUnitPriceChange(raw === '' ? null : raw)
            }}
            className="w-16 bg-transparent text-left text-base tabular-nums focus:outline-none"
          />
        </div>
      )}
    </div>
  )
}
