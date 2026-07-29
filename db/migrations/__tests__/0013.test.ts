import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const migrationPath = path.resolve(__dirname, '../0013_customer_addresses_unique.sql')
const sql = readFileSync(migrationPath, 'utf-8')

/** Everything after the comment lines — the statements actually executed. */
const statement = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

describe('Migration 0013 — customer_addresses unique (customer_id, address)', () => {
  it('collapses pre-existing duplicates before creating the index', () => {
    expect(statement).toMatch(/DELETE FROM "customer_addresses"/)
    expect(statement).toMatch(/ROW_NUMBER\(\) OVER \(/)
    expect(statement).toMatch(/PARTITION BY customer_id, address/)
    expect(statement, 'rows beyond the keeper are deleted').toMatch(/rn > 1/)
  })

  it('keeps the most-recently-used row: last_used_at DESC NULLS LAST, then earliest created_at', () => {
    expect(statement).toMatch(
      /ORDER BY last_used_at DESC NULLS LAST, created_at ASC, id ASC/,
    )
  })

  it('creates the unique index the ON CONFLICT upsert targets', () => {
    expect(statement).toMatch(
      /CREATE UNIQUE INDEX "customer_addresses_customer_id_address_uq" ON "customer_addresses" \("customer_id", "address"\)/,
    )
  })

  it('touches only customer_addresses — no other table is named', () => {
    // Strip string-free noise: every table reference in the executed SQL must
    // be customer_addresses.
    const tables = statement.match(/(?:FROM|INTO|TABLE|ON|UPDATE)\s+"([a-z_]+)"/g) ?? []
    for (const ref of tables) {
      expect(ref).toContain('"customer_addresses"')
    }
    expect(statement, 'must not touch the customers table').not.toMatch(/"customers"/)
    expect(statement, 'must not touch orders').not.toMatch(/"orders"/)
  })

  it('never drops a table or alters existing columns', () => {
    expect(statement, 'must not drop anything').not.toMatch(/\bDROP\b/i)
    expect(statement, 'must not alter any table').not.toMatch(/\bALTER TABLE\b/i)
  })
})
