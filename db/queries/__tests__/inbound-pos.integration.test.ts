import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { requireLocalDatabaseUrl } from '@/db/local-guard'

/**
 * `inbound_pos` against the local Supabase Postgres (TS-03): migration 0021's
 * `body_text` column and CHECK, and the review queue's statuses. Needs the
 * stack running and 0021 applied: `npm run test:integration`.
 *
 * Skipped, visibly, when `DATABASE_URL` is unset. When set,
 * `requireLocalDatabaseUrl` throws on any host but localhost. Every row hangs
 * off emails with this file's own UIDVALIDITY and is deleted afterwards (the
 * PO rows cascade).
 */

// A UIDVALIDITY no real mailbox will report, so the rows are this file's own.
const TEST_VALIDITY = 4_000_000_103
const BODY = 'please ship 300 totes to joliet po 4471'
// Postgres SQLSTATE for a CHECK violation.
const CHECK_VIOLATION = '23514'

/** The first SQLSTATE found down an error's `cause` chain. */
function sqlState(error: unknown): string | undefined {
  for (let current = error; current instanceof Object; current = (current as { cause?: unknown }).cause) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return undefined
}

type Emails = typeof import('../inbound-emails')
type Pos = typeof import('../inbound-pos')
type Db = typeof import('@/db')['db']

describe.skipIf(!process.env.DATABASE_URL)('inbound_pos (local Postgres)', () => {
  let emails: Emails
  let pos: Pos
  let db: Db
  let sql: typeof import('drizzle-orm')['sql']

  const removeTestRows = () => db.execute(sql`DELETE FROM inbound_emails WHERE uid_validity = ${TEST_VALIDITY}`)

  function email(uid: number) {
    return {
      uid_validity: TEST_VALIDITY,
      uid,
      message_id: null,
      classification: 'po_found' as const,
      from_address: null,
      subject: null,
      received_at: null,
    }
  }

  async function stagedRows(emailId: string) {
    return (await db.execute(sql`
      SELECT id, source_kind, body_text FROM inbound_pos WHERE inbound_email_id = ${emailId} ORDER BY source_kind
    `)) as unknown as { id: string; source_kind: string; body_text: string | null }[]
  }

  async function stage(uid: number, rows: Parameters<Emails['stageEmailWithPos']>[1]): Promise<string> {
    const result = await emails.stageEmailWithPos(email(uid), rows)
    if ('duplicate' in result) throw new Error(`uid ${uid} was already staged`)
    return result.id
  }

  beforeAll(async () => {
    requireLocalDatabaseUrl('inbound-pos.integration.test')
    db = (await import('@/db')).db
    sql = (await import('drizzle-orm')).sql
    emails = await import('../inbound-emails')
    pos = await import('../inbound-pos')
    await removeTestRows()
  })

  afterAll(async () => {
    if (db) await removeTestRows()
  })

  it('stores a body PO with its text and an attachment row with NULL', async () => {
    const emailId = await stage(1, [
      { source_kind: 'email_body', document_path: null, body_text: BODY, content_hash: 'c'.repeat(64) },
      { source_kind: 'pdf', document_path: `inbound/${'d'.repeat(64)}.pdf`, body_text: null, content_hash: 'd'.repeat(64) },
    ])

    const rows = await stagedRows(emailId)

    expect(rows.map((row) => [row.source_kind, row.body_text])).toEqual([
      ['pdf', null],
      ['email_body', BODY],
    ])
  })

  it('the CHECK rejects body_text on a pdf row, and nothing of that email is staged', async () => {
    const pdfWithText = {
      source_kind: 'pdf' as const,
      document_path: `inbound/${'e'.repeat(64)}.pdf`,
      body_text: BODY,
      content_hash: 'e'.repeat(64),
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const thrown = await emails.stageEmailWithPos(email(2), [pdfWithText]).catch((e: unknown) => e)
    consoleError.mockRestore()

    expect(sqlState(thrown)).toBe(CHECK_VIOLATION)

    const [{ count }] = (await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM inbound_emails WHERE uid_validity = ${TEST_VALIDITY} AND uid = 2
    `)) as unknown as { count: number }[]
    expect(count).toBe(0)
  })

  it('lists and counts extraction_failed rows in the review queue', async () => {
    const emailId = await stage(3, [
      { source_kind: 'pdf', document_path: `inbound/${'f'.repeat(64)}.pdf`, body_text: null, content_hash: 'f'.repeat(64), status: 'extraction_failed' },
    ])
    const [row] = await stagedRows(emailId)

    const queue = await pos.listPendingReview()

    expect(queue.find((item) => item.id === row.id)?.status).toBe('extraction_failed')
    expect(await pos.countPendingReview()).toBeGreaterThanOrEqual(1)
  })
})
