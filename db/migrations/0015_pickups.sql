-- Pickups — Feature 15 (PRD).
--
-- Collecting empty totes back from a customer is real scheduled work that the
-- app had no record of. This is a NEW, SEPARATE entity — deliberately not a
-- flag on `orders`. Migration 0014 already renamed `orders.pickup_only` to
-- `customer_collects` so the word "pickup" stops pointing at the opposite
-- concept (the customer collecting their own order).
--
-- Shape notes:
--   * No price, no number, no document, no invoice link — a pickup appears on
--     no revenue, invoice or dashboard surface. There is nothing to bill.
--   * `pickup_date` IS the calendar placement, unlike orders where the
--     delivery promise (`requested_delivery_date`) and the build day
--     (`production_date`) are separate columns. NULL = unscheduled, and the
--     pickup sits in the calendar's unscheduled callout.
--   * `sort_index` is the position within a day column, NULL until a human
--     places the card by hand — same semantics as
--     `orders.production_sort_index`.
--   * `address` is a plain text snapshot, never an FK into
--     `customer_addresses` (CONSTRAINT-21) — editing a saved address must
--     never rewrite a historical pickup.
--   * FK is ON DELETE RESTRICT, matching `orders.customer_id`: pickup history
--     must never be orphaned by a customer delete. `deleteCustomer` counts
--     these rows and refuses with a readable message (CONSTRAINT-13) so the
--     salesperson never sees a raw FK error.
--
-- Purely additive: no existing table, column or enum is dropped or altered.
-- RLS on the new table copies the 0002 single-user pattern — any authenticated
-- session has full access, unauthenticated queries return 0 rows.
--
-- Applied by hand via the Supabase SQL Editor — this repo has no CLI migration
-- runner. NOT re-runnable by design: a second run fails on CREATE TYPE.

CREATE TYPE "pickup_status" AS ENUM ('scheduled', 'completed', 'cancelled');
--> statement-breakpoint
CREATE TABLE "pickups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "pickup_status" DEFAULT 'scheduled' NOT NULL,
	"qty_275" integer DEFAULT 0 NOT NULL,
	"qty_330" integer DEFAULT 0 NOT NULL,
	"pickup_date" date,
	"sort_index" integer,
	"address" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "pickups_customer_id_idx" ON "pickups" ("customer_id");
--> statement-breakpoint
CREATE INDEX "pickups_status_idx" ON "pickups" ("status");
--> statement-breakpoint
CREATE INDEX "pickups_pickup_date_idx" ON "pickups" ("pickup_date");
--> statement-breakpoint
ALTER TABLE "pickups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "authenticated_access" ON "pickups"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
