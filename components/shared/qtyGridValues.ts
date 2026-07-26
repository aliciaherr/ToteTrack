// Value/type/helper module for the PO quantity grid (Feature 9/10). Holds the
// cross-surface data contract and formatting helpers that used to live in
// QtyGrid.tsx, so component files stay presentation-only (CQ-03). No JSX here —
// safe to import from any surface (tables, widgets, schemas) without pulling in
// the client component.

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

// Optional, opt-in companion to QtyGridValues (Feature 10). Each cell's
// per-tote unit price. Kept as `string | number | null` so the value can flow
// straight from a numeric DB column, a form string, or an unset (null) cell.
export interface UnitPriceValues {
  unit_price_275_recon: string | number | null
  unit_price_275_rebot: string | number | null
  unit_price_275_new: string | number | null
  unit_price_330_recon: string | number | null
  unit_price_330_rebot: string | number | null
  unit_price_330_new: string | number | null
}

/** The two fixed container sizes (gallons) in the PO model. */
export type SizeKey = '275' | '330'
/** The three fixed container types in the PO model. */
export type TypeKey = 'rebot' | 'recon' | 'new'

/** Column definitions for the grid: one per container size, left-to-right. */
export const SIZE_COLS: ReadonlyArray<{ label: string; sizeKey: SizeKey }> = [
  { label: '275 gal', sizeKey: '275' },
  { label: '330 gal', sizeKey: '330' },
]

// Order matches db/schema/enums.ts and existing VolumeOverview presentation.
/** Row definitions for the grid: one per container type, top-to-bottom. */
export const TYPE_ROWS: ReadonlyArray<{ label: string; typeKey: TypeKey }> = [
  { label: 'Rebottled', typeKey: 'rebot' },
  { label: 'Reconditioned', typeKey: 'recon' },
  { label: 'Brand New', typeKey: 'new' },
]

/** Builds the `qty_‹size›_‹type›` key into QtyGridValues for a cell. */
export function cellKey(sizeKey: SizeKey, typeKey: TypeKey): keyof QtyGridValues {
  return `qty_${sizeKey}_${typeKey}` as keyof QtyGridValues
}

/** Builds the `unit_price_‹size›_‹type›` key into UnitPriceValues for a cell. */
export function unitPriceKey(sizeKey: SizeKey, typeKey: TypeKey): keyof UnitPriceValues {
  return `unit_price_${sizeKey}_${typeKey}` as keyof UnitPriceValues
}

/** All-zero quantities — the empty/default state for the 6 PO cells. */
export const ZERO_QTY_VALUES: QtyGridValues = {
  qty_275_recon: 0,
  qty_275_rebot: 0,
  qty_275_new: 0,
  qty_330_recon: 0,
  qty_330_rebot: 0,
  qty_330_new: 0,
}

/** All-unset (null) unit prices — the empty/default state for the 6 PO cells. */
export const ZERO_UNIT_PRICE_VALUES: UnitPriceValues = {
  unit_price_275_recon: null,
  unit_price_275_rebot: null,
  unit_price_275_new: null,
  unit_price_330_recon: null,
  unit_price_330_rebot: null,
  unit_price_330_new: null,
}

/**
 * Sums the three type cells (recon + rebot + new) for one container size.
 * Used by every PO list surface (orders table, dashboard Open Orders widget,
 * customer Order History rows, invoice detail PO rows, generate-invoice
 * checklist) so the per-size totals are consistent everywhere
 * (CONSTRAINT-18 / Q7).
 */
export function sumPoSize(values: QtyGridValues, size: SizeKey): number {
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
