-- Inbound email PO ingestion — Feature 16 (PRD).
--
-- Staging for purchase orders that arrive by email, before a human approves
-- them into `orders`. Nothing here is a real order: these are candidate
-- documents and their extracted fields, sitting in a review queue.
--
-- Two tables, not one. An email yields 0..n POs — three accepted attachments
-- are three POs — so `inbound_emails` is the processed marker and
-- `inbound_pos` is the queue.
--
-- Shape notes:
--   * `inbound_emails.message_id` is NOT NULL UNIQUE and does two jobs: it is
--     dedupe layer 1, and it replaces the IMAP `\Seen` flag as the record of
--     what has already been handled. Read state in Gmail must never decide
--     what the ingester processes — opening the inbox by hand would otherwise
--     skip work. The unique constraint is what makes a re-run idempotent.
--   * `from_address`, `subject` and `received_at` are nullable: they come from
--     sender-controlled MIME headers and any of them can be missing.
--     `message_id` is the only header the pipeline insists on.
--   * `inbound_pos.content_hash` is NOT NULL and INDEXED but deliberately
--     **NOT UNIQUE**. A duplicate document must still be insertable, because
--     the agreed design keeps duplicates in the review queue flagged via
--     `duplicate_of_id` rather than rejecting them — a human decides. A unique
--     index would make that impossible and turn a duplicate into a silent
--     drop. This supersedes an earlier brainstorm note asking for uniqueness.
--   * `duplicate_of_id` is a nullable SELF-reference: it points at the first
--     row carrying the same hash, and is NULL on a first sighting.
--   * `extracted` and `confirmed` are both kept on purpose. Together they are
--     the Feature 16 success metric (share approved with zero edits) and the
--     only correction signal the later learned-alias work can train on.
--     Dropping either loses it permanently, with no way to backfill.
--   * FK to `inbound_emails` is ON DELETE CASCADE — a staged candidate has no
--     meaning without its email. `order_id` and `duplicate_of_id` are ON
--     DELETE SET NULL, matching `orders.invoice_id`: losing a pointer must
--     never delete the audit row.
--   * `document_path` is NULL exactly when `source_kind` = 'email_body'. The
--     stored file itself lives only in the private `po-documents` bucket
--     (CONSTRAINT-06), never in this repository (CONSTRAINT-30).
--
-- Purely additive and forward-only: no existing table, column or enum is
-- dropped or altered, and no row is written.
--
-- RLS on both new tables copies the 0002 single-user pattern (CONSTRAINT-05) —
-- any authenticated session has full access, unauthenticated queries return
-- 0 rows.
--
-- Applied by hand via the Supabase SQL Editor — this repo has no CLI migration
-- runner. NOT re-runnable by design: a second run fails on CREATE TYPE.

CREATE TYPE "inbound_email_classification" AS ENUM ('po_found', 'no_po_found', 'failed');
--> statement-breakpoint
CREATE TYPE "inbound_po_source_kind" AS ENUM ('image', 'pdf', 'email_body');
--> statement-breakpoint
CREATE TYPE "inbound_po_status" AS ENUM ('pending_extraction', 'extracting', 'pending_review', 'approved', 'discarded', 'extraction_failed');
--> statement-breakpoint
CREATE TABLE "inbound_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" text NOT NULL,
	"classification" "inbound_email_classification" NOT NULL,
	"from_address" text,
	"subject" text,
	"received_at" timestamp with time zone,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbound_emails_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "inbound_pos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inbound_email_id" uuid NOT NULL,
	"source_kind" "inbound_po_source_kind" NOT NULL,
	"document_path" text,
	"content_hash" text NOT NULL,
	"duplicate_of_id" uuid,
	"status" "inbound_po_status" DEFAULT 'pending_extraction' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"extracted" jsonb,
	"check_results" jsonb,
	"confirmed" jsonb,
	"order_id" uuid,
	"skipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbound_pos" ADD CONSTRAINT "inbound_pos_inbound_email_id_inbound_emails_id_fk" FOREIGN KEY ("inbound_email_id") REFERENCES "public"."inbound_emails"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbound_pos" ADD CONSTRAINT "inbound_pos_duplicate_of_id_inbound_pos_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."inbound_pos"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbound_pos" ADD CONSTRAINT "inbound_pos_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inbound_emails_classification_idx" ON "inbound_emails" ("classification");
--> statement-breakpoint
CREATE INDEX "inbound_emails_received_at_idx" ON "inbound_emails" ("received_at");
--> statement-breakpoint
CREATE INDEX "inbound_pos_inbound_email_id_idx" ON "inbound_pos" ("inbound_email_id");
--> statement-breakpoint
CREATE INDEX "inbound_pos_content_hash_idx" ON "inbound_pos" ("content_hash");
--> statement-breakpoint
CREATE INDEX "inbound_pos_status_idx" ON "inbound_pos" ("status");
--> statement-breakpoint
CREATE INDEX "inbound_pos_duplicate_of_id_idx" ON "inbound_pos" ("duplicate_of_id");
--> statement-breakpoint
CREATE INDEX "inbound_pos_order_id_idx" ON "inbound_pos" ("order_id");
--> statement-breakpoint
ALTER TABLE "inbound_emails" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "authenticated_access" ON "inbound_emails"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "inbound_pos" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "authenticated_access" ON "inbound_pos"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
