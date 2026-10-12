import type { ExtractedPo } from '@/lib/extraction/types'
import { checkArithmetic } from './arithmetic'
import { CHECK_RESULTS_VERSION } from './checks.constants'
import { checkDates } from './dates'
import { checkFields } from './fields'
import { checkQuotes } from './quotes'
import type { CheckResults } from './types'

/**
 * Runs the whole check suite on one extraction (Task 101). Pure: no DB writes,
 * no network — Task 103's worker persists the result as `check_results`.
 *
 * Checks rank attention and never gate acceptance: each failure sorts the PO
 * up the review queue (Task 95 contract), it never keeps it out.
 *
 * @param extracted - A validated extraction from `extractPo`.
 * @param sourceText - The `sourceText` from `extractPo`: the document's own
 *   text per page, or `null` (image or scan), which makes quotes unverifiable.
 * @returns `{ version, failures, quotes }`. `failures` is always an array.
 */
export function runChecks(extracted: ExtractedPo, sourceText: string[] | null): CheckResults {
  const quoteCheck = checkQuotes(extracted, sourceText)
  return {
    version: CHECK_RESULTS_VERSION,
    failures: [
      ...quoteCheck.failures,
      ...checkArithmetic(extracted),
      ...checkDates(extracted),
      ...checkFields(extracted),
    ],
    quotes: quoteCheck.quotes,
  }
}
