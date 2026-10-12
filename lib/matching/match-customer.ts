import { findCustomerCandidates, type CandidateRow } from '@/db/queries/customer-match'
import type { CheckFailure } from '@/lib/checks/types'
import type { ExtractedPo } from '@/lib/extraction/types'
import {
  ADDRESS_BOOST,
  ADDRESS_SIMILARITY_MIN,
  MAX_CUSTOMER_CANDIDATES,
  NAME_IN_ADDRESS_SIMILARITY_MIN,
} from './matching.constants'
import type { CustomerCandidate, CustomerMatch } from './types'

function toCandidate(row: CandidateRow): CustomerCandidate {
  const addressMatched = row.addressScore >= ADDRESS_SIMILARITY_MIN
  const nameInAddress = row.nameInAddressScore >= NAME_IN_ADDRESS_SIMILARITY_MIN
  const bestName = Math.max(row.nameScore, nameInAddress ? row.nameInAddressScore : 0)
  return {
    customerId: row.customerId,
    score: bestName + (addressMatched ? ADDRESS_BOOST : 0),
    nameScore: row.nameScore,
    nameInAddress,
    addressMatched,
    status: row.status,
  }
}

/**
 * Matches one PO to existing customers (Feature 16, Task 102). Reads the DB,
 * writes nothing — Task 103's worker stores the result as
 * `check_results.customerMatch`.
 *
 * Pre-fills only when exactly one customer's normalised name equals the PO's
 * (builder decision, 2026-10-12). Two customers sharing that name, a fuzzy
 * match, the name found only inside a saved address, or a ship-to match alone
 * all leave the choice to the salesperson.
 *
 * @param extracted A validated extraction from `extractPo`.
 * @returns Candidates best first, capped at `MAX_CUSTOMER_CANDIDATES`, and the
 *   pre-fill ID or `null`.
 * @throws {DatabaseError} when the candidate query fails — never an empty
 *   match, which would read as "no such customer".
 */
export async function matchCustomer(extracted: ExtractedPo): Promise<CustomerMatch> {
  const name = extracted.customerName.value?.trim() || null
  const shipTo = extracted.shipToAddress.value?.trim() || null
  if (name === null && shipTo === null) return { prefillCustomerId: null, candidates: [] }

  const rows = await findCustomerCandidates(name, shipTo)
  const exact = rows.filter((row) => row.exactName)
  const candidates = rows
    .map(toCandidate)
    .sort((a, b) => b.score - a.score || a.customerId.localeCompare(b.customerId))
    .slice(0, MAX_CUSTOMER_CANDIDATES)

  return {
    prefillCustomerId: exact.length === 1 ? exact[0].customerId : null,
    candidates,
  }
}

/**
 * The review-queue failures a match produces, so a PO without a pre-filled
 * customer sorts up (Task 95 contract). Pure. `detail` holds counts only,
 * never a name (L-D).
 *
 * @param match The result of `matchCustomer`.
 * @returns `no_customer_match` when nobody was found, `ambiguous_customer`
 *   when there are candidates but no pre-fill, otherwise nothing.
 */
export function customerMatchFailures(match: CustomerMatch): CheckFailure[] {
  if (match.prefillCustomerId !== null) return []
  if (match.candidates.length === 0) {
    return [{ check: 'no_customer_match', field: 'customerName', detail: 'No existing customer matched the name or ship-to address' }]
  }
  return [{
    check: 'ambiguous_customer',
    field: 'customerName',
    detail: `${match.candidates.length} possible customer(s); none matched the name exactly`,
  }]
}
