-- Give-up counter per failing UID — Feature 16, Task 114 (CONSTRAINT-37, HIGH-02R).
--
-- A UID whose staging fails halts the watermark and is retried next run. That
-- is right for a transient fault and wrong for a deterministic one, which
-- would pin the watermark forever. This table counts the runs in which a UID
-- failed; after `GIVE_UP_MIN_ATTEMPTS` runs **and** `GIVE_UP_MIN_AGE_MS` since
-- the first failure, `runIngestion` stages a header-free placeholder and the
-- watermark passes it (docs/architecture.md, "Give-up rule").
--
-- Shape notes:
--   * Keyed by `(uid_validity, uid)`, the same marker as `inbound_emails`
--     (CONSTRAINT-33). No FK: a failing UID has no `inbound_emails` row by
--     definition.
--   * `attempts` is the number of failing runs, never deferred ones.
--   * `first_failed_at` is kept on every increment; it is what the one-hour
--     age is measured from. `last_failed_at` is for diagnosis only.
--   * Rows hold integers and timestamps only, nothing a sender wrote (SEC-05).
--   * A row is deleted when its UID commits or gives up, and every row of an
--     old UIDVALIDITY is deleted when the server reports a new one.
--   * `bigint`, not `integer`: IMAP UIDs and UIDVALIDITY are unsigned 32-bit.
--
-- RLS copies the 0002 single-user pattern (CONSTRAINT-05).
--
-- Prod: paste into the Supabase SQL editor before Task 104. Local:
-- `npm run db:migrate-local`. Never `db:migrate`. NOT re-runnable: a second
-- run fails on CREATE TABLE.

CREATE TABLE "ingest_uid_failures" (
	"uid_validity" bigint NOT NULL,
	"uid" bigint NOT NULL,
	"attempts" integer NOT NULL,
	"first_failed_at" timestamp with time zone NOT NULL,
	"last_failed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ingest_uid_failures_pkey" PRIMARY KEY ("uid_validity", "uid")
);
--> statement-breakpoint
ALTER TABLE "ingest_uid_failures" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "authenticated_access" ON "ingest_uid_failures"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
