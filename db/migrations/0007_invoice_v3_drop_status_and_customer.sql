-- Invoice v3: one invoice per month, all customers' POs.
-- Drops the per-customer association (`customer_id`) and the draft/paid
-- status (`status` + `invoice_status` enum). Existing invoices keep their
-- rows; the dropped fields are gone forever. Order→invoice link is
-- preserved via `orders.invoice_id`, so the salesperson can still drill
-- from an old invoice into its constituent POs (which carry their own
-- customer reference).
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "customer_id";
--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN IF EXISTS "status";
--> statement-breakpoint
DROP TYPE IF EXISTS "public"."invoice_status";
