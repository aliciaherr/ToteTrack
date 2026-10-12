-- Processed marker becomes (UIDVALIDITY, UID) — Feature 16, Task 99 (CONSTRAINT-33).
--
-- Tasks 95–97 used the sender-written `Message-ID` header as the processed
-- marker. Two MIME libraries spell that header differently, so a message could
-- look new forever and starve the run quota — five @security findings, one root
-- cause (HIGH-01). The marker is now the pair of integers the IMAP server
-- assigns, which no sender can influence (docs/architecture.md, "The marker is
-- UID + UIDVALIDITY, and nothing else").
--
-- Shape notes:
--   * `inbound_emails` gains `uid_validity` and `uid`, both NOT NULL, with
--     UNIQUE (uid_validity, uid). That composite is what makes a re-run after a
--     crash idempotent: a UID staged but not yet behind the watermark cannot be
--     staged twice.
--   * `message_id` loses UNIQUE and NOT NULL. It is a display label now; no
--     code branches on it (architecture rule 2).
--   * `ingest_mailbox_state` holds one row per mailbox: the UIDVALIDITY the
--     watermark belongs to, the watermark itself (`last_uid`, the highest UID
--     every listed message at or below which is committed), and when the last
--     run finished. `last_uid` is 0 before any message is committed.
--   * `bigint`, not `integer`: IMAP UIDs and UIDVALIDITY are unsigned 32-bit
--     and overflow a Postgres `integer` above 2^31 - 1.
--
-- **Aborts loudly if `inbound_emails` has any row.** Existing rows have no UID
-- to backfill, and inventing one would mint exactly the false identity this
-- migration exists to remove. The table is empty in prod (nothing reaches
-- `lib/ingest/` there yet); confirm that before pasting this.
--
-- RLS on the new table copies the 0002 single-user pattern (CONSTRAINT-05).
--
-- Applied by hand via the Supabase SQL Editor in prod, and via
-- `npm run db:migrate-local` locally. Never `db:migrate`. NOT re-runnable: a
-- second run fails on ADD COLUMN.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "inbound_emails") THEN
    RAISE EXCEPTION '0017_uid_watermark: inbound_emails is not empty. Existing rows have no IMAP UID to backfill, so this migration refuses to run. Inspect the rows; the table must be empty before the processed marker can change.';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "inbound_emails" DROP CONSTRAINT "inbound_emails_message_id_unique";
--> statement-breakpoint
ALTER TABLE "inbound_emails" ALTER COLUMN "message_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD COLUMN "uid_validity" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD COLUMN "uid" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbound_emails" ADD CONSTRAINT "inbound_emails_uid_validity_uid_unique" UNIQUE ("uid_validity", "uid");
--> statement-breakpoint
CREATE TABLE "ingest_mailbox_state" (
	"mailbox" text PRIMARY KEY NOT NULL,
	"uid_validity" bigint NOT NULL,
	"last_uid" bigint NOT NULL,
	"last_run_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ingest_mailbox_state" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "authenticated_access" ON "ingest_mailbox_state"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
