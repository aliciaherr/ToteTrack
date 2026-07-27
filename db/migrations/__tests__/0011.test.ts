import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const migrationPath = path.resolve(__dirname, '../0011_backfill_production_date.sql')
const sql = readFileSync(migrationPath, 'utf-8')

/** Everything after the comment header — the statement actually executed. */
const statement = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

describe('Migration 0011 — backfill production_date', () => {
  it('is a data migration only — no schema is touched', () => {
    expect(statement, 'must not add a column').not.toMatch(/ADD COLUMN/i)
    expect(statement, 'must not drop a column').not.toMatch(/DROP COLUMN/i)
    expect(statement, 'must not alter a column').not.toMatch(/ALTER COLUMN/i)
    expect(statement, 'must not drop a table').not.toMatch(/DROP TABLE/i)
    expect(statement, 'must not create an index').not.toMatch(/CREATE INDEX/i)
  })

  it('updates only orders', () => {
    expect(statement).toMatch(/UPDATE "orders"/)
    const updateCount = statement.match(/UPDATE/gi)?.length ?? 0
    expect(updateCount, 'exactly one UPDATE statement').toBe(1)
  })

  it('applies the ISO day-of-week rule that matches prevBusinessDay', () => {
    // Monday → prior Friday, Sunday → prior Friday, otherwise the previous day.
    // Must stay identical to lib/dates.ts `prevBusinessDay` (CONSTRAINT-19).
    expect(statement).toMatch(/EXTRACT\(ISODOW FROM "requested_delivery_date"\)/)
    expect(statement).toMatch(/WHEN 1 THEN "requested_delivery_date" - 3/)
    expect(statement).toMatch(/WHEN 7 THEN "requested_delivery_date" - 2/)
    expect(statement).toMatch(/ELSE "requested_delivery_date" - 1/)
  })

  it('uses date arithmetic, not INTERVAL, so the column stays a date', () => {
    expect(statement, 'INTERVAL would widen the result to a timestamp').not.toMatch(
      /INTERVAL/i,
    )
  })

  it('never overwrites a production date someone set by hand', () => {
    expect(statement).toMatch(/WHERE\s+"production_date" IS NULL/)
  })

  it('skips orders with no delivery date, leaving them unscheduled', () => {
    expect(statement).toMatch(/"requested_delivery_date" IS NOT NULL/)
  })

  it('is idempotent — its WHERE clause excludes every row it has already written', () => {
    // Re-running must be a no-op: the rows it touched are no longer NULL.
    expect(statement).toMatch(/"production_date" IS NULL/)
  })

  it('documents that it must run BEFORE the code change', () => {
    // The ordering is the whole safety property: under current code this is a
    // visual no-op, which is what makes it verifiable before anything ships.
    expect(sql).toMatch(/RUN THIS \*BEFORE\* DEPLOYING THE CODE CHANGE/)
  })

  it('ships the before/after verification queries', () => {
    expect(sql).toMatch(/VERIFY BEFORE AND AFTER/)
    expect(sql, 'weekend sanity check').toMatch(/EXTRACT\(ISODOW FROM production_date\)::int > 5/)
  })
})
