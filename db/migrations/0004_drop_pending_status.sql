-- Drop the 'pending' value from po_status. PostgreSQL cannot drop enum values
-- directly, so the canonical pattern is: rewrite existing rows → create new
-- enum → swap the column type → drop the old enum → rename.
--
-- Existing 'pending' rows are converted to 'scheduled' (conservative — never
-- silently mark anything as completed). The new 4-value model is:
--   scheduled → completed → (auto on invoice) invoiced
--                        ↘ cancelled
--
-- 'invoiced' is a sub-state of 'completed' for display/aggregation purposes;
-- queries that count completed orders should now match status IN
-- ('completed', 'invoiced').

UPDATE orders SET status = 'scheduled' WHERE status = 'pending';
--> statement-breakpoint
CREATE TYPE "public"."po_status_new" AS ENUM('scheduled', 'completed', 'cancelled', 'invoiced');
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" TYPE "public"."po_status_new" USING "status"::text::"public"."po_status_new";
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'scheduled';
--> statement-breakpoint
DROP TYPE "public"."po_status";
--> statement-breakpoint
ALTER TYPE "public"."po_status_new" RENAME TO "po_status";
