/**
 * Replays db/migrations/*.sql in order against the LOCAL Supabase stack.
 *
 * Usage: npm run db:migrate-local
 *
 * Why not drizzle-kit migrate: meta/_journal.json lists only 0001, so it would
 * skip 0002 onwards. db/migrations/ stays the single source of truth — do not
 * copy these files into supabase/migrations/.
 *
 * Each file runs in its own transaction and is recorded in
 * public._local_migrations, so re-running applies only new files.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'
import { requireLocalDatabaseUrl } from './local-guard'

const MIGRATIONS_DIR = join(__dirname, 'migrations')
const MIGRATION_FILE = /^\d{4}_.+\.sql$/

async function main() {
  const sql = postgres(requireLocalDatabaseUrl('migrate-local'), { max: 1, onnotice: () => {} })
  try {
    await sql`CREATE TABLE IF NOT EXISTS public._local_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`
    const applied = new Set((await sql<{ name: string }[]>`SELECT name FROM public._local_migrations`).map((r) => r.name))
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => MIGRATION_FILE.test(f)).sort()

    for (const file of files) {
      if (applied.has(file)) continue
      const body = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(body)
          await tx`INSERT INTO public._local_migrations (name) VALUES (${file})`
        })
      } catch (err) {
        throw new Error(`[migrate-local] FAILED applying ${file}`, { cause: err })
      }
      console.log(`[migrate-local] applied ${file}`)
    }
    console.log(`[migrate-local] done — ${files.length} files, ${files.length - applied.size} newly applied`)
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
