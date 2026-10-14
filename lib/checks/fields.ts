import { toOrderQuantities } from '@/lib/extraction/quantities'
import type { ExtractedLine, ExtractedPo } from '@/lib/extraction/types'
import { MAX_LINE_QUANTITY, MAX_UNIT_PRICE } from './checks.constants'
import type { CheckFailure } from './types'

/** Document-level gates: is this a PO, and does it say who and where. */
function checkDocument(extracted: ExtractedPo): CheckFailure[] {
  const failures: CheckFailure[] = []
  if (!extracted.isPurchaseOrder) {
    failures.push({ check: 'not_purchase_order', field: 'isPurchaseOrder', detail: 'the document does not read as a purchase order' })
  }
  if (!extracted.poNumberCandidates.some((candidate) => candidate.value.trim() !== '')) {
    failures.push({ check: 'missing_po_number', field: 'poNumberCandidates', detail: 'no PO number found' })
  }
  if (!extracted.shipToAddress.value?.trim()) {
    failures.push({ check: 'missing_ship_to', field: 'shipToAddress', detail: 'no ship-to address found' })
  }
  return failures
}

/**
 * Quantity must be a whole number from 1 to `MAX_LINE_QUANTITY`. Shared with
 * the review screen, so a typed correction is held to the same rule.
 *
 * @param quantity - A tote line's quantity, `null` when not stated.
 * @returns Why it is out of bounds (no document text), or `null` when fine.
 */
export function quantityProblem(quantity: number | null): string | null {
  if (quantity === null) return 'no quantity stated'
  if (!Number.isInteger(quantity) || quantity <= 0) return `quantity ${quantity} is not a whole number above 0`
  if (quantity > MAX_LINE_QUANTITY) return `quantity ${quantity} is over the ${MAX_LINE_QUANTITY} limit`
  return null
}

/**
 * Unit price, when stated, must be above $0 and at most `MAX_UNIT_PRICE`.
 * A $0 tote price is never real (builder decision 2026-10-14) — it is a
 * misread or an empty template row. Shared with the review screen.
 *
 * @param unitPrice - A tote line's unit price in dollars, `null` when not stated.
 * @returns Why it is out of bounds (no document text), or `null` when fine.
 */
export function unitPriceProblem(unitPrice: number | null): string | null {
  if (unitPrice === null) return null
  if (unitPrice <= 0) return `unit price ${unitPrice} is not above $0`
  if (unitPrice > MAX_UNIT_PRICE) return `unit price ${unitPrice} is over the ${MAX_UNIT_PRICE} limit`
  return null
}

/** Per tote line: a known type, and values inside bounds (L-D — flagged, never clamped). */
function checkToteLine(line: ExtractedLine, index: number): CheckFailure[] {
  const field = `lines[${index}]`
  const failures: CheckFailure[] = []
  if (line.toteType === null || line.toteType === 'unknown') {
    failures.push({ check: 'unknown_tote_type', field, detail: 'tote size or condition could not be determined' })
  }
  const quantity = quantityProblem(line.quantity)
  if (quantity) failures.push({ check: 'quantity_out_of_bounds', field, detail: quantity })
  const unitPrice = unitPriceProblem(line.unitPrice)
  if (unitPrice) failures.push({ check: 'unit_price_out_of_bounds', field, detail: unitPrice })
  return failures
}

/**
 * Field gates: a purchase order with a PO number and a ship-to address, every
 * tote line of a known type with in-bounds quantity and unit price, and no
 * tote type at two different unit prices. `other` lines are not gated.
 *
 * @param extracted - A validated extraction.
 */
export function checkFields(extracted: ExtractedPo): CheckFailure[] {
  const lines = extracted.lines.flatMap((line, index) => (line.kind === 'tote' ? checkToteLine(line, index) : []))
  const conflicts = toOrderQuantities(extracted).conflicts.map(
    (type): CheckFailure => ({
      check: 'conflicting_unit_price',
      field: 'lines',
      detail: `${type} appears at more than one unit price`,
    }),
  )
  return [...checkDocument(extracted), ...lines, ...conflicts]
}
