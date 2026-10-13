import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { requireLocalDatabaseUrl } from '@/db/local-guard'

/**
 * The review overlay's reads against the local Supabase Postgres (TS-03): the
 * PO-to-email join and the queue order. Needs the stack running:
 * `npm run test:integration`. Skipped, visibly, when `DATABASE_URL` is unset.
 * Every row hangs off emails with this file's own UIDVALIDITY and is deleted
 * afterwards (the PO rows cascade).
 */

// A UIDVALIDITY no real mailbox will report, so the rows are this file's own.
const TEST_VALIDITY = 4_000_000_106

type Db = typeof import('@/db')['db']
type Queries = typeof import('../review-source')

describe.skipIf(!process.env.DATABASE_URL)('review-source (local Postgres)', () => {
  let db: Db
  let sql: typeof import('drizzle-orm')['sql']
  let queries: Queries

  const removeTestRows = () => db.execute(sql`DELETE FROM inbound_emails WHERE uid_validity = ${TEST_VALIDITY}`)

  async function insertEmail(uid: number, messageId: string | null): Promise<string> {
    const [row] = (await db.execute(sql`
      INSERT INTO inbound_emails (uid_validity, uid, message_id, classification, from_address, subject, received_at)
      VALUES (${TEST_VALIDITY}, ${uid}, ${messageId}, 'po_found', 'buyer@example.com', 'PO 4471', '2026-10-12T15:04:05Z')
      RETURNING id
    `)) as unknown as { id: string }[]
    return row.id
  }

  async function insertPo(emailId: string, hash: string, extra: { checkResults?: unknown; createdAt: string }) {
    const [row] = (await db.execute(sql`
      INSERT INTO inbound_pos (inbound_email_id, source_kind, document_path, body_text, content_hash, status, check_results, created_at)
      VALUES (${emailId}, 'email_body', NULL, 'please ship 300 totes', ${hash}, 'pending_review',
              ${extra.checkResults ? JSON.stringify(extra.checkResults) : null}::jsonb, ${extra.createdAt})
      RETURNING id
    `)) as unknown as { id: string }[]
    return row.id
  }

  beforeAll(async () => {
    requireLocalDatabaseUrl('review-source.integration.test')
    db = (await import('@/db')).db
    sql = (await import('drizzle-orm')).sql
    queries = await import('../review-source')
    await removeTestRows()
  })

  afterAll(async () => {
    if (db) await removeTestRows()
  })

  it('joins a PO to its email and orders failed checks first', async () => {
    const emailId = await insertEmail(1, '<m1@example.com>')
    const older = await insertPo(emailId, 'a'.repeat(64), { createdAt: '2000-01-01T00:00:00Z' })
    const failed = await insertPo(emailId, 'b'.repeat(64), {
      createdAt: '2000-01-02T00:00:00Z',
      checkResults: { failures: [{ check: 'ingest_limit', reason: 'no_po_found', part: 'message' }] },
    })

    const ids = await queries.listReviewQueueIds()
    expect(ids.indexOf(failed)).toBeGreaterThan(-1)
    expect(ids.indexOf(failed)).toBeLessThan(ids.indexOf(older))

    const row = await queries.getReviewSourceRow(older)
    expect(row).toMatchObject({
      id: older,
      source_kind: 'email_body',
      body_text: 'please ship 300 totes',
      from_address: 'buyer@example.com',
      subject: 'PO 4471',
      received_at: '2026-10-12T15:04:05.000Z',
      message_id: '<m1@example.com>',
    })
  })

  it('returns null for an id with no PO', async () => {
    expect(await queries.getReviewSourceRow('00000000-0000-0000-0000-000000000000')).toBeNull()
  })
})
