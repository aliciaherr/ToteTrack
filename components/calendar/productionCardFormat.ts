import {
  SIZE_COLS,
  TYPE_ROWS,
  cellKey,
  type QtyGridValues,
  type TypeKey,
} from '@/components/shared/qtyGridValues'

/**
 * Combos listed in full on a production card before the rest collapse to
 * `+N more`. Matches the card's 2-line mix slot: a 5th entry would either wrap
 * to a 3rd line or truncate mid-combo, and both break the fixed card height.
 */
export const MAX_VISIBLE_COMBOS = 4

/**
 * Three-letter card codes for the container types. Cards are read at arm's
 * length across a shop floor, so the full labels from `TYPE_ROWS`
 * (`Reconditioned`, `Rebottled`, `Brand New`) are too long for the mix line.
 */
const TYPE_CODES: Record<TypeKey, string> = {
  recon: 'REC',
  rebot: 'REB',
  new: 'NEW',
}

/** Em dash used by every PO surface for "nothing here" (matches `formatPoTotal`). */
export const EMPTY_MIX_TEXT = '—'

export interface ProductionMix {
  /** Comma-joined combos, e.g. `12×275 REC, 8×330 REB`. `—` when all six are zero. */
  text: string
  /** Combos omitted from `text`; 0 when everything fit. Drives the `+N more` suffix. */
  hiddenCount: number
}

/**
 * Condenses a PO's six quantity cells into the card's product-mix line.
 *
 * Zero cells are dropped entirely — a card shows what is being built, not what
 * isn't. The surviving combos are ordered by container size first, then by the
 * `TYPE_ROWS` order, so the same PO always reads the same way and two cards
 * side by side line up. At most `MAX_VISIBLE_COMBOS` are listed; the remainder
 * are reported as `hiddenCount` for the caller to render as `+N more`.
 *
 * Prices are deliberately absent — cards never show money (CONSTRAINT-19).
 *
 * @param values The PO's six `qty_‹size›_‹type›` cells.
 */
export function formatProductionMix(values: QtyGridValues): ProductionMix {
  const combos: string[] = []

  for (const { sizeKey } of SIZE_COLS) {
    for (const { typeKey } of TYPE_ROWS) {
      const quantity = values[cellKey(sizeKey, typeKey)]
      if (quantity > 0) {
        combos.push(`${quantity}×${sizeKey} ${TYPE_CODES[typeKey]}`)
      }
    }
  }

  if (combos.length === 0) {
    return { text: EMPTY_MIX_TEXT, hiddenCount: 0 }
  }

  return {
    text: combos.slice(0, MAX_VISIBLE_COMBOS).join(', '),
    hiddenCount: Math.max(0, combos.length - MAX_VISIBLE_COMBOS),
  }
}
