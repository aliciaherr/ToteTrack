import type { ReviewSourceRow } from '@/db/queries/review-source'
import { toOrderQuantities } from '@/lib/extraction/extract'
import { extractedPoSchema } from '@/lib/extraction/schema'
import type { ExtractedPo } from '@/lib/extraction/types'
import { storedCheckResultsOf, type StoredCheckResults } from './review-fields.check-results'
import type { CustomerChoice, FieldFlag, FieldQuote, ReviewCustomer, ReviewFieldKey, ReviewFields, ReviewTotals } from './review-fields.types'
import {
  addressValue,
  capText,
  deliveryDateChoice,
  emptyReviewValues,
  poNumberChoice,
  quantityValues,
  type DraftFlag,
} from './review-fields.values'
import { REVIEW_FLAG_WORDING } from './review-fields.wording'

/**
 * Builds the review overlay's right pane for one PO (Task 107). Pure: the
 * caller reads the row and the candidate customers. Model output is untrusted
 * (L-D): it is re-validated here, and everything from the document stays a
 * plain string.
 */

const LINE_PATH = /^lines\[(\d+)\]$/
// Rebuilt from the extraction with the exact price field, so the stored entry (field `lines`) is dropped.
const REGENERATED_CHECKS = new Set(['conflicting_unit_price'])

/** The form field an extraction path belongs to. */
function fieldKeyOf(path: string, check: string, extracted: ExtractedPo | null): ReviewFieldKey {
  if (path.startsWith('poNumberCandidates')) return 'po_number'
  if (path === 'customerName') return 'customer_id'
  if (path === 'shipToAddress') return 'delivery_address'
  if (path === 'dates' || path.startsWith('dates[')) return 'requested_delivery_date'
  if (path === 'statedTotal') return 'totals'
  const line = LINE_PATH.exec(path)
  const tote = line && extracted?.lines[Number(line[1])]
  if (!tote || tote.kind !== 'tote' || tote.toteType === null || tote.toteType === 'unknown') return 'general'
  return check === 'unit_price_out_of_bounds' ? `unit_price_${tote.toteType}` : `qty_${tote.toteType}`
}

function storedFlags(stored: StoredCheckResults, extracted: ExtractedPo | null): DraftFlag[] {
  return stored.failures
    .filter((failure) => !(extracted && REGENERATED_CHECKS.has(failure.check)))
    .map((failure): DraftFlag => {
      const field = fieldKeyOf(failure.field, failure.check, extracted)
      if (failure.check in REVIEW_FLAG_WORDING) {
        return { field, kind: failure.check as DraftFlag['kind'], detail: failure.detail }
      }
      return { field, kind: 'unknown_check', detail: `${failure.check}: ${failure.detail}` }
    })
}

/** Worded, one per field and kind (the stored detail wins: it was written first). */
function wordFlags(drafts: DraftFlag[]): FieldFlag[] {
  const seen = new Set<string>()
  return drafts.flatMap((draft) => {
    const key = `${draft.field}|${draft.kind}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ ...draft, message: REVIEW_FLAG_WORDING[draft.kind] }]
  })
}

/** The quote text at an extraction path, or `null` when the path names nothing. */
function quoteAt(extracted: ExtractedPo, path: string): string | null {
  const indexed = /^(poNumberCandidates|dates|lines)\[(\d+)\]$/.exec(path)
  if (indexed) return extracted[indexed[1] as 'poNumberCandidates' | 'dates' | 'lines'][Number(indexed[2])]?.quote ?? null
  if (path === 'customerName' || path === 'shipToAddress' || path === 'billToAddress' || path === 'statedTotal') {
    return extracted[path].quote
  }
  return null
}

function quotesOf(stored: StoredCheckResults, extracted: ExtractedPo | null): FieldQuote[] {
  if (!extracted) return []
  return stored.quotes.flatMap(({ field: path, status }) => {
    const quote = quoteAt(extracted, path)
    return quote ? [{ field: fieldKeyOf(path, '', extracted), path, quote: capText(quote), status }] : []
  })
}

/** Ranked choices that still exist, the pre-fill if it does, and a flag for any that don't. */
function customersOf(stored: StoredCheckResults, customers: ReviewCustomer[]) {
  const byId = new Map(customers.map((customer) => [customer.id, customer]))
  const match = stored.customerMatch
  const ids = new Set([...(match?.candidates.map((candidate) => candidate.customerId) ?? []), ...(match?.prefillCustomerId ? [match.prefillCustomerId] : [])])
  const missing = [...ids].filter((id) => !byId.has(id)).length
  const choices: CustomerChoice[] = (match?.candidates ?? []).flatMap((candidate) => {
    const customer = byId.get(candidate.customerId)
    return customer
      ? [{ customerId: customer.id, companyName: customer.company_name, status: customer.status, addressMatched: candidate.addressMatched }]
      : []
  })
  const prefill = match?.prefillCustomerId && byId.has(match.prefillCustomerId) ? match.prefillCustomerId : ''
  const flags: DraftFlag[] = missing
    ? [{ field: 'customer_id', kind: 'customer_no_longer_exists', detail: `${missing} matched customer(s) no longer exist` }]
    : []
  return { choices, prefill, flags }
}

/**
 * Flags about the reading as a whole: no tote line at all, and wording that
 * could not be checked because every quote was unverifiable (a scan or a
 * photo has no text of its own to check against).
 */
function readingFlags(stored: StoredCheckResults, extracted: ExtractedPo | null): DraftFlag[] {
  const flags: DraftFlag[] = []
  if (extracted && !extracted.lines.some((line) => line.kind === 'tote')) {
    flags.push({ field: 'general', kind: 'no_tote_lines', detail: '' })
  }
  if (stored.quotes.length > 0 && stored.quotes.every((quote) => quote.status === 'unverifiable')) {
    flags.push({ field: 'general', kind: 'wording_unchecked', detail: '' })
  }
  return flags
}

/** Flags about the PO row itself: the same document hash as a PO already received (Task 108). */
function rowFlags(row: Pick<ReviewSourceRow, 'duplicate_of_id'>): DraftFlag[] {
  return row.duplicate_of_id ? [{ field: 'general', kind: 'duplicate_document', detail: '' }] : []
}

function totalsOf(extracted: ExtractedPo | null): ReviewTotals {
  if (!extracted) return { stated: null, computed: 0, otherLines: [] }
  return {
    stated: extracted.statedTotal.value,
    computed: toOrderQuantities(extracted).price,
    otherLines: extracted.lines
      .filter((line) => line.kind === 'other')
      .map((line) => ({ quote: capText(line.quote), amount: line.lineTotal })),
  }
}

/** The stored extraction, re-validated; `null` with a flag when it no longer fits the schema. */
function readExtraction(row: Pick<ReviewSourceRow, 'id' | 'extracted'>): { extracted: ExtractedPo | null; flags: DraftFlag[] } {
  if (row.extracted === null || row.extracted === undefined) return { extracted: null, flags: [] }
  const parsed = extractedPoSchema.safeParse(row.extracted)
  if (parsed.success) return { extracted: parsed.data, flags: [] }
  console.error('reviewFieldsOf: stored extraction fails the schema', { poId: row.id, issueCount: parsed.error.issues.length })
  return { extracted: null, flags: [{ field: 'general', kind: 'extraction_unreadable', detail: '' }] }
}

/**
 * The right pane for one PO.
 *
 * @param row The PO row: `extracted` and `check_results` as stored, any shape;
 *   a non-null `duplicate_of_id` raises `duplicate_document`.
 * @param customers Every customer the stored match names that still exists,
 *   inactive ones included, from `getCustomersForReview`.
 * @returns Pre-filled values (empty when there is no usable extraction, so the
 *   pane works as a manual-entry screen), flags, quotes, options and totals.
 */
export function reviewFieldsOf(
  row: Pick<ReviewSourceRow, 'id' | 'extracted' | 'check_results' | 'duplicate_of_id'>,
  customers: ReviewCustomer[],
): ReviewFields {
  const stored = storedCheckResultsOf(row.check_results)
  const reading = readExtraction(row)
  const extracted = reading.extracted
  const customer = customersOf(stored, customers)
  const values = { ...emptyReviewValues(), customer_id: customer.prefill }
  const drafts: DraftFlag[] = [
    ...rowFlags(row),
    ...storedFlags(stored, extracted),
    ...reading.flags,
    ...readingFlags(stored, extracted),
    ...customer.flags,
  ]
  let poNumberOptions: ReviewFields['poNumberOptions'] = []
  let deliveryDateOptions: ReviewFields['deliveryDateOptions'] = []

  if (extracted) {
    const poNumber = poNumberChoice(extracted)
    const date = deliveryDateChoice(extracted, stored.failures)
    const quantities = quantityValues(extracted)
    const address = addressValue(extracted)
    Object.assign(values, quantities.values, {
      po_number: poNumber.value,
      requested_delivery_date: date.value,
      delivery_address: address.value,
    })
    poNumberOptions = poNumber.options
    deliveryDateOptions = date.options
    drafts.push(...poNumber.flags, ...quantities.flags, ...address.flags)
  }

  return {
    values,
    flags: wordFlags(drafts),
    quotes: quotesOf(stored, extracted),
    poNumberOptions,
    deliveryDateOptions,
    customerChoices: customer.choices,
    totals: totalsOf(extracted),
  }
}
