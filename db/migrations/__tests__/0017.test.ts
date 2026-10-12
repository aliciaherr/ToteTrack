import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const migrationPath = path.resolve(__dirname, '../0017_uid_watermark.sql')
const sql = readFileSync(migrationPath, 'utf-8')

/** Everything after the comment lines — the statements actually executed. */
const statement = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

describe('Migration 0017 — UID watermark (CONSTRAINT-33)', () => {
  it('aborts loudly before any change when inbound_emails has a row', () => {
    const guard = statement.search(/IF EXISTS \(SELECT 1 FROM "inbound_emails"\) THEN\s*RAISE EXCEPTION/)
    expect(guard, 'abort-if-rows guard missing').toBeGreaterThan(-1)
    // First, so no ALTER has run when it fires.
    expect(guard).toBeLessThan(statement.indexOf('ALTER TABLE'))
  })

  it('removes every unique guarantee on message_id and makes it nullable', () => {
    // A label, not a gate (architecture rule 2).
    expect(statement).toMatch(
      /ALTER TABLE "inbound_emails" DROP CONSTRAINT "inbound_emails_message_id_unique";/,
    )
    expect(statement).toMatch(/ALTER COLUMN "message_id" DROP NOT NULL;/)
    expect(statement, 'no unique index may be added on message_id').not.toMatch(
      /UNIQUE[^\n;]*message_id|CREATE UNIQUE INDEX[^\n]*message_id/i,
    )
  })

  it('adds uid_validity and uid as NOT NULL bigint with the composite unique', () => {
    expect(statement).toMatch(/ADD COLUMN "uid_validity" bigint NOT NULL;/)
    expect(statement).toMatch(/ADD COLUMN "uid" bigint NOT NULL;/)
    expect(statement).toMatch(
      /ADD CONSTRAINT "inbound_emails_uid_validity_uid_unique" UNIQUE \("uid_validity", "uid"\);/,
    )
  })

  it('creates ingest_mailbox_state keyed by mailbox', () => {
    expect(statement).toMatch(/CREATE TABLE "ingest_mailbox_state"/)
    expect(statement).toMatch(/"mailbox" text PRIMARY KEY NOT NULL/)
    expect(statement).toMatch(/"uid_validity" bigint NOT NULL,\s*"last_uid" bigint NOT NULL/)
    expect(statement).toMatch(/"last_run_at" timestamp with time zone\s*\)/)
  })

  it('enables RLS with the 0002 authenticated_access policy on the new table', () => {
    expect(statement).toMatch(/ALTER TABLE "ingest_mailbox_state" ENABLE ROW LEVEL SECURITY/)
    expect(statement).toMatch(
      /CREATE POLICY "authenticated_access" ON "ingest_mailbox_state"\s*\n\s*FOR ALL TO authenticated USING \(true\) WITH CHECK \(true\)/,
    )
  })

  it('writes no rows', () => {
    expect(statement).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/im)
  })
})
