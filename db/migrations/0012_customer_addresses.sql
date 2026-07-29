-- Saved delivery addresses — Feature 14 (PRD).
--
-- A customer can have MULTIPLE saved delivery addresses; the order form offers
-- them most-recently-used first (last_used_at DESC NULLS LAST, created_at DESC)
-- and remembers new ones as orders are placed. `last_used_at` is NULL until an
-- address is first picked on an order — backfilled rows start unused.
--
-- BACKFILL: seeds one row per customer from the deprecated
-- `customers.default_delivery_address` so no existing address is lost. That
-- column is RETAINED for now — `useDeliveryAddressAutofill` still reads it
-- until Task 72 removes that code path; the DB column drop itself is deferred
-- to a future migration, after the feature is verified live.
--
-- Purely additive: no existing table or column is dropped or altered. RLS on
-- the new table copies the 0002 single-user pattern — any authenticated
-- session has full access, unauthenticated queries return 0 rows.
--
-- Applied by hand via the Supabase SQL Editor — this repo has no CLI migration
-- runner. NOT re-runnable by design: a second run fails on CREATE TABLE, which
-- aborts the script before the backfill could duplicate rows.

CREATE TABLE "customer_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"address" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "customer_addresses_customer_id_idx" ON "customer_addresses" ("customer_id");
--> statement-breakpoint
INSERT INTO customer_addresses (customer_id, address)
SELECT id, default_delivery_address
FROM customers
WHERE default_delivery_address IS NOT NULL
  AND btrim(default_delivery_address) <> '';
--> statement-breakpoint
ALTER TABLE "customer_addresses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "authenticated_access" ON "customer_addresses"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
