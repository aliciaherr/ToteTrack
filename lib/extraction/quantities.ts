import { TOTE_TYPES } from './extraction.constants'
import type { ExtractedPo, OrderQuantities, ToteSlot, ToteType } from './types'

/**
 * Pure folding of an extraction into order slots. Kept apart from
 * `extract.ts` on purpose: this module imports no renderer, network or
 * native code, so the review read path can use it without loading the PDF
 * renderer (pdfjs / canvas).
 */

/**
 * Folds an extraction into the six `qty_*` / `unit_price_*` order slots.
 *
 * Only `tote` lines with a known type and a stated quantity contribute.
 * Quantities sum per type; the unit price is the first stated one, and a type
 * seen at two different unit prices is listed in `conflicts` — reported, never
 * averaged. Tote lines with an `unknown` or null type are counted in
 * `unknownLines`. `price` is Σ(quantity × unit price) over contributing lines
 * that state a unit price, rounded to cents. `other` lines never contribute.
 *
 * @param extracted - A validated extraction.
 * @returns All six slots (quantity 0 / unit price null when absent), the
 *   derived price, the conflicting types and the unknown-line count.
 */
export function toOrderQuantities(extracted: ExtractedPo): OrderQuantities {
  const slots = emptySlots()
  const conflicts: ToteType[] = []
  const priced = new Set<ToteType>()
  let unknownLines = 0
  let price = 0

  for (const line of extracted.lines) {
    if (line.kind !== 'tote') continue
    if (line.toteType === null || line.toteType === 'unknown') {
      unknownLines += 1
      continue
    }
    if (line.quantity === null) continue

    const slot = slots[line.toteType]
    slot.quantity += line.quantity
    if (line.unitPrice === null) continue

    price += line.quantity * line.unitPrice
    if (!priced.has(line.toteType)) {
      priced.add(line.toteType)
      slot.unitPrice = line.unitPrice
    } else if (slot.unitPrice !== line.unitPrice && !conflicts.includes(line.toteType)) {
      conflicts.push(line.toteType)
    }
  }

  return { slots, price: Math.round(price * 100) / 100, conflicts, unknownLines }
}

/**
 * All six tote slots, empty: quantity 0 and no unit price.
 *
 * @returns A fresh object on every call, safe to mutate.
 */
export function emptySlots(): Record<ToteType, ToteSlot> {
  return Object.fromEntries(TOTE_TYPES.map((type) => [type, { quantity: 0, unitPrice: null }])) as Record<
    ToteType,
    ToteSlot
  >
}
