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
 * all leave the choice to the salesperson. So does an exact name whose ship-to
 * matches a *different* customer's saved address and not its own: a branch
 * ordering under its parent's name (the Brenntag rule, builder 2026-10-12).
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
  const ranked = rows
    .map(toCandidate)
    .sort((a, b) => b.score - a.score || a.customerId.localeCompare(b.customerId))
  const candidates = ranked.slice(0, MAX_CUSTOMER_CANDIDATES)
  if (exact.length !== 1) return { prefillCustomerId: null, candidates }

  const exactId = exact[0].customerId
  if (shipToPointsElsewhere(exactId, ranked)) {
    return { prefillCustomerId: null, candidates, prefillWithheld: 'ship_to_matches_another' }
  }
  return { prefillCustomerId: exactId, candidates }
}

/**
 * The Brenntag rule: the ship-to matched another customer's saved address and
 * not the exact-name customer's. Checked over every candidate, before the cap.
 */
function shipToPointsElsewhere(exactId: string, ranked: CustomerCandidate[]): boolean {
  const exactMatchesAddress = ranked.some((candidate) => candidate.customerId === exactId && candidate.addressMatched)
  if (exactMatchesAddress) return false
  return ranked.some((candidate) => candidate.customerId !== exactId && candidate.addressMatched)
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
  if (match.prefillWithheld === 'ship_to_matches_another') {
    return [{
      check: 'ambiguous_customer',
      field: 'customerName',
      detail: 'The name matches one customer exactly, but the ship-to address matches a different customer',
    }]
  }
  return [{
    check: 'ambiguous_customer',
    field: 'customerName',
    detail: `${match.candidates.length} possible customer(s); none matched the name exactly`,
  }]
}
