import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// Pool size cap per postgres-js client. Kept small because Supabase's
// transaction pooler already multiplexes real DB connections behind
// pgBouncer — client-side pooling is redundant and eats into the per-
// instance client-connection quota (free tier caps client connections
// relatively low; exceeding it throws `Max client connections reached`).
const CLIENT_POOL_MAX = 5

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set')
}

// Singleton cache keyed on globalThis so Next.js dev-mode HMR does not
// spawn a fresh `postgres()` client on every module reload (each reload
// otherwise leaks up to CLIENT_POOL_MAX connections to Supabase's pooler).
// In production the module only loads once so the cache is a no-op.
const globalForPostgres = globalThis as unknown as {
  postgresClient: ReturnType<typeof postgres> | undefined
}

// Serverless connection lifecycle (fixes the 2026-08-02 production hang):
// Vercel function instances idle between visits, and the network path
// (Supavisor / AWS NAT) silently drops idle TCP sockets after a few minutes.
// Without these timeouts postgres-js reuses the dead socket and a query
// waits forever — the user sees an infinite loading state. idle_timeout
// closes our side first so a thawed instance always dials fresh;
// max_lifetime bounds connection age; connect_timeout turns a failed dial
// into a loud error instead of a hang. Standard postgres-js serverless
// settings, per Supabase's own guidance.
const client =
  globalForPostgres.postgresClient ??
  postgres(connectionString, {
    prepare: false,
    max: CLIENT_POOL_MAX,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connect_timeout: 10,
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPostgres.postgresClient = client
}

export const db = drizzle(client, { schema })
