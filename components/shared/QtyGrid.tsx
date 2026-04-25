'use client'

import { cn } from '@/lib/utils'

// 6 keys match orders-table columns exactly so the component can be wired
// directly to query results / form state without remapping (Feature 9).
export interface QtyGridValues {
  qty_275_recon: number
  qty_275_rebot: number
  qty_275_new: number
  qty_330_recon: number
  qty_330_rebot: number
  qty_330_new: number
}

interface QtyGridDisplayProps {
  mode: 'display'
  values: QtyGridValues
  showEmptyAsDash?: boolean
  className?: string
}

interface QtyGridInputProps {
  mode: 'input'
  values: QtyGridValues
  onChange: (next: QtyGridValues) => void
  className?: string
}

type QtyGridProps = QtyGridDisplayProps | QtyGridInputProps

// Mirrors QUANTITY_MAX in lib/actions/orders.validation.ts.
const QTY_INPUT_MAX = 100_000

const SIZE_ROWS: ReadonlyArray<{ label: string; sizeKey: '275' | '330' }> = [
  { label: '275 gal', sizeKey: '275' },
  { label: '330 gal', sizeKey: '330' },
]

// Order matches db/schema/enums.ts and existing VolumeOverview presentation.
const TYPE_COLS: ReadonlyArray<{ label: string; typeKey: 'rebot' | 'recon' | 'new' }> = [
  { label: 'Rebottled', typeKey: 'rebot' },
  { label: 'Reconditioned', typeKey: 'recon' },
  { label: 'Brand New', typeKey: 'new' },
]

function cellKey(
  sizeKey: '275' | '330',
  typeKey: 'rebot' | 'recon' | 'new',
): keyof QtyGridValues {
  return `qty_${sizeKey}_${typeKey}` as keyof QtyGridValues
}

function clampQty(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  if (value > QTY_INPUT_MAX) return QTY_INPUT_MAX
  return Math.floor(value)
}

function DisplayCell({
  value,
  showEmptyAsDash,
}: {
  value: number
  showEmptyAsDash: boolean
}) {
  if (value === 0 && showEmptyAsDash) {
    return (
      <span className="text-muted-foreground" aria-label="No quantity">
        —
      </span>
    )
  }
  return <span className="font-semibold tabular-nums text-foreground">{value}</span>
}

function InputCell({
  value,
  onChange,
  ariaLabel,
}: {
  value: number
  onChange: (next: number) => void
  ariaLabel: string
}) {
  return (
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
        const parsed = Number(raw)
        onChange(clampQty(parsed))
      }}
      className="w-full h-11 min-h-[44px] px-2 rounded-md border border-border bg-card text-center text-base tabular-nums focus:outline-none focus:ring-2 focus:ring-primary"
    />
  )
}

/**
 * 2×3 quantity grid for the 6 fixed (size × type) PO combinations
 * (CONSTRAINT-09). Two modes:
 *  - `display`: read-only — renders qty as a number, or `—` when 0 and
 *    `showEmptyAsDash` is true (default). Used by OrderDetail and any list
 *    surface that wants the same visual.
 *  - `input`: editable — renders numeric inputs (≥ 0 integers, capped at
 *    QTY_INPUT_MAX). Controlled component: `onChange` receives the full
 *    updated `QtyGridValues` object on every keystroke.
 *
 * Layout: rows = 275 gal / 330 gal; columns = Rebottled / Reconditioned /
 * Brand New. Each cell is ≥ 44px tall to satisfy the project iPad-touch
 * standard.
 */
export function QtyGrid(props: QtyGridProps) {
  const showEmptyAsDash =
    props.mode === 'display' ? props.showEmptyAsDash ?? true : false

  function handleCellChange(key: keyof QtyGridValues, next: number) {
    if (props.mode !== 'input') return
    props.onChange({ ...props.values, [key]: next })
  }

  return (
    <div
      role="grid"
      aria-label="Quantities by container size and type"
      className={cn(
        'grid grid-cols-[auto_repeat(3,minmax(0,1fr))] gap-2 items-center',
        props.className,
      )}
    >
      <div role="presentation" />
      {TYPE_COLS.map(({ label, typeKey }) => (
        <div
          key={`header-${typeKey}`}
          role="columnheader"
          className="text-xs uppercase tracking-wide text-muted-foreground text-center px-1"
        >
          {label}
        </div>
      ))}

      {SIZE_ROWS.map(({ label: sizeLabel, sizeKey }) => (
        <div key={sizeKey} role="row" className="contents">
          <div
            role="rowheader"
            className="text-sm font-medium text-foreground pr-2 whitespace-nowrap"
          >
            {sizeLabel}
          </div>
          {TYPE_COLS.map(({ label: typeLabel, typeKey }) => {
            const key = cellKey(sizeKey, typeKey)
            const value = props.values[key]
            const ariaLabel = `${sizeLabel} ${typeLabel} quantity`
            return (
              <div
                key={key}
                role="gridcell"
                className="flex items-center justify-center min-h-[44px]"
              >
                {props.mode === 'display' ? (
                  <DisplayCell value={value} showEmptyAsDash={showEmptyAsDash} />
                ) : (
                  <InputCell
                    value={value}
                    onChange={(next) => handleCellChange(key, next)}
                    ariaLabel={ariaLabel}
                  />
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export const ZERO_QTY_VALUES: QtyGridValues = {
  qty_275_recon: 0,
  qty_275_rebot: 0,
  qty_275_new: 0,
  qty_330_recon: 0,
  qty_330_rebot: 0,
  qty_330_new: 0,
}

/**
 * Sums the three type cells (recon + rebot + new) for one container size.
 * Used by every PO list surface (orders table, dashboard Open Orders widget,
 * customer Order History rows, invoice detail PO rows, generate-invoice
 * checklist) so the per-size totals are consistent everywhere
 * (CONSTRAINT-18 / Q7).
 */
export function sumPoSize(values: QtyGridValues, size: '275' | '330'): number {
  if (size === '275') {
    return values.qty_275_recon + values.qty_275_rebot + values.qty_275_new
  }
  return values.qty_330_recon + values.qty_330_rebot + values.qty_330_new
}

/**
 * Formats a per-size or per-cell quantity for display in PO list surfaces:
 * `0` renders as the em dash `—` so empty buckets visually disappear; any
 * positive integer renders as the integer itself. Mirrors the QtyGrid
 * `display` mode em-dash behaviour for consistency across surfaces that
 * use the sums rather than the full grid.
 */
export function formatPoTotal(total: number): string {
  return total === 0 ? '—' : String(total)
}
