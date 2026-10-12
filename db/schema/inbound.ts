import {
  pgTable,
  text,
  uuid,
  integer,
  bigint,
  jsonb,
  timestamp,
  index,
  unique,
  primaryKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import {
  inboundEmailClassificationEnum,
  inboundPoSourceKindEnum,
  inboundPoStatusEnum,
} from './enums'
import { orders } from './orders'

/**
 * Emails read from the ingestion mailbox (Feature 16, migrations 0016 + 0017).
 *
 * Two tables, not one: an email yields 0..n purchase orders — three
 * attachments are three POs — so the email row is the **processed marker**
 * and `inbound_pos` holds the review queue.
 *
 * The marker is `(uid_validity, uid)` — two integers the IMAP server assigns,
 * which no sender can influence (CONSTRAINT-33). The composite unique is what
 * makes a re-run after a crash idempotent. Read state in Gmail never decides
 * what the ingester processes.
 *
 * `message_id` is a **label**: stored for display and tracing, nullable, not
 * unique, and no code branches on it (architecture rule 2). Until 0017 it was
 * the marker, and a sender-written header as a marker is what HIGH-01 was.
 *
 * `message_id`, `from_address`, `subject` and `received_at` are nullable
 * because they come from sender-controlled MIME headers, any of which can be
 * absent on a malformed message.
 *
 * `bigint` in `number` mode: IMAP UIDs are unsigned 32-bit, past Postgres
 * `integer` but far inside `Number.MAX_SAFE_INTEGER`.
 */
export const inboundEmails = pgTable('inbound_emails', {
  id: uuid('id').primaryKey().defaultRandom(),
  uid_validity: bigint('uid_validity', { mode: 'number' }).notNull(),
  uid: bigint('uid', { mode: 'number' }).notNull(),
  message_id: text('message_id'),
  classification: inboundEmailClassificationEnum('classification').notNull(),
  from_address: text('from_address'),
  subject: text('subject'),
  received_at: timestamp('received_at', { withTimezone: true }),
  processed_at: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('inbound_emails_uid_validity_uid_unique').on(t.uid_validity, t.uid),
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
  // Migration 0021 (FB-42). The normalised body of an `email_body` PO, in
  // full; a CHECK keeps it NULL on `pdf` and `image` rows.
  body_text: text('body_text'),
  // The worker's lease: a row at `extracting` is reclaimable once this is
  // older than `EXTRACTION_LEASE_MS` (Task 115). On a released
  // `pending_extraction` row it is the release time, which holds the row back
  // for `EXTRACTION_RETRY_DELAY_MS` (MEDIUM-10).
  extraction_started_at: timestamp('extraction_started_at', { withTimezone: true }),
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

/**
 * The UID watermark, one row per mailbox (Feature 16, migration 0017).
 *
 * `last_uid` is the highest UID such that every listed message at or below it
 * is committed; the next run lists from `last_uid + 1`. It belongs to
 * `uid_validity` — when the server reports a different UIDVALIDITY every UID
 * is invalid and the watermark restarts at 0 (`lib/ingest/run.ts`).
 */
export const ingestMailboxState = pgTable('ingest_mailbox_state', {
  mailbox: text('mailbox').primaryKey(),
  uid_validity: bigint('uid_validity', { mode: 'number' }).notNull(),
  last_uid: bigint('last_uid', { mode: 'number' }).notNull(),
  last_run_at: timestamp('last_run_at', { withTimezone: true }),
})

/**
 * Failing runs per UID, for the give-up rule (Feature 16, migration 0019;
 * CONSTRAINT-37). A UID failing on `GIVE_UP_MIN_ATTEMPTS` runs and for at
 * least `GIVE_UP_MIN_AGE_MS` becomes a header-free placeholder, so no message
 * can pin the watermark. The row is deleted when the UID commits or gives up.
 * Integers and timestamps only: nothing a sender wrote (SEC-05).
 */
export const ingestUidFailures = pgTable('ingest_uid_failures', {
  uid_validity: bigint('uid_validity', { mode: 'number' }).notNull(),
  uid: bigint('uid', { mode: 'number' }).notNull(),
  attempts: integer('attempts').notNull(),
  first_failed_at: timestamp('first_failed_at', { withTimezone: true }).notNull(),
  last_failed_at: timestamp('last_failed_at', { withTimezone: true }).notNull(),
}, (t) => [
  primaryKey({ name: 'ingest_uid_failures_pkey', columns: [t.uid_validity, t.uid] }),
])
