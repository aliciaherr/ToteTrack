import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import { requireLocalDatabaseUrl } from '@/db/local-guard'
import { makePo } from '@/lib/checks/__tests__/fixtures'

/**
 * The extraction queue and worker against the local Supabase Postgres (TS-03,
 * Task 115): SKIP LOCKED claims, the lease, attempt counting, and one worker
 * run end to end with the real queue and matcher (extraction stubbed).
 * `npm run test:integration`.
 *
 * `claimBatch` is not scoped to this file's rows, so the suite refuses to run
 * if the database holds any other claimable row rather than claim it, and
 * `test:integration` runs files one at a time (`--no-file-parallelism`) so
 * another file's freshly staged rows are never claimed mid-test. Rows
 * hang off emails with this file's own UIDVALIDITY and are deleted after.
 */

const TEST_VALIDITY = 4_000_000_115
const LEASE_MS = 5 * 60 * 1000
const RETRY_DELAY_MS = 2 * 60 * 1000
const TIMING = { leaseMs: LEASE_MS, retryDelayMs: RETRY_DELAY_MS }
const SOURCE_MARKER = 'MARKER-SOURCE-TEXT'

type Queue = typeof import('../extraction-queue')
type Db = typeof import('@/db')['db']

describe.skipIf(!process.env.DATABASE_URL)('extraction queue (local Postgres)', () => {
  let queue: Queue
  let db: Db
  let sql: typeof import('drizzle-orm')['sql']
  let stageEmailWithPos: typeof import('../inbound-emails')['stageEmailWithPos']
  let nextUid = 1

  const removeTestRows = () => db.execute(sql`DELETE FROM inbound_emails WHERE uid_validity = ${TEST_VALIDITY}`)

  async function stage(count: number, kind: 'pdf' | 'email_body' = 'pdf'): Promise<string[]> {
    const uid = nextUid++
    const rows = Array.from({ length: count }, (_, i) => {
      const hash = `${uid}-${i}`.padEnd(64, '0')
      return kind === 'pdf'
        ? { source_kind: kind, document_path: `inbound/${hash}.pdf`, body_text: null, content_hash: hash }
        : { source_kind: kind, document_path: null, body_text: 'po body', content_hash: hash }
    })
    const email = { uid_validity: TEST_VALIDITY, uid, message_id: null, classification: 'po_found' as const, from_address: null, subject: null, received_at: null }
    const result = await stageEmailWithPos(email, rows)
    if ('duplicate' in result) throw new Error(`uid ${uid} already staged`)
    const staged = (await db.execute(sql`SELECT id FROM inbound_pos WHERE inbound_email_id = ${result.id}`)) as unknown as { id: string }[]
    return staged.map((row) => row.id)
  }

  async function row(id: string) {
    const [found] = (await db.execute(sql`SELECT * FROM inbound_pos WHERE id = ${id}`)) as unknown as Record<string, unknown>[]
    return found
  }

  beforeAll(async () => {
    requireLocalDatabaseUrl('extraction-queue.integration.test')
    db = (await import('@/db')).db
    sql = (await import('drizzle-orm')).sql
    queue = await import('../extraction-queue')
    stageEmailWithPos = (await import('../inbound-emails')).stageEmailWithPos
    await removeTestRows()
    const [{ count }] = (await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM inbound_pos WHERE status IN ('pending_extraction', 'extracting')
    `)) as unknown as { count: number }[]
    if (count > 0) throw new Error(`Local DB has ${count} claimable inbound_pos rows outside this test; the claim would take them. Clear them first.`)
  })

  beforeEach(removeTestRows)
  afterAll(async () => {
    if (db) await removeTestRows()
  })

  it('a claim skips rows another open transaction has locked, without waiting', async () => {
    const ids = await stage(4)
    let otherClaim: string[] = []

    await db.transaction(async (tx) => {
      const held = (await tx.execute(queue.buildClaimBatchQuery(2, TIMING, new Date()))) as unknown as { id: string }[]
      otherClaim = (await queue.claimBatch(10, TIMING, new Date())).map((claimed) => claimed.id)
      expect(otherClaim.filter((id) => held.some((h) => h.id === id))).toEqual([])
    })

    expect(otherClaim).toHaveLength(2)
    expect(ids).toEqual(expect.arrayContaining(otherClaim))
  })

  it('two concurrent claims never return the same row', async () => {
    await stage(6)
    const [first, second] = await Promise.all([
      queue.claimBatch(6, TIMING, new Date()),
      queue.claimBatch(6, TIMING, new Date()),
    ])
    const claimedIds = [...first, ...second].map((claimed) => claimed.id)
    expect(new Set(claimedIds).size).toBe(claimedIds.length)
    expect(claimedIds).toHaveLength(6)
  })

  it('a claim takes no more rows than its limit (CONSTRAINT-40)', async () => {
    const ids = await stage(3)

    const claimed = await queue.claimBatch(1, TIMING, new Date())

    expect(claimed).toHaveLength(1)
    const attempts = await Promise.all(ids.map(async (id) => (await row(id)).attempt_count))
    expect(attempts.sort()).toEqual([0, 0, 1])
  })

  it('counts the attempt and stamps the lease at claim time', async () => {
    const [id] = await stage(1)
    const now = new Date()

    const [claimed] = await queue.claimBatch(4, TIMING, now)

    expect(claimed).toMatchObject({ id, attempt_count: 1 })
    const stored = await row(id)
    expect(stored.status).toBe('extracting')
    expect(new Date(stored.extraction_started_at as string).getTime()).toBe(now.getTime())
  })

  it('reclaims an extracting row past its lease, and leaves one inside it', async () => {
    const [expired, live] = await stage(2)
    const now = new Date()
    const stamp = (id: string, msAgo: number) => db.execute(sql`
      UPDATE inbound_pos SET status = 'extracting', attempt_count = 1,
        extraction_started_at = ${new Date(now.getTime() - msAgo).toISOString()}::timestamptz
      WHERE id = ${id}
    `)
    await stamp(expired, LEASE_MS + 60_000)
    await stamp(live, 60_000)

    const claimed = await queue.claimBatch(4, TIMING, now)

    expect(claimed.map((c) => c.id)).toEqual([expired])
    expect(claimed[0].attempt_count).toBe(2)
  })

  it('complete, fail and release each land the row where the worker expects', async () => {
    const [done, failed, released] = await stage(3)
    await queue.claimBatch(4, TIMING, new Date())
    const results = { version: 1 as const, failures: [], quotes: [] }

    await queue.completeExtraction(done, makePo(), results)
    await queue.failExtraction(failed, results)
    await queue.releaseForRetry(released)

    expect(await row(done)).toMatchObject({ status: 'pending_review', extraction_started_at: null, check_results: results })
    expect(await row(failed)).toMatchObject({ status: 'extraction_failed', extraction_started_at: null })
    expect(await row(released)).toMatchObject({ status: 'pending_extraction', attempt_count: 1 })
    expect((await row(released)).extraction_started_at).not.toBeNull()
  })

  it('a released row is skipped until the retry delay passes (MEDIUM-10)', async () => {
    const [id] = await stage(1)
    await queue.claimBatch(1, TIMING, new Date())
    await queue.releaseForRetry(id)
    const releasedAt = new Date((await row(id)).extraction_started_at as string).getTime()

    expect(await queue.claimBatch(1, TIMING, new Date(releasedAt + RETRY_DELAY_MS - 1000))).toEqual([])
    const [again] = await queue.claimBatch(1, TIMING, new Date(releasedAt + RETRY_DELAY_MS + 1000))
    expect(again).toMatchObject({ id, attempt_count: 2 })
  })

  it('a run stopped on its first row charges no other row an attempt (MEDIUM-09)', async () => {
    const ids = await stage(3)
    const { drainExtractionBatch, defaultWorkerDeps } = await import('@/lib/ingest/worker')
    const { StorageConfigError } = await import('@/lib/storage/errors')
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(drainExtractionBatch({
      ...defaultWorkerDeps,
      readConfig: () => ({ apiKey: 'test-key-not-real', model: 'test/model' }),
      downloadPoDocument: vi.fn().mockRejectedValue(new StorageConfigError('NEXT_PUBLIC_SUPABASE_URL')),
    })).rejects.toBeInstanceOf(StorageConfigError)

    const attempts = await Promise.all(ids.map(async (id) => (await row(id)).attempt_count))
    expect(attempts.sort()).toEqual([0, 0, 1])
    vi.restoreAllMocks()
  })

  it('one worker run takes a body PO to pending_review with the match, and never stores sourceText', async () => {
    const [id] = await stage(1, 'email_body')
    const { drainExtractionBatch, defaultWorkerDeps } = await import('@/lib/ingest/worker')
    vi.spyOn(console, 'info').mockImplementation(() => {})

    const summary = await drainExtractionBatch({
      ...defaultWorkerDeps,
      readConfig: () => ({ apiKey: 'test-key-not-real', model: 'test/model' }),
      extractPo: vi.fn().mockResolvedValue({ extracted: makePo(), sourceText: [`${SOURCE_MARKER} body`] }),
    })

    expect(summary.completed).toBe(1)
    const stored = await row(id)
    expect(stored.status).toBe('pending_review')
    expect(stored.check_results).toHaveProperty('customerMatch')
    expect(JSON.stringify(stored)).not.toContain(SOURCE_MARKER)
    vi.restoreAllMocks()
  })
})
