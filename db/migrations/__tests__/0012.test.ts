import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const migrationPath = path.resolve(__dirname, '../0012_customer_addresses.sql')
const sql = readFileSync(migrationPath, 'utf-8')

/** Everything after the comment lines — the statements actually executed. */
const statement = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

describe('Migration 0012 — customer_addresses', () => {
  it('creates the customer_addresses table with the expected columns', () => {
    expect(statement).toMatch(/CREATE TABLE "customer_addresses"/)
    expect(statement).toMatch(/"id" uuid PRIMARY KEY DEFAULT gen_random_uuid\(\) NOT NULL/)
    expect(statement).toMatch(/"customer_id" uuid NOT NULL/)
    expect(statement).toMatch(/"address" text NOT NULL/)
    expect(statement).toMatch(/"created_at" timestamp with time zone DEFAULT now\(\) NOT NULL/)
    expect(statement).toMatch(/"updated_at" timestamp with time zone DEFAULT now\(\) NOT NULL/)
  })

  it('keeps last_used_at nullable — backfilled rows start unused', () => {
    expect(statement).toMatch(/"last_used_at" timestamp with time zone,/)
    expect(statement, 'last_used_at must not be NOT NULL').not.toMatch(
      /"last_used_at" timestamp with time zone[^,\n]*NOT NULL/,
    )
  })

  it('cascades deletes from customers via the FK', () => {
    expect(statement).toMatch(
      /FOREIGN KEY \("customer_id"\) REFERENCES "public"\."customers"\("id"\) ON DELETE cascade/,
    )
  })

  it('creates the customer_id index', () => {
    expect(statement).toMatch(
      /CREATE INDEX "customer_addresses_customer_id_idx" ON "customer_addresses" \("customer_id"\)/,
    )
  })

  it('backfills from the deprecated customers.default_delivery_address', () => {
    expect(statement).toMatch(/INSERT INTO customer_addresses \(customer_id, address\)/)
    expect(statement).toMatch(/SELECT id, default_delivery_address\s*\nFROM customers/)
  })

  it('skips customers with NULL or blank default addresses', () => {
    expect(statement).toMatch(/default_delivery_address IS NOT NULL/)
    expect(statement, 'blank guard').toMatch(/btrim\(default_delivery_address\) <> ''/)
  })

  it('enables RLS with the 0002 authenticated_access policy', () => {
    expect(statement).toMatch(/ALTER TABLE "customer_addresses" ENABLE ROW LEVEL SECURITY/)
    expect(statement).toMatch(
      /CREATE POLICY "authenticated_access" ON "customer_addresses"\s*\n\s*FOR ALL TO authenticated USING \(true\) WITH CHECK \(true\)/,
    )
  })

  it('is purely additive — nothing existing is dropped or altered', () => {
    expect(statement, 'must not drop anything').not.toMatch(/\bDROP\b/i)
    expect(statement, 'must not touch the customers table schema').not.toMatch(
      /ALTER TABLE "customers"/,
    )
  })
})
