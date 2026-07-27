-- Production Calendar — Feature 11 (D16 / CONSTRAINT-19).
--
-- Adds the build-day columns that back the /calendar screen. The build day is
-- deliberately its own column: `requested_delivery_date` stays the customer-facing
-- promise and is editable only in the Orders tab. The calendar reads and writes
-- `production_date` + `production_sort_index` and must never touch the promise
-- (CONSTRAINT-19).
--
--   * production_date       — nullable build day. NULL means "not explicitly
--                             placed"; the calendar falls back to
--                             prevBusinessDay(requested_delivery_date) for
--                             positioning. No production date ever falls on a
--                             weekend.
--   * same_day_delivery     — NOT NULL DEFAULT false. Marks a PO that is built
--                             and delivered on the same day.
--   * production_sort_index — nullable intra-day sequence within a column.
--
-- Purely additive and reversible: no existing column is altered or dropped, and
-- there is no backfill. Every existing row gets NULL / false / NULL, which is the
-- correct starting state — the calendar derives placement from the delivery date
-- until a card is explicitly dragged.
--
-- RLS on `orders` is untouched and still enforced (CONSTRAINT-05) — adding a
-- column does not change the table's policies.
--
-- Idempotent by design (applied by hand via the Supabase SQL Editor; there is no
-- CLI migration runner in this repo): IF NOT EXISTS on every ADD COLUMN and on
-- the index, so re-running is a no-op.

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "production_date" date;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "same_day_delivery" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "production_sort_index" integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_production_date_idx" ON "orders" ("production_date");
