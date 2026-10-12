/**
 * Every tunable value in the PO check suite (Feature 16, Task 101), in one
 * place. Same rule as `extraction.constants.ts`: each changes what gets
 * flagged, so it is a code decision that goes through review, not an env var.
 *
 * Checks rank attention, they never gate acceptance (plan.md, Task 95): a value
 * here only decides what sorts to the top of the review queue.
 */

/** Shape version of `check_results`, so a later reader can tell old rows apart. */
export const CHECK_RESULTS_VERSION = 1

/**
 * Longest source quote checked, in characters. The longest genuine quote in the
 * 4 sample POs is a ~190-character multi-line order row; a quote far past that
 * is the model pasting the page, not quoting a value. Over the cap is a failure
 * and the quote is not matched, which also bounds the matcher's work.
 */
export const MAX_QUOTE_CHARS = 600

/**
 * Most text a document may carry for quote matching, in characters, summed
 * over pages. A one-page PO is ~1–3k; `MAX_PDF_PAGES` real pages stay far
 * under this. Over it, quotes are `unverifiable` and one failure says why —
 * it bounds the fuzzy matcher, whose cost grows with page length.
 */
export const MAX_SOURCE_TEXT_CHARS = 30_000

/**
 * Shortest all-letter quote token that may match with one typo. The model
 * sometimes "fixes" a misspelling while quoting ("Arlintgon" → "Arlington")
 * or swaps two letters ("VITON" → "VTION"). Short words and anything with a
 * digit must match exactly — numbers are where an invented value would hide.
 */
export const FUZZY_MIN_TOKEN_CHARS = 5

/**
 * Total typo-matching work allowed per document, in edit-table cells (token
 * length × page length per search) — @security MEDIUM-07. A real PO uses a
 * few thousand cells; a crafted one could otherwise cost seconds of blocking
 * CPU (measured: 5.4 s). 20M cells is roughly 100–200 ms. Past it, remaining
 * typo searches count as no match, so the quote is `not_found` and flagged.
 */
export const MAX_FUZZY_WORK = 20_000_000

/** Edits (insert, delete, substitute or swap two neighbours) a fuzzy token may need. */
export const FUZZY_MAX_EDITS = 1

/**
 * Largest quantity on one tote line before it is flagged. The sample POs order
 * 30–60; a truckload is about 60. Flagged, never clamped (L-D).
 */
export const MAX_LINE_QUANTITY = 500

/** Largest unit price in dollars before it is flagged. Totes sell for ~$130–$400. */
export const MAX_UNIT_PRICE = 1_000

/**
 * Allowed difference between two money amounts, in cents. Zero: the PO's
 * arithmetic must agree to the cent (the $7,800 vs $7,800.18 case fails).
 */
export const MONEY_TOLERANCE_CENTS = 0

/** Money is compared in whole cents to keep float error out of every comparison. */
export const CENTS_PER_DOLLAR = 100

/**
 * A numeric date component above this can only be a day, which settles
 * month-first vs day-first for the whole document.
 */
export const MONTHS_IN_YEAR = 12
