import { EMPTY_FORM_VALUES, type OrderFormValues } from '@/components/orders/orderFormSchema'
import { DELIVERY_ADDRESS_MAX, PO_NUMBER_MAX } from '@/lib/actions/orders.validation'
import { MAX_QUOTE_CHARS } from '@/lib/checks/checks.constants'
import { quantityProblem, unitPriceProblem } from '@/lib/checks/fields'
import { toOrderQuantities } from '@/lib/extraction/quantities'
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

// One rule with the checks (lib/checks/fields.ts). A null quantity counts too:
// a line of this type with no stated quantity makes the type's sum uncertain.
const badQuantity = (line: ExtractedLine) => quantityProblem(line.quantity) !== null
const badUnitPrice = (line: ExtractedLine) => unitPriceProblem(line.unitPrice) !== null

// How far `price × 100` may sit from a whole number and still be whole cents:
// absorbs binary error (19.99 × 100 = 1998.9999999999998) while 1.005 × 100
// (100.49999999999999) and 12.345 × 100 stay far outside it.
const CENTS_TOLERANCE = 1e-6

/** True when `price` has at most 2 decimal places. */
export function isWholeCents(price: number): boolean {
  const cents = price * 100
  return Math.abs(cents - Math.round(cents)) < CENTS_TOLERANCE
}

/** An in-bounds stated price with more than 2 decimals: never rounded, left blank. */
const tooPrecise = (line: ExtractedLine) =>
  line.unitPrice !== null && !badUnitPrice(line) && !isWholeCents(line.unitPrice)

interface TypeState {
  quantityIsBad: boolean
  priceIsBad: boolean
  priceIsTooPrecise: boolean
  isConflict: boolean
}

/** The flags for one tote type's quantity and unit price. */
function typeFlags(type: ToteType, state: TypeState): DraftFlag[] {
  const qtyKey = `qty_${type}` as const
  const priceKey = `unit_price_${type}` as const
  const flags: DraftFlag[] = []
  if (state.quantityIsBad) flags.push({ field: qtyKey, kind: 'quantity_out_of_bounds', detail: `a ${type} line has an unusable quantity` })
  if (state.priceIsBad) flags.push({ field: priceKey, kind: 'unit_price_out_of_bounds', detail: `a ${type} line has an unusable unit price` })
  if (state.priceIsTooPrecise) flags.push({ field: priceKey, kind: 'unit_price_too_precise', detail: `a ${type} line has a unit price with more than 2 decimals` })
  if (state.isConflict) flags.push({ field: priceKey, kind: 'conflicting_unit_price', detail: `${type} appears at more than one unit price` })
  return flags
}

/**
 * The six quantities and unit prices. A type with an out-of-bounds line is
 * left blank, never clamped (L-D); a type at two prices, or with a price of
 * more than 2 decimals, gets no unit price (never rounded).
 */
export function quantityValues(extracted: ExtractedPo): { values: Partial<OrderFormValues>; flags: DraftFlag[] } {
  const { slots, conflicts } = toOrderQuantities(extracted)
  const values: Partial<OrderFormValues> = {}
  const flags: DraftFlag[] = []
  for (const type of TOTE_TYPES) {
    const lines = linesOf(extracted, type)
    const state: TypeState = {
      quantityIsBad: lines.some(badQuantity),
      priceIsBad: lines.some(badUnitPrice),
      priceIsTooPrecise: lines.some(tooPrecise),
      isConflict: conflicts.includes(type),
    }
    const unitPrice = slots[type].unitPrice
    const priceIsBlank = state.priceIsBad || state.priceIsTooPrecise || state.isConflict || unitPrice === null
    values[`qty_${type}`] = state.quantityIsBad ? 0 : slots[type].quantity
    values[`unit_price_${type}`] = priceIsBlank ? null : unitPrice.toFixed(2)
    flags.push(...typeFlags(type, state))
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
