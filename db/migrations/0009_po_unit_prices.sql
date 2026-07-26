-- PO per-combo unit prices — brings the repo in line with the live DB.
--
-- Adds 6 nullable unit-price columns (one per size×type combo) alongside the
-- existing `price` total. Legacy `price` held a single per-unit value; this
-- migration reinterprets `price` as the DERIVED total = Σ(qty × unit price)
-- and backfills the per-combo unit price for the one populated combo on
-- single-combo rows.
--
-- Idempotent by design (run verbatim against live on 2026-07-25):
--   * ADD COLUMN IF NOT EXISTS — re-running is a no-op on the schema.
--   * The backfill UPDATE is guarded by an all-NULL WHERE clause on every
--     unit_price_* column, so it cannot double-apply and re-multiply `price`.
--   * Only single-combo rows (exactly one non-zero qty) are backfilled; rows
--     with zero or multiple non-zero combos are left for manual entry.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS unit_price_275_recon numeric(10,2),
  ADD COLUMN IF NOT EXISTS unit_price_275_rebot numeric(10,2),
  ADD COLUMN IF NOT EXISTS unit_price_275_new   numeric(10,2),
  ADD COLUMN IF NOT EXISTS unit_price_330_recon numeric(10,2),
  ADD COLUMN IF NOT EXISTS unit_price_330_rebot numeric(10,2),
  ADD COLUMN IF NOT EXISTS unit_price_330_new   numeric(10,2);

WITH counts AS (
  SELECT id,
    (qty_275_recon>0)::int + (qty_275_rebot>0)::int + (qty_275_new>0)::int
  + (qty_330_recon>0)::int + (qty_330_rebot>0)::int + (qty_330_new>0)::int AS nonzero
  FROM orders
)
UPDATE orders o SET
  unit_price_275_recon = CASE WHEN o.qty_275_recon>0 THEN o.price END,
  unit_price_275_rebot = CASE WHEN o.qty_275_rebot>0 THEN o.price END,
  unit_price_275_new   = CASE WHEN o.qty_275_new>0   THEN o.price END,
  unit_price_330_recon = CASE WHEN o.qty_330_recon>0 THEN o.price END,
  unit_price_330_rebot = CASE WHEN o.qty_330_rebot>0 THEN o.price END,
  unit_price_330_new   = CASE WHEN o.qty_330_new>0   THEN o.price END,
  price = o.price * (o.qty_275_recon + o.qty_275_rebot + o.qty_275_new
                   + o.qty_330_recon + o.qty_330_rebot + o.qty_330_new)
FROM counts c
WHERE c.id = o.id AND c.nonzero = 1
  AND o.unit_price_275_recon IS NULL AND o.unit_price_275_rebot IS NULL
  AND o.unit_price_275_new   IS NULL AND o.unit_price_330_recon IS NULL
  AND o.unit_price_330_rebot IS NULL AND o.unit_price_330_new   IS NULL;
