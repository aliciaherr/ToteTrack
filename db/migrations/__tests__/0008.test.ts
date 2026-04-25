import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const migrationPath = path.resolve(__dirname, '../0008_po_multi_combo.sql')
const sql = readFileSync(migrationPath, 'utf-8')

describe('Migration 0008 — PO multi-combo restructure', () => {
  it('adds 6 typed quantity columns to orders (NOT NULL DEFAULT 0)', () => {
    const expectedColumns = [
      'qty_275_recon', 'qty_275_rebot', 'qty_275_new',
      'qty_330_recon', 'qty_330_rebot', 'qty_330_new',
    ]
    for (const col of expectedColumns) {
      const pattern = new RegExp(
        `ALTER TABLE "orders" ADD COLUMN "${col}" integer NOT NULL DEFAULT 0`
      )
      expect(sql, `expected ADD COLUMN for ${col}`).toMatch(pattern)
    }
  })

  it('backfills each existing single-combo row into its matching qty column', () => {
    const expectedBackfills: Array<[string, string, string]> = [
      ['qty_275_recon', '275', 'reconditioned'],
      ['qty_275_rebot', '275', 'rebottled'],
      ['qty_275_new', '275', 'brand_new'],
      ['qty_330_recon', '330', 'reconditioned'],
      ['qty_330_rebot', '330', 'rebottled'],
      ['qty_330_new', '330', 'brand_new'],
    ]
    for (const [col, size, type] of expectedBackfills) {
      const pattern = new RegExp(
        `UPDATE "orders" SET "${col}" = "quantity" WHERE "container_size" = '${size}' AND "container_type" = '${type}'`
      )
      expect(sql, `expected backfill for ${col} from (${size}, ${type})`).toMatch(pattern)
    }
  })

  it('drops the 3 legacy columns AFTER backfill (statement order is load-bearing)', () => {
    const lastBackfillIndex = sql.lastIndexOf('UPDATE "orders" SET')
    const firstDropIndex = sql.indexOf('ALTER TABLE "orders" DROP COLUMN')
    expect(firstDropIndex).toBeGreaterThan(lastBackfillIndex)

    expect(sql).toMatch(/ALTER TABLE "orders" DROP COLUMN "container_size"/)
    expect(sql).toMatch(/ALTER TABLE "orders" DROP COLUMN "container_type"/)
    expect(sql).toMatch(/ALTER TABLE "orders" DROP COLUMN "quantity"/)
  })
})
