import { loggableFailure } from '@/lib/loggable-failure'
import { triggerAuthHeaders } from './trigger-auth'

/**
 * The one server-to-server call that carries `INGEST_TRIGGER_SECRET`
 * (CONSTRAINT-39): the manual action, the run route's worker poke and the
 * extract route's self-chain all go through it, so the rules live in one place.
 */

/** The only answer an ingestion route gives an accepted call. */
export const TRIGGER_ACCEPTED = 202

/**
 * POSTs one internal trigger and reports whether it was accepted.
 *
 * A redirect (e.g. a protected preview's login page) is a refusal, never
 * followed and never mistaken for success (LOW-T104-2). Nothing here throws:
 * a refusal is logged as `<logLabel> refused` with its status, a thrown fetch
 * as `<logLabel> failed` through `loggableFailure`. The secret is never logged.
 *
 * @param logLabel Names the caller in the log, e.g. `extractTrigger: self-chain`.
 * @param url An absolute URL from `ingestRouteUrl`, never from the request.
 * @param secret `INGEST_TRIGGER_SECRET`.
 * @param fetchImpl `fetch`, injected in tests.
 * @param timeoutMs How long to wait for the answer; no limit when omitted.
 * @returns `true` only for a 202.
 */
export async function postTrigger(
  logLabel: string,
  url: string,
  secret: string,
  fetchImpl: typeof fetch,
  timeoutMs?: number,
): Promise<boolean> {
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: triggerAuthHeaders(secret),
      redirect: 'manual',
      ...(timeoutMs === undefined ? {} : { signal: AbortSignal.timeout(timeoutMs) }),
    })
    if (response.status === TRIGGER_ACCEPTED) return true
    console.error(`${logLabel} refused`, { status: response.status })
  } catch (error) {
    console.error(`${logLabel} failed`, { failure: loggableFailure(error) })
  }
  return false
}
