import {
  ExtractionConfigError,
  ExtractionResponseError,
  PdfPageTooLargeError,
  PdfTooManyPagesError,
  TextInputTooLongError,
} from '@/lib/extraction/errors'
import { StorageConfigError } from '@/lib/storage/errors'

/**
 * How the extraction worker (Task 115) sorts a failure. Messages here carry
 * row IDs and source kinds only — never document text (SEC-05).
 */

/**
 * A claimed row has nothing the worker can read: a `pdf` / `image` row with
 * no `document_path`, an `email_body` row with no `body_text`, or a path whose
 * extension names no accepted image type. Retrying cannot fix it.
 */
export class MissingExtractionInputError extends Error {
  readonly rowId: string

  constructor(rowId: string, sourceKind: string, reason: string) {
    super(`inbound_pos ${rowId} (${sourceKind}) has no readable input: ${reason}`)
    this.name = 'MissingExtractionInputError'
    this.rowId = rowId
  }
}

/**
 * A claimed row has already used every attempt: the runs that took it kept
 * dying before they could record a result (M-04 condition 2).
 */
export class ExtractionAttemptsExhaustedError extends Error {
  readonly rowId: string

  constructor(rowId: string, maxAttempts: number) {
    super(`inbound_pos ${rowId} gave up after ${maxAttempts} extraction attempts`)
    this.name = 'ExtractionAttemptsExhaustedError'
    this.rowId = rowId
  }
}

/**
 * Failures a retry cannot fix. The worker parks the row at
 * `extraction_failed` at once instead of spending another attempt.
 */
const PERMANENT_ERRORS = [
  TextInputTooLongError,
  PdfTooManyPagesError,
  PdfPageTooLargeError,
  ExtractionResponseError,
  MissingExtractionInputError,
  ExtractionAttemptsExhaustedError,
] as const

/**
 * Failures that no row in the batch could survive: the deployment is missing
 * configuration. The worker stops the batch loudly rather than charging an
 * attempt to every row in turn.
 */
const BATCH_STOPPING_ERRORS = [ExtractionConfigError, StorageConfigError] as const

/**
 * Whether a retry could not help: the document is too long, too large, or
 * unreadable, or the model's answer did not fit the schema. Anything else
 * (HTTP, timeout, render timeout, storage, DB) is transient.
 *
 * @param error Anything thrown while extracting one row.
 * @returns `true` for a permanent failure.
 */
export function isPermanentExtractionError(error: unknown): boolean {
  return PERMANENT_ERRORS.some((errorClass) => error instanceof errorClass)
}

/**
 * Whether the failure is the deployment's, not the row's: a missing
 * OpenRouter key or Storage credential.
 *
 * @param error Anything thrown while extracting one row.
 * @returns `true` when the whole batch must stop.
 */
export function isBatchStoppingError(error: unknown): boolean {
  return BATCH_STOPPING_ERRORS.some((errorClass) => error instanceof errorClass)
}
