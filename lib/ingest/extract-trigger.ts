import { loggableFailure } from '@/lib/loggable-failure'
import { postTrigger } from './trigger-post'
import { drainExtractionBatch, type BatchSummary } from './worker'

/**
 * What `POST /api/ingest/extract` runs after it has answered 202 (Task 116):
 * one worker batch, then at most one call to itself when rows may remain (A-11).
 *
 * Nothing here throws. It runs inside `after()`, where a thrown error would be
 * printed raw by the framework, and a raw drizzle error carries document text
 * in its params (SEC-05, MEDIUM-04). Every failure is logged through
 * `loggableFailure` instead.
 */

/** Injected so tests reach no DB and no network. */
export interface ExtractTriggerDeps {
  drain: () => Promise<BatchSummary>
  fetch: typeof fetch
}

/** Production wiring. */
export const defaultExtractTriggerDeps: ExtractTriggerDeps = {
  drain: () => drainExtractionBatch(),
  fetch: (input, init) => fetch(input, init),
}

/** Runs the batch; `null` when it threw (already logged). */
async function drainLogged(deps: ExtractTriggerDeps): Promise<BatchSummary | null> {
  try {
    const summary = await deps.drain()
    console.info('extractTrigger: batch done', summary)
    return summary
  } catch (error) {
    console.error('extractTrigger: batch stopped; not chaining', { failure: loggableFailure(error) })
    return null
  }
}

/**
 * Drains one batch, then calls the route once more if the worker reports
 * `rowsMayRemain`. It chains on that flag only, **never on how many rows were
 * claimed**: released rows wait out the retry delay, and chaining on them
 * would spend their attempts in seconds (MEDIUM-10).
 *
 * @param selfUrl The route's own absolute URL.
 * @param secret `INGEST_TRIGGER_SECRET`, already checked by the route.
 * @param deps Injected collaborators; production wiring by default.
 * @returns Whether a self-chain call was made.
 */
export async function drainAndChain(
  selfUrl: string,
  secret: string,
  deps: ExtractTriggerDeps = defaultExtractTriggerDeps,
): Promise<boolean> {
  const summary = await drainLogged(deps)
  if (!summary?.rowsMayRemain) return false
  // A failed chain is logged by `postTrigger`; the fallback cron (A-11) picks up the rest.
  await postTrigger('extractTrigger: self-chain', selfUrl, secret, deps.fetch)
  return true
}
