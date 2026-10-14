import type { CustomerMatch } from '@/lib/matching/types'
import type { CHECK_RESULTS_VERSION } from './checks.constants'

/**
 * Every rule the check suite can fail. Distinct from Task 100's
 * `ingest_limit`, so the review UI can tell the two kinds of entry apart.
 */
export type CheckName =
  // Quotes
  | 'quote_not_found'
  | 'quote_too_long'
  | 'source_text_too_long'
  | 'value_not_in_quote'
  // Arithmetic
  | 'total_mismatch'
  | 'line_total_mismatch'
  | 'line_total_indivisible'
  // Dates
  | 'ambiguous_date'
  | 'multiple_delivery_dates'
  | 'date_order_mismatch'
  // Fields
  | 'not_purchase_order'
  | 'missing_po_number'
  | 'missing_ship_to'
  | 'unknown_tote_type'
  | 'conflicting_unit_price'
  | 'quantity_out_of_bounds'
  | 'unit_price_out_of_bounds'
  // Customer (Task 102, `customerMatchFailures`)
  | 'no_customer_match'
  | 'ambiguous_customer'
  // Worker (Task 115): the PO could not be read and needs manual entry
  | 'extraction_failed'

/**
 * One entry in the `failures` array on `inbound_pos.check_results` — the
 * Task 95 contract the review queue sorts on.
 *
 * `detail` carries numbers, indices and labels we wrote — **never document
 * text** (no names, addresses or quotes). It is persisted and read back by
 * the review UI, which renders it as plain text (L-D).
 */
export interface CheckFailure {
  check: CheckName
  /** Path into the extraction: `statedTotal`, `lines[2]`, `dates[0]`, … */
  field: string
  detail: string
}

/**
 * - `verified` — the quote is in the document's own text.
 * - `not_found` — the document has text and the quote is not in it.
 * - `unverifiable` — there is no text to check against (an image or a scan),
 *   or the quote was too long to check. Never a failure by itself.
 */
export type QuoteStatus = 'verified' | 'not_found' | 'unverifiable'

/** One quote's outcome. Status only — the quote text itself is never stored here. */
export interface QuoteResult {
  field: string
  status: QuoteStatus
}

/** The full `check_results` value for one PO. `failures` is always an array. */
export interface CheckResults {
  version: typeof CHECK_RESULTS_VERSION
  failures: CheckFailure[]
  quotes: QuoteResult[]
  /**
   * Added by Task 103's worker from `matchCustomer` (Task 102). Optional and
   * additive, so `version` stays 1: rows written before it simply lack it.
   */
  customerMatch?: CustomerMatch
}
