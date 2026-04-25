-- PO multi-combo restructure — Feature 9 (D15).
--
-- Replaces the single-combo PO model (one container_size + container_type +
-- quantity per row) with a wide-row schema that holds quantities for any
-- combination of the 6 fixed size×type options (CONSTRAINT-09). Adds 6
-- typed integer columns, backfills each existing row's prior single combo
-- into the matching new column, then drops the legacy 3 columns.
--
-- Existing rows: every order has exactly one of (container_size,
-- container_type, quantity) populated → the matching qty_<size>_<type>
-- column gets that quantity; the other 5 columns stay at 0 (column default).
-- Total `price` column unchanged.
--
-- container_size and container_type enum types are intentionally NOT
-- dropped here — they remain orphaned in pg_type until a separate
-- cleanup migration after Tasks 37–43 stop referencing them in TS code.

ALTER TABLE "orders" ADD COLUMN "qty_275_recon" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "qty_275_rebot" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "qty_275_new" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "qty_330_recon" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "qty_330_rebot" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "qty_330_new" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE "orders" SET "qty_275_recon" = "quantity" WHERE "container_size" = '275' AND "container_type" = 'reconditioned';
--> statement-breakpoint
UPDATE "orders" SET "qty_275_rebot" = "quantity" WHERE "container_size" = '275' AND "container_type" = 'rebottled';
--> statement-breakpoint
UPDATE "orders" SET "qty_275_new" = "quantity" WHERE "container_size" = '275' AND "container_type" = 'brand_new';
--> statement-breakpoint
UPDATE "orders" SET "qty_330_recon" = "quantity" WHERE "container_size" = '330' AND "container_type" = 'reconditioned';
--> statement-breakpoint
UPDATE "orders" SET "qty_330_rebot" = "quantity" WHERE "container_size" = '330' AND "container_type" = 'rebottled';
--> statement-breakpoint
UPDATE "orders" SET "qty_330_new" = "quantity" WHERE "container_size" = '330' AND "container_type" = 'brand_new';
--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "container_size";
--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "container_type";
--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "quantity";
