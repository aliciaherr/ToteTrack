import { IngestConfigError } from '@/lib/errors'
import { loggableFailure } from '@/lib/loggable-failure'
import { runIngestion, type IngestRunSummary } from './run'
import { buildIngestRunDeps } from './run-deps'
import { postTrigger } from './trigger-post'

/**
 * What `/api/ingest/run` does after it has answered 202 (Task 104): one
 * ingestion run, then one poke at the extraction worker route.
 *
 * Nothing here throws. It runs inside `after()`, where a thrown error would be
 * printed raw by the framework (SEC-05, MEDIUM-04). Every failure is logged
 * through `loggableFailure` instead.
 */

/** Injected so tests reach no mailbox, DB or network. */
export interface RunTriggerDeps {
  run: () => Promise<IngestRunSummary>
  fetch: typeof fetch
}

/** Production wiring. The deps are built per call, so config is read fresh. */
export const defaultRunTriggerDeps: RunTriggerDeps = {
  run: () => runIngestion(buildIngestRunDeps()),
  fetch: (input, init) => fetch(input, init),
}

/** Runs ingestion; `null` when it threw (already logged). */
async function runLogged(deps: RunTriggerDeps): Promise<IngestRunSummary | null> {
  try {
    const summary = await deps.run()
    console.info('runTrigger: ingestion run done', summary)
    return summary
  } catch (error) {
    console.error('runTrigger: ingestion run failed; the watermark and last_run_at are unchanged', {
      failure: loggableFailure(error),
      variable: error instanceof IngestConfigError ? error.variable : null,
    })
    return null
  }
}

/**
 * Runs one ingestion pass, then pokes the extraction worker once.
 *
 * The worker is poked **even when the run failed**: rows staged by earlier
 * runs may still be waiting, and a broken mailbox must not stall them.
 *
 * @param extractUrl Absolute URL of `POST /api/ingest/extract`.
 * @param secret `INGEST_TRIGGER_SECRET`, sent to the worker route.
 * @param deps Injected collaborators; production wiring by default.
 * @returns The run summary, or `null` when the run failed (logged).
 */
export async function runAndKick(
  extractUrl: string,
  secret: string,
  deps: RunTriggerDeps = defaultRunTriggerDeps,
): Promise<IngestRunSummary | null> {
  const summary = await runLogged(deps)
  // A failed poke is logged by `postTrigger`; the next trigger retries.
  await postTrigger('runTrigger: extraction worker poke', extractUrl, secret, deps.fetch)
  return summary
}
