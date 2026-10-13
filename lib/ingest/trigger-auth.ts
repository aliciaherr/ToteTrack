import { createHash, timingSafeEqual } from 'node:crypto'
import { IngestConfigError } from '@/lib/errors'
import { MISSING_ENV_DETAIL } from '@/lib/required-env'

/**
 * Shared-secret auth for the session-less ingestion routes (Task 116; Task
 * 104's cron and manual trigger reuse it). Callers send
 * `Authorization: Bearer <INGEST_TRIGGER_SECRET>`.
 *
 * The secret is never logged and never placed in an error message (SEC-01/05).
 */

const BEARER_PREFIX = 'Bearer '

/** Fixed-length digest, so the compare below never leaks the secret's length. */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/**
 * Whether `request` carries the trigger secret.
 *
 * Both sides are hashed before a constant-time compare, so neither the
 * content nor the length of the secret can be learnt from response timing.
 * A missing secret **throws**: an unset variable must never make the route
 * open, and it must not look like a wrong caller either.
 *
 * @param request The incoming request; only its `Authorization` header is read.
 * @param secret The expected secret as read from the environment.
 * @param variable The variable `secret` came from, named in the error when it
 *   is unset (`CRON_SECRET` for the cron caller).
 * @returns `true` only for an exact `Bearer <secret>` match.
 * @throws {IngestConfigError} when `secret` is unset or blank.
 */
export function isAuthorisedTrigger(
  request: Request,
  secret: string | undefined,
  variable = 'INGEST_TRIGGER_SECRET',
): boolean {
  const expected = secret?.trim()
  if (!expected) throw new IngestConfigError(variable, MISSING_ENV_DETAIL)
  const header = request.headers.get('authorization') ?? ''
  if (!header.startsWith(BEARER_PREFIX)) return false
  const presented = header.slice(BEARER_PREFIX.length)
  return timingSafeEqual(digest(presented), digest(expected))
}

/**
 * The header a trusted caller (the self-chain, the cron, the manual trigger)
 * sends to pass `isAuthorisedTrigger`.
 *
 * @param secret `INGEST_TRIGGER_SECRET`.
 * @returns A headers object carrying the bearer token.
 */
export function triggerAuthHeaders(secret: string): Record<string, string> {
  return { authorization: `${BEARER_PREFIX}${secret.trim()}` }
}
