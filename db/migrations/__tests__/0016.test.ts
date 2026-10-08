import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const migrationPath = path.resolve(__dirname, '../0016_inbound_email_ingestion.sql')
const sql = readFileSync(migrationPath, 'utf-8')

/** Everything after the comment lines — the statements actually executed. */
const statement = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

describe('Migration 0016 — inbound email ingestion', () => {
  it('creates the three Feature 16 enums with exactly their specified values', () => {
    expect(statement).toMatch(
      /CREATE TYPE "inbound_email_classification" AS ENUM \('po_found', 'no_po_found', 'failed'\);/,
    )
    expect(statement).toMatch(
      /CREATE TYPE "inbound_po_source_kind" AS ENUM \('image', 'pdf', 'email_body'\);/,
    )
    expect(statement).toMatch(
      /CREATE TYPE "inbound_po_status" AS ENUM \('pending_extraction', 'extracting', 'pending_review', 'approved', 'discarded', 'extraction_failed'\);/,
    )
  })

  it('creates inbound_emails with message_id NOT NULL UNIQUE', () => {
    expect(statement).toMatch(/CREATE TABLE "inbound_emails"/)
    expect(statement).toMatch(/"message_id" text NOT NULL/)
    // The unique constraint is dedupe layer 1 and the processed marker that
    // replaces the IMAP `\Seen` flag — it is what makes a re-run idempotent.
    expect(statement).toMatch(
      /CONSTRAINT "inbound_emails_message_id_unique" UNIQUE\("message_id"\)/,
    )
    expect(statement).toMatch(/"classification" "inbound_email_classification" NOT NULL/)
    expect(statement).toMatch(
      /"processed_at" timestamp with time zone DEFAULT now\(\) NOT NULL/,
    )
  })

  it('keeps the sender-controlled MIME header columns nullable', () => {
    for (const column of [
      '"from_address" text,',
      '"subject" text,',
      '"received_at" timestamp with time zone,',
    ]) {
      expect(statement, `${column} must be nullable`).toContain(column)
    }
  })

  it('creates inbound_pos with the expected columns and defaults', () => {
    expect(statement).toMatch(/CREATE TABLE "inbound_pos"/)
    expect(statement).toMatch(/"inbound_email_id" uuid NOT NULL/)
    expect(statement).toMatch(/"source_kind" "inbound_po_source_kind" NOT NULL/)
    expect(statement).toMatch(
      /"status" "inbound_po_status" DEFAULT 'pending_extraction' NOT NULL/,
    )
    expect(statement).toMatch(/"attempt_count" integer DEFAULT 0 NOT NULL/)
  })

  it('keeps document_path, the three jsonb columns, order_id and skipped_at nullable', () => {
    // `document_path` is NULL exactly when source_kind is 'email_body'.
    // `extracted` and `confirmed` are both retained on purpose — together they
    // are the success metric and the only correction signal available later.
    for (const column of [
      '"document_path" text,',
      '"extracted" jsonb,',
      '"check_results" jsonb,',
      '"confirmed" jsonb,',
      '"order_id" uuid,',
      '"skipped_at" timestamp with time zone,',
    ]) {
      expect(statement, `${column} must be nullable`).toContain(column)
    }
  })

  it('makes content_hash NOT NULL and indexed but deliberately NOT unique', () => {
    expect(statement).toMatch(/"content_hash" text NOT NULL/)
    expect(statement).toMatch(
      /CREATE INDEX "inbound_pos_content_hash_idx" ON "inbound_pos" \("content_hash"\)/,
    )
    // A duplicate document must still be insertable so it reaches the review
    // queue flagged via duplicate_of_id. Uniqueness here would turn a
    // duplicate into a silent drop — do not add it.
    expect(statement, 'content_hash must never be unique').not.toMatch(
      /UNIQUE[^\n]*content_hash|content_hash[^\n]*UNIQUE/i,
    )
    expect(statement, 'content_hash must have no unique index').not.toMatch(
      /CREATE UNIQUE INDEX[^\n]*content_hash/i,
    )
  })

  it('makes duplicate_of_id a nullable self-referencing FK', () => {
    expect(statement).toContain('"duplicate_of_id" uuid,')
    expect(statement).toMatch(
      /FOREIGN KEY \("duplicate_of_id"\) REFERENCES "public"\."inbound_pos"\("id"\) ON DELETE set null/,
    )
  })

  it('cascades inbound_pos from its email and set-nulls the order pointer', () => {
    // A staged candidate has no meaning without the email it came from.
    expect(statement).toMatch(
      /FOREIGN KEY \("inbound_email_id"\) REFERENCES "public"\."inbound_emails"\("id"\) ON DELETE cascade/,
    )
    // Losing the order pointer must never delete the audit row.
    expect(statement).toMatch(
      /FOREIGN KEY \("order_id"\) REFERENCES "public"\."orders"\("id"\) ON DELETE set null/,
    )
  })

  it('enables RLS with the 0002 authenticated_access policy on both tables', () => {
    for (const table of ['inbound_emails', 'inbound_pos']) {
      expect(statement).toMatch(
        new RegExp(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`),
      )
      expect(statement).toMatch(
        new RegExp(
          `CREATE POLICY "authenticated_access" ON "${table}"\\s*\\n\\s*FOR ALL TO authenticated USING \\(true\\) WITH CHECK \\(true\\)`,
        ),
      )
    }
  })

  it('is forward-only — nothing is dropped, altered away or written', () => {
    expect(statement, 'must not drop anything').not.toMatch(/\bDROP\b/i)
    // Statement-initial DML only — `ON DELETE cascade` in an FK clause is the
    // FK's referential action, not a row-deleting statement.
    expect(statement, 'must not write rows').not.toMatch(
      /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/im,
    )
    // The only ALTER TABLEs are on the two new tables (FKs and RLS).
    const alteredTables = [...statement.matchAll(/ALTER TABLE "([a-z_]+)"/g)].map((m) => m[1])
    expect([...new Set(alteredTables)].sort()).toEqual(['inbound_emails', 'inbound_pos'])
  })
})
