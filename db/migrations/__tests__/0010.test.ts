import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const migrationPath = path.resolve(__dirname, '../0010_production_calendar.sql')
const sql = readFileSync(migrationPath, 'utf-8')

describe('Migration 0010 — Production Calendar', () => {
  it('adds three production columns with correct nullability', () => {
    expect(sql).toMatch(
      /ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "production_date" date;/
    )
    expect(sql).toMatch(
      /ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "same_day_delivery" boolean NOT NULL DEFAULT false;/
    )
    expect(sql).toMatch(
      /ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "production_sort_index" integer;/
    )
  })

  it('leaves production_date and production_sort_index nullable', () => {
    const nullableColumns = ['production_date', 'production_sort_index']
    for (const col of nullableColumns) {
      const pattern = new RegExp(`ADD COLUMN IF NOT EXISTS "${col}"[^;]*NOT NULL`)
      expect(sql, `${col} must stay nullable`).not.toMatch(pattern)
    }
  })

  it('indexes production_date for calendar date-range queries', () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS "orders_production_date_idx" ON "orders" \("production_date"\);/
    )
  })

  it('is purely additive', () => {
    expect(sql, 'migration must not drop a column').not.toMatch(/DROP COLUMN/i)
    expect(sql, 'migration must not alter an existing column').not.toMatch(/ALTER COLUMN/i)
    expect(sql, 'migration must not drop a table').not.toMatch(/DROP TABLE/i)
  })

  it('never writes requested_delivery_date (CONSTRAINT-19)', () => {
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
    expect(statements).not.toMatch(/requested_delivery_date/)
  })

  it('uses the statement-breakpoint convention between statements', () => {
    const breakpoints = sql.match(/-->\s*statement-breakpoint/g) ?? []
    expect(breakpoints).toHaveLength(3)
  })
})
