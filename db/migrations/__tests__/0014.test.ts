import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const migrationPath = path.resolve(__dirname, '../0014_rename_pickup_only.sql')
const sql = readFileSync(migrationPath, 'utf-8')

/** Everything after the comment lines — the statements actually executed. */
const statement = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

describe('Migration 0014 — rename orders.pickup_only to customer_collects', () => {
  it('renames the column and touches nothing else', () => {
    expect(statement).toMatch(
      /ALTER TABLE "orders" RENAME COLUMN "pickup_only" TO "customer_collects";/,
    )

    // The rename is the whole migration — one executed statement, no second act.
    const statements = statement.split(';').filter((s) => s.trim().length > 0)
    expect(statements, 'exactly one executed statement').toHaveLength(1)

    // No other DDL of any kind.
    expect(statement, 'must not add a column').not.toMatch(/\bADD\b/i)
    expect(statement, 'must not drop anything').not.toMatch(/\bDROP\b/i)
    expect(statement, 'must not create anything').not.toMatch(/\bCREATE\b/i)
    expect(statement, 'must not retype the column').not.toMatch(/\bALTER (?:TYPE|COLUMN)\b/i)
    expect(statement, 'must not touch RLS').not.toMatch(/ROW LEVEL SECURITY|\bPOLICY\b/i)
  })

  it('is a pure rename — no data is rewritten and no other table is named', () => {
    expect(statement, 'must not write rows').not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i)

    // Every table reference in the executed SQL must be orders.
    const tables = statement.match(/(?:FROM|INTO|TABLE|UPDATE)\s+"([a-z_]+)"/g) ?? []
    for (const ref of tables) {
      expect(ref).toContain('"orders"')
    }
    expect(statement, 'must not touch customers').not.toMatch(/"customers"/)
    expect(statement, 'must not touch customer_addresses').not.toMatch(/"customer_addresses"/)
    expect(statement, 'must not touch invoices').not.toMatch(/"invoices"/)
  })
})
