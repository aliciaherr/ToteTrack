import {
  claimBatch,
  completeExtraction,
  failExtraction,
  releaseForRetry,
  type ClaimedPo,
} from '@/db/queries/extraction-queue'
import { CHECK_RESULTS_VERSION } from '@/lib/checks/checks.constants'
import { runChecks } from '@/lib/checks/run-checks'
import type { CheckResults } from '@/lib/checks/types'
import { readExtractionConfig } from '@/lib/extraction/config'
import { defaultExtractionDeps, extractPo } from '@/lib/extraction/extract'
import type { ExtractionConfig, ExtractionDeps } from '@/lib/extraction/types'
import { loggableFailure } from '@/lib/loggable-failure'
import { customerMatchFailures, matchCustomer } from '@/lib/matching/match-customer'
import { downloadPoDocument } from '@/lib/storage/po-documents'
import {
  EXTRACTION_CLAIM_CUTOFF_MS,
  EXTRACTION_LEASE_MS,
  EXTRACTION_RETRY_DELAY_MS,
  INGEST_BATCH_SIZE,
  MAX_EXTRACTION_ATTEMPTS,
} from './ingest.constants'
import { ExtractionAttemptsExhaustedError, isBatchStoppingError, isPermanentExtractionError } from './worker-errors'
import { loadExtractionInput } from './worker-input'

/**
 * The extraction worker (Task 115, FB-42): claims a batch of staged POs and
 * takes each one to `pending_review` or `extraction_failed`.
 *
 * **Logs carry row ID, source kind, model, outcome, attempt, page count and
 * duration only** (L-A, SEC-05). Never an extracted value, a quote, the body
 * text or `sourceText`; failures are logged through `loggableFailure`.
 */

/** Everything the worker touches, injected so tests reach no DB, network or renderer. */
export interface WorkerDeps {
  readConfig: () => ExtractionConfig
  claimBatch: typeof claimBatch
  completeExtraction: typeof completeExtraction
  failExtraction: typeof failExtraction
  releaseForRetry: typeof releaseForRetry
  downloadPoDocument: (path: string) => Promise<Buffer>
  extractPo: typeof extractPo
  extractionDeps: ExtractionDeps
  matchCustomer: typeof matchCustomer
  now: () => Date
}

/** Production wiring. */
export const defaultWorkerDeps: WorkerDeps = {
  readConfig: () => readExtractionConfig(),
  claimBatch,
  completeExtraction,
  failExtraction,
  releaseForRetry,
  downloadPoDocument,
  extractPo,
  extractionDeps: defaultExtractionDeps,
  matchCustomer,
  now: () => new Date(),
}

/**
 * Where each row ended. `stranded` means even the failure write failed: the
 * row stays `extracting` and the lease returns it to a later run.
 */
export type RowOutcome = 'completed' | 'failed' | 'released' | 'stranded'

/** What one run did, for the route (Task 116) and its log line. */
export interface BatchSummary extends Record<RowOutcome, number> {
  claimed: number
  /**
   * The run stopped with claimable rows possibly left: it hit
   * `INGEST_BATCH_SIZE` or the claim cutoff. `false` when a claim came back
   * empty. Released rows never count: they wait out the retry delay
   * (MEDIUM-10). Task 116 self-chains on this.
   */
  rowsMayRemain: boolean
}

interface RowContext {
  row: ClaimedPo
  config: ExtractionConfig
  deps: WorkerDeps
  startedAt: number
  /** Set by the counting renderer; stays `null` for an email body. */
  pages: number | null
}

/** The `check_results` of a row the worker gave up on. */
function failedCheckResults(detail: string): CheckResults {
  return {
    version: CHECK_RESULTS_VERSION,
    failures: [{ check: 'extraction_failed', field: 'document', detail }],
    quotes: [],
  }
}

function logOutcome(context: RowContext, outcome: RowOutcome, cause?: unknown): void {
  const entry = {
    rowId: context.row.id,
    sourceKind: context.row.source_kind,
    model: context.config.model,
    outcome,
    attempt: context.row.attempt_count,
    pages: context.pages,
    durationMs: context.deps.now().getTime() - context.startedAt,
    ...(cause === undefined ? {} : { failure: loggableFailure(cause) }),
  }
  if (outcome === 'completed') console.info('extractionWorker: row done', entry)
  else console.error('extractionWorker: row not extracted', entry)
}

/** The extraction deps, with the renderer wrapped to record the page count for the log. */
function countingDeps(context: RowContext): ExtractionDeps {
  const base = context.deps.extractionDeps
  return {
    ...base,
    renderPdfPages: async (pdf, maxPages) => {
      const rendered = await base.renderPdfPages(pdf, maxPages)
      context.pages = rendered.images.length
      return rendered
    },
  }
}

/** Load → extract → check → match → persist. Throws whatever any step throws. */
async function extractRow(context: RowContext): Promise<void> {
  const { row, config, deps } = context
  const input = await loadExtractionInput(row, deps.downloadPoDocument)
  if (input.kind === 'image') context.pages = 1
  const { extracted, sourceText } = await deps.extractPo(input, config, countingDeps(context))
  const checks = runChecks(extracted, sourceText)
  const customerMatch = await deps.matchCustomer(extracted)
  await deps.completeExtraction(row.id, extracted, {
    ...checks,
    failures: [...checks.failures, ...customerMatchFailures(customerMatch)],
    customerMatch,
  })
}

/**
 * After a row-level failure: park it when the failure is permanent or the
 * attempts are spent, otherwise release it for the next run. If that write
 * fails too, the row is logged as stranded and left to the lease.
 */
async function settleFailure(context: RowContext, error: unknown): Promise<RowOutcome> {
  const { row, deps } = context
  const giveUp = isPermanentExtractionError(error) || row.attempt_count >= MAX_EXTRACTION_ATTEMPTS
  const errorName = error instanceof Error ? error.name : typeof error
  let outcome: RowOutcome = giveUp ? 'failed' : 'released'
  try {
    if (giveUp) await deps.failExtraction(row.id, failedCheckResults(errorName))
    else await deps.releaseForRetry(row.id)
  } catch (writeError) {
    outcome = 'stranded'
    console.error('extractionWorker: could not record the failure; the lease will reclaim the row', {
      rowId: row.id,
      failure: loggableFailure(writeError),
    })
  }
  logOutcome(context, outcome, error)
  return outcome
}

/** One row, start to finish. Throws only a batch-stopping error. */
async function processRow(row: ClaimedPo, config: ExtractionConfig, deps: WorkerDeps): Promise<RowOutcome> {
  const context: RowContext = { row, config, deps, startedAt: deps.now().getTime(), pages: null }
  if (row.attempt_count > MAX_EXTRACTION_ATTEMPTS) {
    // M-04 condition 2: a row whose runs keep dying is parked before it can render again.
    return settleFailure(context, new ExtractionAttemptsExhaustedError(row.id, MAX_EXTRACTION_ATTEMPTS))
  }
  try {
    await extractRow(context)
  } catch (error) {
    if (isBatchStoppingError(error)) throw error
    return settleFailure(context, error)
  }
  logOutcome(context, 'completed')
  return 'completed'
}

/** Hands the in-flight row back before a batch-stopping error is rethrown. */
async function releaseOnStop(row: ClaimedPo, error: unknown, deps: WorkerDeps): Promise<never> {
  console.error('extractionWorker: batch stopped by a configuration error', {
    rowId: row.id,
    failure: loggableFailure(error),
  })
  await deps.releaseForRetry(row.id).catch((writeError: unknown) => {
    console.error('extractionWorker: could not release a row; the lease will reclaim it', {
      rowId: row.id,
      failure: loggableFailure(writeError),
    })
  })
  throw error
}

/** The next row, or `null` when the queue has nothing claimable. One per claim (MEDIUM-09). */
async function claimNext(deps: WorkerDeps): Promise<ClaimedPo | null> {
  const timing = { leaseMs: EXTRACTION_LEASE_MS, retryDelayMs: EXTRACTION_RETRY_DELAY_MS }
  const [row] = await deps.claimBatch(1, timing, deps.now())
  return row ?? null
}

/**
 * Runs one batch of the extraction worker: claims rows **one at a time**, up
 * to `INGEST_BATCH_SIZE`, and claims no new row once `EXTRACTION_CLAIM_CUTOFF_MS`
 * has passed. A run killed mid-row therefore spends only that row's attempt
 * (MEDIUM-09). One row's failure never stops the batch; the row is released
 * for retry or parked at `extraction_failed`.
 *
 * The extraction config is read **before** claiming, so a missing key costs
 * no row an attempt. A config error met mid-row (a missing Storage
 * credential) releases that row and is rethrown.
 *
 * @param deps Injected collaborators; production wiring by default.
 * @returns How many rows were claimed, where each ended, and whether more may wait.
 * @throws {ExtractionConfigError | StorageConfigError} when the deployment is
 *   misconfigured. {DatabaseError} when a claim fails.
 */
export async function drainExtractionBatch(deps: WorkerDeps = defaultWorkerDeps): Promise<BatchSummary> {
  const config = deps.readConfig()
  const cutoff = deps.now().getTime() + EXTRACTION_CLAIM_CUTOFF_MS
  const summary: BatchSummary = { claimed: 0, rowsMayRemain: true, completed: 0, failed: 0, released: 0, stranded: 0 }
  while (summary.claimed < INGEST_BATCH_SIZE && deps.now().getTime() < cutoff) {
    const row = await claimNext(deps)
    if (!row) {
      summary.rowsMayRemain = false
      break
    }
    summary.claimed += 1
    const outcome = await processRow(row, config, deps).catch((error: unknown) => releaseOnStop(row, error, deps))
    summary[outcome] += 1
  }
  return summary
}
