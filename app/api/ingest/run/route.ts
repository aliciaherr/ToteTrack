import { after } from 'next/server'
import { ingestRouteUrl } from '@/lib/ingest/app-origin'
import { runAndKick } from '@/lib/ingest/run-trigger'
import { isAuthorisedTrigger } from '@/lib/ingest/trigger-auth'
import { loggableFailure } from '@/lib/loggable-failure'

/**
 * `/api/ingest/run`: one ingestion run, then a poke at the extraction worker
 * (Feature 16, Task 104). Two callers, each with its own secret:
 *
 * - `GET`: the Vercel cron (`vercel.json`, `0 11 * * *` UTC), which sends
 *   `Authorization: Bearer <CRON_SECRET>`.
 * - `POST`: the manual trigger (`triggerIngestion`), which sends
 *   `INGEST_TRIGGER_SECRET`.
 *
 * No user session; the secret is the only gate, so `proxy.ts` must never
 * redirect it. Answers 202 at once and runs in `after()`.
 *
 * Overlapping runs are allowed by decision (builder 2026-10-12): staging is
 * unique per UID and uploads are idempotent, so a second run only re-lists.
 */

/**
 * Seconds one invocation may run, the `after()` work included. 300 is the
 * Hobby ceiling with Fluid Compute. Must be a literal for Next's analysis.
 */
export const maxDuration = 300

type TriggerSecretName = 'CRON_SECRET' | 'INGEST_TRIGGER_SECRET'
type RequiredVariable = TriggerSecretName | 'INGEST_APP_ORIGIN'

const WORKER_SECRET: TriggerSecretName = 'INGEST_TRIGGER_SECRET'
const EXTRACT_ROUTE_PATH = '/api/ingest/extract'

function notConfigured(variable: RequiredVariable, error: unknown): Response {
  console.error('ingestRunRoute: refusing every call until its config is set', {
    variable,
    failure: loggableFailure(error),
  })
  return Response.json({ error: 'Ingestion trigger is not configured' }, { status: 500 })
}

/**
 * Checks `request` against `callerSecret`, then schedules the run.
 *
 * The worker secret is required too, whichever caller this is: the run ends
 * by poking the worker route with it, at `INGEST_APP_ORIGIN`.
 */
function accept(request: Request, callerSecret: TriggerSecretName): Response {
  const secret = process.env[callerSecret]
  let authorised: boolean
  try {
    authorised = isAuthorisedTrigger(request, secret)
  } catch (error) {
    return notConfigured(callerSecret, error)
  }
  if (!authorised) return Response.json({ error: 'Unauthorised' }, { status: 401 })

  const workerSecret = process.env[WORKER_SECRET]?.trim()
  if (!workerSecret) return notConfigured(WORKER_SECRET, new Error(`${WORKER_SECRET} is unset`))

  // The configured origin, never `request.url`: the worker secret must not
  // follow a caller-chosen `Host` (LOW-T104-1).
  let extractUrl: string
  try {
    extractUrl = ingestRouteUrl(EXTRACT_ROUTE_PATH)
  } catch (error) {
    return notConfigured('INGEST_APP_ORIGIN', error)
  }
  after(() => runAndKick(extractUrl, workerSecret))
  return Response.json({ accepted: true }, { status: 202 })
}

/**
 * The cron caller.
 *
 * @returns 202 when accepted, 401 for a missing or wrong secret, 500 when a
 *   secret is not configured. The body never echoes the request.
 */
export async function GET(request: Request): Promise<Response> {
  return accept(request, 'CRON_SECRET')
}

/**
 * The manual caller.
 *
 * @returns 202 when accepted, 401 for a missing or wrong secret, 500 when the
 *   secret is not configured. The body never echoes the request.
 */
export async function POST(request: Request): Promise<Response> {
  return accept(request, 'INGEST_TRIGGER_SECRET')
}
