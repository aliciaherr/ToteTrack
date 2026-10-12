import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const migrationPath = path.resolve(__dirname, '../0020_customer_matcher.sql')
const sql = readFileSync(migrationPath, 'utf-8')

/** Everything after the comment lines — the statements actually executed. */
const statement = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

describe('Migration 0020 — customer matcher (Task 102, A-12)', () => {
  it('enables pg_trgm in the extensions schema, re-runnably', () => {
    expect(statement).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;/)
  })

  it.each(['normalise_company_name', 'normalise_address'])('defines %s as IMMUTABLE with an empty search_path', (name) => {
    const start = statement.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
    expect(start).toBeGreaterThan(-1)
    const header = statement.slice(start, statement.indexOf('AS $$', start))
    expect(header).toMatch(/IMMUTABLE/)
    expect(header).toMatch(/SET search_path = ''/)
  })

  it('revokes EXECUTE on both functions from the API roles', () => {
    for (const name of ['normalise_company_name', 'normalise_address']) {
      expect(statement).toMatch(
        new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\(text\\) FROM PUBLIC, anon, authenticated;`),
      )
    }
  })

  it('creates no index, table or column', () => {
    expect(statement).not.toMatch(/CREATE (?:UNIQUE )?INDEX|CREATE TABLE|ALTER TABLE/i)
  })

  it('writes no rows', () => {
    expect(statement).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/im)
  })
})
