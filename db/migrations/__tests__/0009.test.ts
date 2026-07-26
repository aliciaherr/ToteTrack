import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const migrationPath = path.resolve(__dirname, '../0009_po_unit_prices.sql')
const sql = readFileSync(migrationPath, 'utf-8')

describe('Migration 0009 — PO per-combo unit prices', () => {
  it('adds 6 nullable unit_price columns to orders (ADD COLUMN IF NOT EXISTS)', () => {
    const expectedColumns = [
      'unit_price_275_recon', 'unit_price_275_rebot', 'unit_price_275_new',
      'unit_price_330_recon', 'unit_price_330_rebot', 'unit_price_330_new',
    ]
    for (const col of expectedColumns) {
      const pattern = new RegExp(
        `ADD COLUMN IF NOT EXISTS ${col}\\s+numeric\\(10,2\\)`
      )
      expect(sql, `expected ADD COLUMN for ${col}`).toMatch(pattern)
    }
  })

  it('guards the backfill UPDATE with an all-NULL WHERE clause so it cannot double-apply', () => {
    const guardCols = [
      'unit_price_275_recon', 'unit_price_275_rebot', 'unit_price_275_new',
      'unit_price_330_recon', 'unit_price_330_rebot', 'unit_price_330_new',
    ]
    for (const col of guardCols) {
      const pattern = new RegExp(`o\\.${col}\\s+IS NULL`)
      expect(sql, `expected all-NULL guard on ${col}`).toMatch(pattern)
    }
  })

  it('only backfills single-combo rows (exactly one non-zero qty)', () => {
    expect(sql).toMatch(/c\.nonzero = 1/)
  })

  it('reinterprets price as the derived total (multiplies by summed quantities)', () => {
    expect(sql).toMatch(/price = o\.price \* \(o\.qty_275_recon/)
  })
})
