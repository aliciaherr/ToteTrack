import { IngestConfigError } from '@/lib/errors'

/**
 * Absolute URLs for the ingestion routes, built from `INGEST_APP_ORIGIN`
 * (Task 104; LOW-T104-1, LOW-T116-1).
 *
 * Every server-to-server call that carries a trigger secret targets this
 * configured origin, never the incoming request's `Host`, so no caller can
 * steer a secret to a host of its choosing.
 */

const VARIABLE = 'INGEST_APP_ORIGIN'
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:'])

/**
 * `path` resolved against `INGEST_APP_ORIGIN`.
 *
 * @param path A route path, e.g. `/api/ingest/run`.
 * @param origin The configured origin; `process.env.INGEST_APP_ORIGIN` by default.
 * @returns The absolute URL.
 * @throws {IngestConfigError} when the origin is unset, unparseable or not http(s).
 */
export function ingestRouteUrl(path: string, origin: string | undefined = process.env[VARIABLE]): string {
  const trimmed = origin?.trim()
  const base = trimmed && URL.canParse(trimmed) ? new URL(trimmed) : null
  // Protocol first: a non-hierarchical base such as `javascript:` cannot
  // resolve a path at all.
  if (!base || !ALLOWED_PROTOCOLS.has(base.protocol)) {
    throw new IngestConfigError(
      VARIABLE,
      'is missing or not an http(s) origin. Set it in .env and per environment in Vercel; .env.example lists the expected shape.',
    )
  }
  return new URL(path, base.origin).toString()
}
