import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const migrationPath = path.resolve(__dirname, '../0021_worker_foundations.sql')
const sql = readFileSync(migrationPath, 'utf-8')

/** Everything after the comment lines — the statements actually executed. */
const statement = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

describe('Migration 0021 — worker foundations (FB-42)', () => {
  it('adds body_text and extraction_started_at as nullable, re-runnable columns', () => {
    expect(statement).toMatch(/ADD COLUMN IF NOT EXISTS "body_text" text;/)
    expect(statement).toMatch(
      /ADD COLUMN IF NOT EXISTS "extraction_started_at" timestamp with time zone;/,
    )
    expect(statement).not.toMatch(/NOT NULL|DEFAULT/i)
  })

  it('keeps body_text NULL on every non-email_body row', () => {
    expect(statement).toMatch(
      /ADD CONSTRAINT "inbound_pos_body_text_email_body_only"\s*\n\s*CHECK \("body_text" IS NULL OR "source_kind" = 'email_body'\)/,
    )
  })

  it('drops the CHECK before adding it, so a second run succeeds', () => {
    const drop = statement.indexOf('DROP CONSTRAINT IF EXISTS "inbound_pos_body_text_email_body_only"')
    const add = statement.indexOf('ADD CONSTRAINT "inbound_pos_body_text_email_body_only"')
    expect(drop).toBeGreaterThan(-1)
    expect(drop).toBeLessThan(add)
  })

  it('writes no rows', () => {
    expect(statement).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/im)
  })
})
