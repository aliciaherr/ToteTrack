'use client'

import { cn } from '@/lib/utils'
import { QtyGridRow } from './QtyGridRow'
import {
  SIZE_COLS,
  TYPE_ROWS,
  ZERO_UNIT_PRICE_VALUES,
  type QtyGridValues,
  type UnitPriceValues,
} from './qtyGridValues'

interface QtyGridDisplayProps {
  mode: 'display'
  values: QtyGridValues
  // When supplied, non-zero cells render `‹qty› / $‹unit›`; omit for the
  // legacy plain-number rendering. Purely additive — existing consumers unaffected.
  unitPrices?: UnitPriceValues
  showEmptyAsDash?: boolean
  className?: string
}

interface QtyGridInputProps {
  mode: 'input'
  values: QtyGridValues
  onChange: (next: QtyGridValues) => void
  // Unit-price editing is opt-in: pass `onUnitPriceChange` to render the
  // paired `$` input. Prices flow through this SEPARATE callback, never the
  // qty `onChange`, so the existing qty contract is untouched.
  unitPrices?: UnitPriceValues
  onUnitPriceChange?: (next: UnitPriceValues) => void
  className?: string
}

type QtyGridProps = QtyGridDisplayProps | QtyGridInputProps

/**
 * 3×2 quantity grid for the 6 fixed (size × type) PO combinations
 * (CONSTRAINT-09). Two modes:
 *  - `display`: read-only — renders qty as a number, or `—` when 0 and
 *    `showEmptyAsDash` is true (default). When `unitPrices` is supplied, a
 *    non-zero cell renders `‹qty› / $‹unit›` instead of the bare number.
 *  - `input`: editable — numeric qty inputs (≥ 0 integers, capped). Pass
 *    `onUnitPriceChange` to also render a paired `$` unit-price input per cell.
 *
 * Layout: rows = Rebottled / Reconditioned / Brand New; columns = 275 gal
 * / 330 gal. Each cell is ≥ 44px tall to satisfy the iPad-touch standard.
 */
export function QtyGrid(props: QtyGridProps) {
  const showEmptyAsDash =
    props.mode === 'display' ? props.showEmptyAsDash ?? true : false

  function handleCellChange(key: keyof QtyGridValues, next: number) {
    if (props.mode !== 'input') return
    props.onChange({ ...props.values, [key]: next })
  }

  function handleUnitPriceChange(key: keyof UnitPriceValues, next: string | null) {
    if (props.mode !== 'input' || !props.onUnitPriceChange) return
    const base = props.unitPrices ?? ZERO_UNIT_PRICE_VALUES
    props.onUnitPriceChange({ ...base, [key]: next })
  }

  const rowUnitPriceChange =
    props.mode === 'input' && props.onUnitPriceChange ? handleUnitPriceChange : undefined

  return (
    <div
      role="grid"
      aria-label="Quantities by container size and type"
      className={cn(
        'grid grid-cols-[auto_repeat(2,minmax(0,1fr))] gap-2 items-center',
        props.className,
      )}
    >
      <div role="presentation" />
      {SIZE_COLS.map(({ label, sizeKey }) => (
        <div
          key={`header-${sizeKey}`}
          role="columnheader"
          className="text-xs uppercase tracking-wide text-muted-foreground text-center px-1"
        >
          {label}
        </div>
      ))}

      {TYPE_ROWS.map(({ label: typeLabel, typeKey }, rowIndex) => (
        <QtyGridRow
          key={typeKey}
          typeLabel={typeLabel}
          typeKey={typeKey}
          isInput={props.mode === 'input'}
          showDivider={props.mode === 'input' && rowIndex < TYPE_ROWS.length - 1}
          values={props.values}
          unitPrices={props.unitPrices}
          showEmptyAsDash={showEmptyAsDash}
          onCellChange={handleCellChange}
          onUnitPriceChange={rowUnitPriceChange}
        />
      ))}
    </div>
  )
}
