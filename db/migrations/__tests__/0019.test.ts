import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const migrationPath = path.resolve(__dirname, '../0019_ingest_uid_failures.sql')
const sql = readFileSync(migrationPath, 'utf-8')

/** Everything after the comment lines — the statements actually executed. */
const statement = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

describe('Migration 0019 — give-up counter (CONSTRAINT-37)', () => {
  it('creates ingest_uid_failures with NOT NULL bigint keys and counters', () => {
    expect(statement).toMatch(/CREATE TABLE "ingest_uid_failures"/)
    expect(statement).toMatch(/"uid_validity" bigint NOT NULL,\s*"uid" bigint NOT NULL,/)
    expect(statement).toMatch(/"attempts" integer NOT NULL,/)
    expect(statement).toMatch(/"first_failed_at" timestamp with time zone NOT NULL,/)
    expect(statement).toMatch(/"last_failed_at" timestamp with time zone NOT NULL,/)
  })

  it('keys the table by (uid_validity, uid)', () => {
    expect(statement).toMatch(
      /CONSTRAINT "ingest_uid_failures_pkey" PRIMARY KEY \("uid_validity", "uid"\)/,
    )
  })

  it('stores nothing a sender wrote', () => {
    const table = statement.slice(statement.indexOf('CREATE TABLE'), statement.indexOf(');'))
    expect(table).not.toMatch(/\btext\b|jsonb|message_id|subject|from_address/)
  })

  it('enables RLS with the 0002 authenticated_access policy', () => {
    expect(statement).toMatch(/ALTER TABLE "ingest_uid_failures" ENABLE ROW LEVEL SECURITY/)
    expect(statement).toMatch(
      /CREATE POLICY "authenticated_access" ON "ingest_uid_failures"\s*\n\s*FOR ALL TO authenticated USING \(true\) WITH CHECK \(true\)/,
    )
  })

  it('writes no rows', () => {
    expect(statement).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/im)
  })
})
