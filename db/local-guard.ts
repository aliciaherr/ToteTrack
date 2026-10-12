/**
 * Refuses to let destructive dev scripts touch anything but a local database.
 *
 * Used by db/seed.ts and db/migrate-local.ts. `.env` holds LOCAL values since
 * CONSTRAINT-20 was lifted (docs/local-dev-setup.md) — this guard is what
 * stops a stray prod string in `.env` from turning `db:wipe` into a
 * production wipe.
 */

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export function requireLocalDatabaseUrl(scriptName: string): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(`[${scriptName}] DATABASE_URL is not set. Expected the local Supabase stack in .env.`)
  }

  let host: string
  try {
    host = new URL(url).hostname
  } catch (err) {
    throw new Error(`[${scriptName}] DATABASE_URL is not a parseable URL.`, { cause: err })
  }

  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `[${scriptName}] REFUSING TO RUN: DATABASE_URL host is "${host}", not localhost. ` +
        'This script only runs against the local Supabase stack. Check .env.',
    )
  }
  return url
}
