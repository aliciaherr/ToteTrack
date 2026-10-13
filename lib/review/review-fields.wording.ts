import type { ReviewFlagKind } from './review-fields.types'

/**
 * The review pane's title for every flag (Task 107). A `Record`, so a new
 * check name fails the type check until it has wording here.
 */
export const REVIEW_FLAG_WORDING: Record<ReviewFlagKind, string> = {
  quote_not_found: 'Not found in the document: this value may be invented',
  quote_too_long: 'Source text too long to check',
  source_text_too_long: "Document too long to check quotes against",
  total_mismatch: "The document's total doesn't match qty × price",
  line_total_mismatch: "A line's total doesn't equal quantity × unit price",
  line_total_indivisible: "A line total doesn't divide evenly by its quantity",
  ambiguous_date: 'Date could be month-first or day-first: check it',
  multiple_delivery_dates: 'Several delivery dates: pick one',
  not_purchase_order: "This doesn't read as a purchase order",
  missing_po_number: 'No PO number found',
  missing_ship_to: 'No delivery address on the PO',
  unknown_tote_type: "A line's tote size or condition couldn't be read",
  conflicting_unit_price: 'Same tote type at two different prices',
  quantity_out_of_bounds: 'Quantity looks wrong: left blank',
  unit_price_out_of_bounds: 'Unit price looks wrong: left blank',
  no_customer_match: 'No existing customer matched: choose one',
  ambiguous_customer: 'Customer not certain: choose one',
  extraction_failed: "This PO couldn't be read: enter it by hand",
  customer_no_longer_exists: 'The matched customer no longer exists: choose one',
  extraction_unreadable: "This PO's reading is unreadable: enter it by hand",
  value_too_long: 'A value was too long to use: enter it by hand',
  unknown_check: 'A check flagged this PO',
  no_tote_lines: 'No tote lines found: enter quantities',
  wording_unchecked: "Read from a scan or photo: wording couldn't be checked against the document",
}
