'use server'

import { IngestConfigError } from '@/lib/errors'
import { ingestRouteUrl } from '@/lib/ingest/app-origin'
import { postTrigger } from '@/lib/ingest/trigger-post'
import { loggableFailure } from '@/lib/loggable-failure'
import { requireEnv } from '@/lib/required-env'
import { assertAuthenticated, GENERIC_FAILURE_MESSAGE } from './auth.guard'

/**
 * The manual ingestion trigger (Feature 16, Task 104). Task 105's button
 * calls it. It does not run ingestion itself: it POSTs `/api/ingest/run`, the
 * same route the cron calls, so there is one code path and one `maxDuration`.
 */

const RUN_ROUTE_PATH = '/api/ingest/run'

/** How long to wait for the route's 202. It answers in milliseconds. */
const TRIGGER_RESPONSE_TIMEOUT_MS = 10_000

/**
 * Starts an ingestion run for the signed-in user.
 *
 * @returns `{ accepted: true }` once the route has answered 202; otherwise
 *   `{ error }`, with the cause logged (never the secret).
 */
export async function triggerIngestion(): Promise<{ error: string } | { accepted: true }> {
  try {
    const denied = await assertAuthenticated()
    if (denied) return denied

    const url = ingestRouteUrl(RUN_ROUTE_PATH)
    const secret = requireEnv(process.env, 'INGEST_TRIGGER_SECRET', (variable, detail) => new IngestConfigError(variable, detail))
    // A refusal or a network failure is logged by `postTrigger`.
    const accepted = await postTrigger('triggerIngestion: run route', url, secret, fetch, TRIGGER_RESPONSE_TIMEOUT_MS)
    return accepted ? { accepted: true } : { error: GENERIC_FAILURE_MESSAGE }
  } catch (error) {
    console.error('triggerIngestion: could not start an ingestion run', {
      failure: loggableFailure(error),
      variable: error instanceof IngestConfigError ? error.variable : null,
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}
