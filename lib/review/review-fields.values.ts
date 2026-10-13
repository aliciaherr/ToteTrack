import { EMPTY_FORM_VALUES, type OrderFormValues } from '@/components/orders/orderFormSchema'
import { DELIVERY_ADDRESS_MAX, PO_NUMBER_MAX } from '@/lib/actions/orders.validation'
import { MAX_LINE_QUANTITY, MAX_QUOTE_CHARS, MAX_UNIT_PRICE } from '@/lib/checks/checks.constants'
import { toOrderQuantities } from '@/lib/extraction/extract'
import { TOTE_TYPES } from '@/lib/extraction/extraction.constants'
import type { ExtractedLine, ExtractedPo, ToteType } from '@/lib/extraction/types'
import type { StoredFailure } from './review-fields.check-results'
import type { LabelledOption, ReviewFieldKey, ReviewFlagKind } from './review-fields.types'

/**
 * The order-form values a PO's extraction pre-fills (Task 107). Only what is
 * certain is filled; everything else is left blank and flagged, or offered as
 * labelled one-tap options with none chosen (prd.md, Edge Cases).
 */

/** A flag before its wording is attached. */
export interface DraftFlag {
  field: ReviewFieldKey
  kind: ReviewFlagKind
  detail: string
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ELLIPSIS = '…'

/** The order form's empty values, with no delivery date: never today by default. */
export function emptyReviewValues(): OrderFormValues {
  return { ...EMPTY_FORM_VALUES, requested_delivery_date: '' }
}

/** Document text capped at `MAX_QUOTE_CHARS`, marked with "…" when cut. */
export function capText(text: string): string {
  return text.length > MAX_QUOTE_CHARS ? `${text.slice(0, MAX_QUOTE_CHARS)}${ELLIPSIS}` : text
}

/** One value per distinct `value`, first occurrence kept. */
function distinctByValue(options: LabelledOption[]): LabelledOption[] {
  const seen = new Set<string>()
  return options.filter((option) => !seen.has(option.value) && seen.add(option.value))
}

/** The PO number: filled when one distinct candidate exists, otherwise labelled options. */
export function poNumberChoice(extracted: ExtractedPo): { value: string; options: LabelledOption[]; flags: DraftFlag[] } {
  const candidates = extracted.poNumberCandidates
    .map((candidate, index) => ({
      value: candidate.value.trim(),
      label: capText(candidate.label),
      path: `poNumberCandidates[${index}]`,
    }))
    .filter((candidate) => candidate.value !== '')
  const tooLong = candidates.filter((candidate) => candidate.value.length > PO_NUMBER_MAX)
  const usable = distinctByValue(candidates.filter((candidate) => candidate.value.length <= PO_NUMBER_MAX))
  const flags: DraftFlag[] = tooLong.length
    ? [{ field: 'po_number', kind: 'value_too_long', detail: `${tooLong.length} PO number candidate(s) over ${PO_NUMBER_MAX} characters` }]
    : []
  if (usable.length === 1) return { value: usable[0].value, options: [], flags }
  return { value: '', options: usable, flags }
}

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value)
}

/**
 * The delivery date: filled when exactly one distinct delivery date exists and
 * none is flagged ambiguous; otherwise delivery dates, then other dates, as
 * options. Order dates are never offered: they are not when goods are wanted.
 */
export function deliveryDateChoice(extracted: ExtractedPo, failures: StoredFailure[]): { value: string; options: LabelledOption[] } {
  const ambiguous = new Set(failures.filter((failure) => failure.check === 'ambiguous_date').map((failure) => failure.field))
  const dated = extracted.dates
    .map((date, index) => ({ ...date, path: `dates[${index}]` }))
    .filter((date) => date.role !== 'order' && isRealDate(date.value))
  const delivery = dated.filter((date) => date.role === 'delivery')
  const toOption = (date: (typeof dated)[number]): LabelledOption => ({ value: date.value, label: capText(date.label), path: date.path })
  const distinctDelivery = distinctByValue(delivery.map(toOption))
  if (distinctDelivery.length === 1 && !delivery.some((date) => ambiguous.has(date.path))) {
    return { value: distinctDelivery[0].value, options: [] }
  }
  return { value: '', options: distinctByValue([...delivery, ...dated.filter((date) => date.role === 'other')].map(toOption)) }
}

function linesOf(extracted: ExtractedPo, type: ToteType): ExtractedLine[] {
  return extracted.lines.filter((line) => line.kind === 'tote' && line.toteType === type)
}

const badQuantity = (line: ExtractedLine) =>
  line.quantity !== null && !(Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= MAX_LINE_QUANTITY)
const badUnitPrice = (line: ExtractedLine) =>
  line.unitPrice !== null && (line.unitPrice < 0 || line.unitPrice > MAX_UNIT_PRICE)

/**
 * The six quantities and unit prices. A type with an out-of-bounds line is
 * left blank, never clamped (L-D); a type at two prices gets no unit price.
 */
export function quantityValues(extracted: ExtractedPo): { values: Partial<OrderFormValues>; flags: DraftFlag[] } {
  const { slots, conflicts } = toOrderQuantities(extracted)
  const values: Partial<OrderFormValues> = {}
  const flags: DraftFlag[] = []
  for (const type of TOTE_TYPES) {
    const qtyKey = `qty_${type}` as const
    const priceKey = `unit_price_${type}` as const
    const lines = linesOf(extracted, type)
    const quantityIsBad = lines.some(badQuantity)
    const priceIsBad = lines.some(badUnitPrice)
    const isConflict = conflicts.includes(type)
    values[qtyKey] = quantityIsBad ? 0 : slots[type].quantity
    const unitPrice = slots[type].unitPrice
    values[priceKey] = priceIsBad || isConflict || unitPrice === null ? null : unitPrice.toFixed(2)
    if (quantityIsBad) flags.push({ field: qtyKey, kind: 'quantity_out_of_bounds', detail: `a ${type} line has an unusable quantity` })
    if (priceIsBad) flags.push({ field: priceKey, kind: 'unit_price_out_of_bounds', detail: `a ${type} line has an unusable unit price` })
    if (isConflict) flags.push({ field: priceKey, kind: 'conflicting_unit_price', detail: `${type} appears at more than one unit price` })
  }
  return { values, flags }
}

/** The ship-to as a typed (unsaved) delivery address. */
export function addressValue(extracted: ExtractedPo): { value: string; flags: DraftFlag[] } {
  const address = extracted.shipToAddress.value?.trim() ?? ''
  if (address.length <= DELIVERY_ADDRESS_MAX) return { value: address, flags: [] }
  return {
    value: '',
    flags: [{ field: 'delivery_address', kind: 'value_too_long', detail: `ship-to over ${DELIVERY_ADDRESS_MAX} characters` }],
  }
}
