/**
 * The customer matcher's output (Feature 16, Task 102), stored as
 * `check_results.customerMatch`.
 *
 * **IDs and numbers only — never a name or an address** (SEC-05 / L-D). The
 * review UI looks the customer up by ID, so a customer renamed after matching
 * shows the current name, and one deleted since shows as missing (Task 107).
 */
export type CustomerStatus = 'active' | 'inactive'

export interface CustomerCandidate {
  customerId: string
  /**
   * Rank key: the better of `nameScore` and the name-in-address score, plus
   * `ADDRESS_BOOST` when the ship-to matched.
   */
  score: number
  /** `pg_trgm` similarity of the normalised names, 0–1. */
  nameScore: number
  /** The PO's name was found inside one of this customer's saved addresses. */
  nameInAddress: boolean
  /** The PO's ship-to matched one of this customer's saved delivery addresses. */
  addressMatched: boolean
  /** Inactive customers are listed, labelled: a dormant customer can reorder. */
  status: CustomerStatus
}

export interface CustomerMatch {
  /**
   * Set only when exactly one customer's normalised name equals the PO's.
   * A fuzzy, name-in-address or address-only match never pre-fills: a wrong customer that gets
   * rubber-stamped is the worst outcome this feature can produce (prd.md).
   */
  prefillCustomerId: string | null
  /** Best first, at most `MAX_CUSTOMER_CANDIDATES`. */
  candidates: CustomerCandidate[]
}
