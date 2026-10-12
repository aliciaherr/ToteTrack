import { after } from 'next/server'
import { drainAndChain } from '@/lib/ingest/extract-trigger'
import { isAuthorisedTrigger } from '@/lib/ingest/trigger-auth'
import { loggableFailure } from '@/lib/loggable-failure'

/**
 * `POST /api/ingest/extract`: runs one batch of the extraction worker
 * (Task 116, FB-42). Called by the cron and the manual trigger (Task 104),
 * and by itself while rows remain (A-11). It has no user session; the shared
 * secret is its only gate, so `proxy.ts` must never redirect it.
 *
 * Answers 202 at once and does the work in `after()`, so no caller is held open.
 */

/**
 * Seconds Vercel lets one invocation run, the response and the `after()` work
 * together (M-04 condition 3). Must be a literal for Next's static analysis.
 *
 * 120, not 60 (builder 2026-10-12): the worker may claim a row up to
 * `EXTRACTION_CLAIM_CUTOFF_MS` (30 s) in, and that row's model call alone may
 * take `EXTRACTION_TIMEOUT_MS` (60 s), so 60 would kill healthy rows
 * mid-call. It must stay below `EXTRACTION_LEASE_MS` (5 min), or a live row
 * could be claimed twice. A test pins both bounds.
 */
export const maxDuration = 120

/**
 * @returns 202 when accepted, 401 for a missing or wrong secret, 500 when the
 *   secret is not configured. The body never echoes the request.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.INGEST_TRIGGER_SECRET
  let authorised: boolean
  try {
    authorised = isAuthorisedTrigger(request, secret)
  } catch (error) {
    console.error('ingestExtractRoute: refusing every call until the secret is set', {
      failure: loggableFailure(error),
    })
    return Response.json({ error: 'Extraction trigger is not configured' }, { status: 500 })
  }
  if (!authorised || !secret) {
    return Response.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const selfUrl = new URL(request.url).toString()
  after(() => drainAndChain(selfUrl, secret))
  return Response.json({ accepted: true }, { status: 202 })
}
