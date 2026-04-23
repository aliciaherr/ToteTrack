-- Customer-level canonical delivery address. Set once on the customer record;
-- new orders auto-fill this into their per-order `delivery_address` field at
-- form-render time. The per-order field stays the source of truth for what
-- was actually delivered (so a one-off site doesn't pollute the customer's
-- default).
ALTER TABLE "customers" ADD COLUMN "default_delivery_address" text;
