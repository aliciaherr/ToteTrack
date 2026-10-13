import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { requireLocalDatabaseUrl } from '@/db/local-guard'
import type { IngestState } from '@/db/queries/ingest-state'
import type { DeclaredMessage, ImapSession } from '../types'

/**
 * `runIngestion` over the production wiring (`buildIngestRunDeps`) against
 * the local Supabase Postgres (Task 104, TS-03). Only the mailbox is faked:
 * staging, state and the give-up counter are the real queries.
 *
 * Skipped, visibly, when `DATABASE_URL` is unset. `requireLocalDatabaseUrl`
 * throws on any host but localhost. The local `INBOX` state row is saved
 * first and restored after; `clearOtherValidities` wipes local give-up
 * counters, which is throwaway dev state (the ingest-failures precedent).
 */

// A UIDVALIDITY no real mailbox will report, so the rows are this file's own.
const TEST_VALIDITY = 4_000_000_104
const TEST_UID = 1

// Invented mailbox on the reserved `.test` TLD; not a real credential (SEC-01).
const ENV = {
  GMAIL_IMAP_HOST: 'imap.invalid.test',
  GMAIL_IMAP_USER: 'ingest-fixture@invalid.test',
  GMAIL_IMAP_APP_PASSWORD: 'not-a-real-app-password',
  ADMIN_EMAIL: 'admin-fixture@invalid.test',
}

const SOURCE = Buffer.from(
  [
    'Message-ID: <task-104-integration@orders.invalid.test>',
    'Subject: PO T104 integration fixture',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Please supply 40 totes against PO T104.',
    '',
  ].join('\r\n'),
)

function fakeSession(): ImapSession {
  return {
    uidValidity: TEST_VALIDITY,
    listFrom(sinceUid) {
      return (async function* listing(): AsyncGenerator<DeclaredMessage> {
        if (TEST_UID < sinceUid) return
        yield { uid: TEST_UID, declaredSize: SOURCE.length, messageId: null, from: null, subject: null, receivedAt: null, arrivedAt: null }
      })()
    },
    fetchSource: async () => SOURCE,
    close: async () => {},
  }
}

type Db = typeof import('@/db')['db']

describe.skipIf(!process.env.DATABASE_URL)('runIngestion over buildIngestRunDeps (local Postgres)', () => {
  let db: Db
  let sql: typeof import('drizzle-orm')['sql']
  let savedState: IngestState | null = null
  let stateQueries: typeof import('@/db/queries/ingest-state')

  const removeTestRows = async () => {
    await db.execute(sql`DELETE FROM inbound_pos WHERE inbound_email_id IN (SELECT id FROM inbound_emails WHERE uid_validity = ${TEST_VALIDITY})`)
    await db.execute(sql`DELETE FROM inbound_emails WHERE uid_validity = ${TEST_VALIDITY}`)
  }

  beforeAll(async () => {
    requireLocalDatabaseUrl('run-deps.integration.test')
    db = (await import('@/db')).db
    sql = (await import('drizzle-orm')).sql
    stateQueries = await import('@/db/queries/ingest-state')
    savedState = await stateQueries.readIngestState('INBOX')
    await removeTestRows()
    await db.execute(sql`DELETE FROM ingest_mailbox_state WHERE mailbox = 'INBOX'`)
  })

  afterAll(async () => {
    if (!db) return
    await removeTestRows()
    await db.execute(sql`DELETE FROM ingest_mailbox_state WHERE mailbox = 'INBOX'`)
    if (savedState) await stateQueries.writeIngestState(savedState)
  })

  it('stages a message, advances the watermark and stamps last_run_at', async () => {
    const { buildIngestRunDeps } = await import('../run-deps')
    const { runIngestion } = await import('../run')
    const deps = buildIngestRunDeps(ENV)
    deps.gmail.openSession = async () => fakeSession()

    const summary = await runIngestion(deps)

    expect(summary.staging.committedUids).toEqual([TEST_UID])
    expect(summary.watermark).toBe(TEST_UID)

    const emails = await db.execute(sql`SELECT uid FROM inbound_emails WHERE uid_validity = ${TEST_VALIDITY}`)
    expect(emails.map((row) => Number(row.uid))).toEqual([TEST_UID])

    const state = await stateQueries.readIngestState('INBOX')
    expect(state).toMatchObject({ uidValidity: TEST_VALIDITY, lastUid: TEST_UID })
    expect(state?.lastRunAt).toBeInstanceOf(Date)
  })
})
