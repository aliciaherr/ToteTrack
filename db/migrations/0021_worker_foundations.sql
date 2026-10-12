-- Worker foundations — Feature 16, Task 103 (FB-42).
--
-- Two nullable columns on `inbound_pos`, and nothing else. No extraction runs
-- yet; Task 115 is the first reader of both.
--
--   * `body_text`: the normalised email body for an `email_body` PO, stored
--     in full and never truncated. It is the worker's extraction input and the
--     review screen's source pane. Before this, staging hashed the body and
--     discarded it. A CHECK keeps it NULL on every `pdf` and `image` row.
--     Refused rows are `email_body` with NULL text, which the CHECK allows.
--   * `extraction_started_at`: the worker's lease. A row left at `extracting`
--     by a killed invocation is reclaimable once this is older than
--     `EXTRACTION_LEASE_MS` (docs/architecture.md, "The extraction worker").
--
-- No backfill: prod has never ingested, so no existing row lost a body.
--
-- Prod: paste into the Supabase SQL editor before Task 104. Local:
-- `npm run db:migrate-local`. Never `db:migrate`. Re-runnable: ADD COLUMN IF
-- NOT EXISTS, and the CHECK is dropped before it is added.

ALTER TABLE "inbound_pos" ADD COLUMN IF NOT EXISTS "body_text" text;
--> statement-breakpoint
ALTER TABLE "inbound_pos" ADD COLUMN IF NOT EXISTS "extraction_started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "inbound_pos" DROP CONSTRAINT IF EXISTS "inbound_pos_body_text_email_body_only";
--> statement-breakpoint
ALTER TABLE "inbound_pos" ADD CONSTRAINT "inbound_pos_body_text_email_body_only"
  CHECK ("body_text" IS NULL OR "source_kind" = 'email_body');
