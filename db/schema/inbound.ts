import {
  pgTable,
  text,
  uuid,
  integer,
  jsonb,
  timestamp,
  index,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import {
  inboundEmailClassificationEnum,
  inboundPoSourceKindEnum,
  inboundPoStatusEnum,
} from './enums'
import { orders } from './orders'

/**
 * Emails read from the ingestion mailbox (Feature 16, migration 0016).
 *
 * Two tables, not one: an email yields 0..n purchase orders — three
 * attachments are three POs — so the email row is the **processed marker**
 * and `inbound_pos` holds the review queue.
 *
 * `message_id` is NOT NULL UNIQUE and carries two jobs. It is dedupe layer 1,
 * and it replaces the IMAP `\Seen` flag as the record of what has already
 * been handled: read state in Gmail must never decide what the ingester
 * processes, because opening the inbox by hand would then skip work.
 *
 * `from_address`, `subject` and `received_at` are nullable because they come
 * from sender-controlled MIME headers, any of which can be absent on a
 * malformed message. `message_id` is the only header the pipeline insists on.
 */
export const inboundEmails = pgTable('inbound_emails', {
  id: uuid('id').primaryKey().defaultRandom(),
  message_id: text('message_id').notNull().unique(),
  classification: inboundEmailClassificationEnum('classification').notNull(),
  from_address: text('from_address'),
  subject: text('subject'),
  received_at: timestamp('received_at', { withTimezone: true }),
  processed_at: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('inbound_emails_classification_idx').on(t.classification),
  index('inbound_emails_received_at_idx').on(t.received_at),
])

/**
 * Staged purchase-order candidates awaiting extraction and human review
 * (Feature 16, migration 0016). `pos` is short for purchase orders, matching
 * `orders.po_number` and `po_status` elsewhere in this schema.
 *
 * `document_path` is NULL exactly when `source_kind` is `email_body` — the PO
 * is the message text and there is no stored file. Stored documents live only
 * in the private `po-documents` bucket (CONSTRAINT-06), never in the repo.
 *
 * `extracted` and `confirmed` are both retained on purpose. Together they are
 * the Feature 16 success metric (share approved with zero edits) and the only
 * correction signal the later learned-alias work has to train on. Dropping
 * either loses it permanently, with no way to backfill.
 *
 * The FK to `inbound_emails` is `cascade`: a staged candidate has no meaning
 * without the email it came from. `order_id` and `duplicate_of_id` are
 * `set null`, matching `orders.invoice_id` — losing the pointer must never
 * delete the audit row.
 */
export const inboundPos = pgTable('inbound_pos', {
  id: uuid('id').primaryKey().defaultRandom(),
  inbound_email_id: uuid('inbound_email_id')
    .notNull()
    .references(() => inboundEmails.id, { onDelete: 'cascade' }),
  source_kind: inboundPoSourceKindEnum('source_kind').notNull(),
  document_path: text('document_path'),

  // NOT NULL and indexed, but deliberately **NOT UNIQUE** — do not "fix" this.
  // A duplicate document must still be insertable: the agreed design keeps
  // duplicates in the review queue flagged via `duplicate_of_id` rather than
  // rejecting them at the door, so a human decides. A unique index would make
  // that impossible and would turn a duplicate into a silent drop. This
  // supersedes an earlier brainstorm note that asked for uniqueness here.
  content_hash: text('content_hash').notNull(),

  // Self-reference, nullable: set to the first row carrying the same
  // `content_hash` when one exists, NULL when this is the first sighting.
  duplicate_of_id: uuid('duplicate_of_id').references(
    (): AnyPgColumn => inboundPos.id,
    { onDelete: 'set null' },
  ),

  status: inboundPoStatusEnum('status').notNull().default('pending_extraction'),
  attempt_count: integer('attempt_count').notNull().default(0),
  extracted: jsonb('extracted'),
  check_results: jsonb('check_results'),
  confirmed: jsonb('confirmed'),
  order_id: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  skipped_at: timestamp('skipped_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('inbound_pos_inbound_email_id_idx').on(t.inbound_email_id),
  index('inbound_pos_content_hash_idx').on(t.content_hash),
  index('inbound_pos_status_idx').on(t.status),
  index('inbound_pos_duplicate_of_id_idx').on(t.duplicate_of_id),
  index('inbound_pos_order_id_idx').on(t.order_id),
])
