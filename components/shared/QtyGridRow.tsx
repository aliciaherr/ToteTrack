'use client'

import { cn } from '@/lib/utils'
import { DisplayCell, InputCell } from './QtyGridCells'
import {
  SIZE_COLS,
  cellKey,
  unitPriceKey,
  type QtyGridValues,
  type UnitPriceValues,
  type TypeKey,
} from './qtyGridValues'

// Subtle divider between the 3 type groups in the editable grid so the paired
// qty+price cells don't read as one undifferentiated column (input mode only).
const ROW_DIVIDER_CLASS = 'self-stretch border-b border-border pb-3'

/**
 * Renders one type row of the QtyGrid: a rowheader label plus a display/input
 * cell for each container size. Extracted from QtyGrid so the parent stays a
 * thin layout wrapper (CONSTRAINT-14). `onUnitPriceChange` is opt-in — pass it
 * (input mode only) to render the paired `$` unit-price input per cell.
 */
export function QtyGridRow({
  typeLabel,
  typeKey,
  isInput,
  showDivider,
  values,
  unitPrices,
  showEmptyAsDash,
  onCellChange,
  onUnitPriceChange,
}: {
  typeLabel: string
  typeKey: TypeKey
  isInput: boolean
  showDivider: boolean
  values: QtyGridValues
  unitPrices?: UnitPriceValues
  showEmptyAsDash: boolean
  onCellChange: (key: keyof QtyGridValues, next: number) => void
  onUnitPriceChange?: (key: keyof UnitPriceValues, next: string | null) => void
}) {
  const divide = showDivider ? ROW_DIVIDER_CLASS : ''
  return (
    <div role="row" className="contents">
      <div
        role="rowheader"
        className={cn(
          'flex items-center text-sm font-medium text-foreground pr-2 whitespace-nowrap',
          divide,
        )}
      >
        {typeLabel}
      </div>
      {SIZE_COLS.map(({ label: sizeLabel, sizeKey }) => {
        const key = cellKey(sizeKey, typeKey)
        const upKey = unitPriceKey(sizeKey, typeKey)
        const value = values[key]
        const unitPrice = unitPrices?.[upKey]
        const ariaLabel = `${sizeLabel} ${typeLabel} quantity`
        return (
          <div
            key={key}
            role="gridcell"
            className={cn('flex items-center justify-center min-h-[44px]', divide)}
          >
            {!isInput ? (
              <DisplayCell
                value={value}
                showEmptyAsDash={showEmptyAsDash}
                unitPrice={unitPrice}
              />
            ) : (
              <InputCell
                value={value}
                onChange={(next) => onCellChange(key, next)}
                ariaLabel={ariaLabel}
                unitPrice={unitPrice}
                onUnitPriceChange={
                  onUnitPriceChange ? (next) => onUnitPriceChange(upKey, next) : undefined
                }
                unitPriceAriaLabel={`${sizeLabel} ${typeLabel} unit price`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
