import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { requireLocalDatabaseUrl } from '@/db/local-guard'

/**
 * `ingest-failures` against the local Supabase Postgres (TS-03). Needs the
 * stack running and migration 0019 applied: `npm run test:integration`.
 *
 * Skipped, visibly, when `DATABASE_URL` is unset — `npm test` does not load
 * `.env`. When it is set, `requireLocalDatabaseUrl` throws on any host but
 * localhost, so this file can never write to production. It does delete
 * every local counter row outside its own UIDVALIDITY (`clearOtherValidities`),
 * which is throwaway dev state.
 */

// A UIDVALIDITY no real mailbox will report, so the rows are this file's own.
const TEST_VALIDITY = 4_000_000_001
const OTHER_VALIDITY = 4_000_000_002

type Queries = typeof import('../ingest-failures')
type Db = typeof import('@/db')['db']

describe.skipIf(!process.env.DATABASE_URL)('ingest-failures (local Postgres)', () => {
  let queries: Queries
  let db: Db
  let sql: typeof import('drizzle-orm')['sql']

  const removeTestRows = () =>
    db.execute(sql`DELETE FROM ingest_uid_failures WHERE uid_validity IN (${TEST_VALIDITY}, ${OTHER_VALIDITY})`)

  beforeAll(async () => {
    requireLocalDatabaseUrl('ingest-failures.integration.test')
    db = (await import('@/db')).db
    sql = (await import('drizzle-orm')).sql
    queries = await import('../ingest-failures')
    await removeTestRows()
  })

  afterAll(async () => {
    if (db) await removeTestRows()
  })

  it('increments on conflict and keeps first_failed_at', async () => {
    const first = new Date('2026-10-12T04:00:00.000Z')
    const later = new Date('2026-10-12T05:30:00.000Z')

    await queries.recordFailures(TEST_VALIDITY, [11, 12], first)
    const [row] = await queries.recordFailures(TEST_VALIDITY, [11], later)

    expect(row).toEqual({
      uidValidity: TEST_VALIDITY,
      uid: 11,
      attempts: 2,
      firstFailedAt: first,
      lastFailedAt: later,
    })
  })

  it('counts a UID listed twice in one call once, instead of failing the upsert', async () => {
    const at = new Date('2026-10-12T06:00:00.000Z')

    const rows = await queries.recordFailures(TEST_VALIDITY, [21, 21], at)

    expect(rows.map(({ uid, attempts }) => ({ uid, attempts }))).toEqual([{ uid: 21, attempts: 1 }])
    await queries.clearFailures(TEST_VALIDITY, [21])
  })

  it('clears listed UIDs only', async () => {
    await queries.clearFailures(TEST_VALIDITY, [11])

    const left = await queries.recordFailures(TEST_VALIDITY, [11, 12], new Date())
    const byUid = [...left].sort((a, b) => a.uid - b.uid)
    expect(byUid.map(({ uid, attempts }) => ({ uid, attempts }))).toEqual([
      { uid: 11, attempts: 1 },
      { uid: 12, attempts: 2 },
    ])
  })

  it('clears every row of another UIDVALIDITY and keeps the current one', async () => {
    await queries.recordFailures(OTHER_VALIDITY, [11], new Date())

    await queries.clearOtherValidities(TEST_VALIDITY)

    const remaining = (await db.execute(sql`
      SELECT uid_validity FROM ingest_uid_failures
      WHERE uid_validity IN (${TEST_VALIDITY}, ${OTHER_VALIDITY})
    `)) as unknown as { uid_validity: string }[]
    expect(new Set(remaining.map((row) => Number(row.uid_validity)))).toEqual(new Set([TEST_VALIDITY]))
  })
})
