import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const migrationPath = path.resolve(__dirname, '../0015_pickups.sql')
const sql = readFileSync(migrationPath, 'utf-8')

/** Everything after the comment lines — the statements actually executed. */
const statement = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

describe('Migration 0015 — pickups', () => {
  it('creates the pickup_status enum with exactly three values', () => {
    expect(statement).toMatch(
      /CREATE TYPE "pickup_status" AS ENUM \('scheduled', 'completed', 'cancelled'\);/,
    )
    // No 'invoiced' — a pickup is never billed (PRD Feature 15).
    expect(statement, 'pickups are never invoiced').not.toMatch(/'invoiced'/)
  })

  it('creates the pickups table with the expected columns', () => {
    expect(statement).toMatch(/CREATE TABLE "pickups"/)
    expect(statement).toMatch(/"id" uuid PRIMARY KEY DEFAULT gen_random_uuid\(\) NOT NULL/)
    expect(statement).toMatch(/"customer_id" uuid NOT NULL/)
    expect(statement).toMatch(/"status" "pickup_status" DEFAULT 'scheduled' NOT NULL/)
    expect(statement).toMatch(/"qty_275" integer DEFAULT 0 NOT NULL/)
    expect(statement).toMatch(/"qty_330" integer DEFAULT 0 NOT NULL/)
    expect(statement).toMatch(/"created_at" timestamp with time zone DEFAULT now\(\) NOT NULL/)
    expect(statement).toMatch(/"updated_at" timestamp with time zone DEFAULT now\(\) NOT NULL/)
  })

  it('keeps pickup_date, sort_index, address and notes nullable', () => {
    for (const column of [
      '"pickup_date" date,',
      '"sort_index" integer,',
      '"address" text,',
      '"notes" text,',
    ]) {
      expect(statement, `${column} must be nullable`).toContain(column)
    }
    expect(statement, 'pickup_date must not be NOT NULL').not.toMatch(
      /"pickup_date" date[^,\n]*NOT NULL/,
    )
    expect(statement, 'address must not be NOT NULL').not.toMatch(/"address" text[^,\n]*NOT NULL/)
  })

  it('restricts deletes from customers via the FK (CONSTRAINT-13)', () => {
    expect(statement).toMatch(
      /FOREIGN KEY \("customer_id"\) REFERENCES "public"\."customers"\("id"\) ON DELETE restrict/,
    )
    expect(statement, 'pickup history must never cascade away').not.toMatch(
      /REFERENCES "public"\."customers"\("id"\) ON DELETE cascade/,
    )
  })

  it('creates the customer_id, status and pickup_date indexes', () => {
    expect(statement).toMatch(
      /CREATE INDEX "pickups_customer_id_idx" ON "pickups" \("customer_id"\)/,
    )
    expect(statement).toMatch(/CREATE INDEX "pickups_status_idx" ON "pickups" \("status"\)/)
    expect(statement).toMatch(
      /CREATE INDEX "pickups_pickup_date_idx" ON "pickups" \("pickup_date"\)/,
    )
  })

  it('enables RLS with the 0002 authenticated_access policy', () => {
    expect(statement).toMatch(/ALTER TABLE "pickups" ENABLE ROW LEVEL SECURITY/)
    expect(statement).toMatch(
      /CREATE POLICY "authenticated_access" ON "pickups"\s*\n\s*FOR ALL TO authenticated USING \(true\) WITH CHECK \(true\)/,
    )
  })

  it('carries no price, document or invoice column', () => {
    // PRD Feature 15: pickups appear on no revenue, invoice or document
    // surface. A column here would be the first crack in that rule.
    for (const forbidden of ['price', 'invoice_id', 'document_url', 'po_number']) {
      expect(statement, `pickups must not have a ${forbidden} column`).not.toMatch(
        new RegExp(`"${forbidden}"`),
      )
    }
  })

  it('is purely additive — nothing existing is dropped or altered', () => {
    expect(statement, 'must not drop anything').not.toMatch(/\bDROP\b/i)
    // Statement-initial DML only — `ON DELETE restrict` in the FK clause is
    // the FK's referential action, not a row-deleting statement.
    expect(statement, 'must not write rows').not.toMatch(
      /^\s*(?:INSERT|UPDATE|DELETE)\b/im,
    )
    expect(statement, 'must not touch the orders table').not.toMatch(/ALTER TABLE "orders"/)
    expect(statement, 'must not touch the customers table').not.toMatch(/ALTER TABLE "customers"/)
  })
})
