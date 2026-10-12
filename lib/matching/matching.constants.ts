/**
 * Every tunable value in the customer matcher (Feature 16, Task 102), in one
 * place. Same rule as `checks.constants.ts`: each changes which customers are
 * offered, so it is a code decision that goes through review, not an env var.
 *
 * None of these can pre-fill a customer. Pre-fill needs an exact match on the
 * normalised name (builder decision, 2026-10-12); the thresholds only decide
 * who appears in the ranked list. Starting values, tuned on the Task 102
 * evaluation against the real customer list.
 */

/**
 * Lowest `pg_trgm` similarity (0–1) between normalised names for a customer
 * to be listed. 0.3 is pg_trgm's own default for its `%` operator: loose
 * enough to catch abbreviations and typos, since a missed candidate costs a
 * search while an extra one costs a glance.
 */
export const NAME_SIMILARITY_MIN = 0.3

/**
 * Lowest similarity between the PO's normalised ship-to and one of a
 * customer's saved delivery addresses to count as an address match. Higher
 * than the name floor: addresses are long and share many trigrams ("st",
 * city, state, ZIP prefix), so a low score is noise.
 */
export const ADDRESS_SIMILARITY_MIN = 0.5

/**
 * Lowest `pg_trgm` word similarity (0–1) of the PO's normalised name inside one
 * of a customer's saved addresses. Saved addresses usually open with the
 * customer's legal name ("Rhenium Lubricants and Specialty Chemical 733 …")
 * while `company_name` holds a nickname or branch label ("Delta Energy/Rhenium",
 * "Coastal Kilgore"). High, because an address is long and a short PO name
 * would otherwise find a partial echo of itself in many of them. Lists only,
 * never pre-fills (builder, 2026-10-12).
 */
export const NAME_IN_ADDRESS_SIMILARITY_MIN = 0.8

/**
 * Added to a candidate's name score when its address matched. Lifts a
 * customer whose name is abbreviated on the PO above a similar-named stranger,
 * and gives an address-only candidate a non-zero rank.
 */
export const ADDRESS_BOOST = 0.2

/** Most candidates stored and shown. A longer list is a search, not a match. */
export const MAX_CUSTOMER_CANDIDATES = 5
