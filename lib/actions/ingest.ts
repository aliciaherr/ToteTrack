'use server'

import { IngestConfigError } from '@/lib/errors'
import { ingestRouteUrl } from '@/lib/ingest/app-origin'
import { triggerAuthHeaders } from '@/lib/ingest/trigger-auth'
import { loggableFailure } from '@/lib/loggable-failure'
import { assertAuthenticated, GENERIC_FAILURE_MESSAGE } from './auth.guard'

/**
 * The manual ingestion trigger (Feature 16, Task 104). Task 105's button
 * calls it. It does not run ingestion itself: it POSTs `/api/ingest/run`, the
 * same route the cron calls, so there is one code path and one `maxDuration`.
 */

const RUN_ROUTE_PATH = '/api/ingest/run'

/** How long to wait for the route's 202. It answers in milliseconds. */
const TRIGGER_RESPONSE_TIMEOUT_MS = 10_000

function triggerSecret(): string {
  const secret = process.env.INGEST_TRIGGER_SECRET?.trim()
  if (!secret) {
    throw new IngestConfigError(
      'INGEST_TRIGGER_SECRET',
      'is missing or empty. Set it in .env and in the Vercel environment; .env.example lists the expected shape.',
    )
  }
  return secret
}

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

    const response = await fetch(ingestRouteUrl(RUN_ROUTE_PATH), {
      method: 'POST',
      headers: triggerAuthHeaders(triggerSecret()),
      // A redirect is a refusal, never followed (LOW-T104-2).
      redirect: 'manual',
      signal: AbortSignal.timeout(TRIGGER_RESPONSE_TIMEOUT_MS),
    })
    if (response.status !== 202) {
      console.error('triggerIngestion: the run route refused the trigger', { status: response.status })
      return { error: GENERIC_FAILURE_MESSAGE }
    }
    return { accepted: true }
  } catch (error) {
    console.error('triggerIngestion: could not start an ingestion run', {
      failure: loggableFailure(error),
      variable: error instanceof IngestConfigError ? error.variable : null,
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}
