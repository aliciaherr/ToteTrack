import type { CustomerSelectOption } from '@/db/queries/customers.select'
import type { OrderFormValues } from '@/components/orders/orderFormSchema'
import type { CheckName, QuoteStatus } from '@/lib/checks/types'
import type { CustomerStatus } from '@/lib/matching/types'

/**
 * What the review overlay's right pane is built from (Task 107): the order
 * form pre-filled from one PO's extraction, plus everything the salesperson
 * needs to check it. All text that came from the document is plain text, to
 * be rendered as text only (L-D).
 */

/** A customer the pane can show: the order form's option plus its status (inactive customers can be candidates). */
export interface ReviewCustomer extends CustomerSelectOption {
  status: CustomerStatus
}

/** Where a flag or quote is shown: a form field, the totals block, or the pane's general list. */
export type ReviewFieldKey = keyof OrderFormValues | 'totals' | 'general'

/** Flags the review itself raises, beyond the stored check failures. */
export type ReviewOnlyFlag =
  | 'customer_no_longer_exists'
  | 'extraction_unreadable'
  | 'value_too_long'
  | 'unknown_check'
  | 'no_tote_lines'
  | 'wording_unchecked'
  | 'duplicate_document'

export type ReviewFlagKind = CheckName | ReviewOnlyFlag

export interface FieldFlag {
  field: ReviewFieldKey
  kind: ReviewFlagKind
  /** Plain-language title, from `REVIEW_FLAG_WORDING`. */
  message: string
  /** Our own detail text (numbers, labels, paths), never document text. Empty when there is none. */
  detail: string
}

export interface FieldQuote {
  field: ReviewFieldKey
  /** The extraction path the quote backs, e.g. `poNumberCandidates[1]`, `lines[0]`. */
  path: string
  /** Document text, capped at `MAX_QUOTE_CHARS`. */
  quote: string
  status: QuoteStatus
}

/** A one-tap choice: a PO number or a date, with the label printed beside it. */
export interface LabelledOption {
  value: string
  label: string
  /** The extraction path, so the pane can show the option's quote. */
  path: string
}

export interface CustomerChoice {
  customerId: string
  companyName: string
  status: CustomerStatus
  addressMatched: boolean
}

export interface ReviewTotals {
  /** The document's grand total as printed, or `null`. */
  stated: number | null
  /** Σ(qty × unit price) over the extracted tote lines. */
  computed: number
  /** Non-tote lines (fees, freight): for the arithmetic only, never saved. */
  otherLines: { quote: string; amount: number | null }[]
}

export interface ReviewFields {
  values: OrderFormValues
  flags: FieldFlag[]
  quotes: FieldQuote[]
  poNumberOptions: LabelledOption[]
  deliveryDateOptions: LabelledOption[]
  customerChoices: CustomerChoice[]
  totals: ReviewTotals
}
