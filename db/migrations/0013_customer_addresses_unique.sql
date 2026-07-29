-- Unique (customer_id, address) on customer_addresses — audit finding L-03.
--
-- Closes the check-then-insert race behind the address dedupe: both
-- `addCustomerAddress` (Task 71) and `recordDeliveryAddressUsage` (Feature 14)
-- probed for an exact-text match and then inserted when none was found — two
-- concurrent submits of the same address could both miss the probe and land
-- duplicate rows. The code moves to a single INSERT ... ON CONFLICT upsert;
-- ON CONFLICT requires this unique index, so apply this migration BEFORE
-- deploying the upsert code.
--
-- The DELETE below defensively collapses any duplicates that already slipped
-- in (the table is young, but the index creation would otherwise abort).
-- Per (customer_id, address) group it keeps the row with the greatest
-- last_used_at (NULLs last — a used row beats an unused one), tie-broken by
-- earliest created_at, then id for full determinism; every other row in the
-- group is deleted. Dedupe stays case- and whitespace-sensitive — only
-- character-for-character duplicates collapse, matching the code's plain `=`
-- rule.
--
-- No existing table or column is dropped or altered. RLS is untouched.
--
-- Applied by hand via the Supabase SQL Editor — this repo has no CLI migration
-- runner. NOT re-runnable by design: a second run fails on CREATE UNIQUE
-- INDEX (the DELETE alone is harmless to re-run — it only removes duplicates,
-- which no longer exist).

DELETE FROM "customer_addresses"
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY customer_id, address
             ORDER BY last_used_at DESC NULLS LAST, created_at ASC, id ASC
           ) AS rn
    FROM "customer_addresses"
  ) ranked
  WHERE ranked.rn > 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX "customer_addresses_customer_id_address_uq" ON "customer_addresses" ("customer_id", "address");
