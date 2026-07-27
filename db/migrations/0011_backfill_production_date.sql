-- Backfill production_date — Feature 11 follow-up (CONSTRAINT-19 revision).
--
-- DATA MIGRATION ONLY. No column is added, altered or dropped.
--
-- WHY THIS EXISTS
-- ---------------
-- Migration 0010 added `production_date` with no backfill, so every existing row
-- holds NULL. Today that is harmless: the calendar positions a card with
--     COALESCE(production_date, prevBusinessDay(requested_delivery_date))
-- so a NULL row is still drawn on a sensible day. Its position is COMPUTED at
-- read time; nothing is stored.
--
-- The follow-up change removes that derivation entirely — a card's column
-- becomes `production_date` and nothing else, so that clearing it genuinely
-- unschedules an order instead of bouncing it back to a derived day. The moment
-- the derivation is gone, every NULL row loses its position and falls into the
-- unscheduled callout.
--
-- This statement writes down the answer the derivation is already producing, so
-- that when the derivation is deleted, nothing moves.
--
-- RUN THIS *BEFORE* DEPLOYING THE CODE CHANGE.
-- Under the current code it is a visual no-op: COALESCE returns the stored value
-- instead of the computed one, and they are the same value. That is the point —
-- it gives you a checkpoint where the risky step can be verified as having
-- changed nothing. Running it *after* the code deploy leaves a window in which
-- the calendar is empty and every order sits in the callout.
--
-- THE RULE
-- --------
-- Identical to `prevBusinessDay` in lib/dates.ts and to the SQL expression being
-- retired, using ISO day-of-week (1 = Monday … 7 = Sunday):
--     Monday (1) → minus 3 days → the prior Friday
--     Sunday (7) → minus 2 days → the prior Friday
--     otherwise  → minus 1 day, which is always a weekday
-- `date - integer` yields a date in Postgres (an INTERVAL would widen it to a
-- timestamp). The result is therefore never a Saturday or Sunday, upholding the
-- no-weekend invariant (CONSTRAINT-19).
--
-- WHAT IT DELIBERATELY SKIPS
-- --------------------------
--   * Rows that already have a production_date — someone placed those by hand.
--   * Rows with no requested_delivery_date — there is nothing to derive from.
--     They stay NULL and stay in the unscheduled callout, which is correct both
--     before and after the code change.
--
-- Cancelled orders ARE included. They are filtered out of the calendar by status
-- regardless, and leaving them dated means a later revert to `scheduled` puts the
-- order back on a sensible day rather than into the callout.
--
-- Idempotent: the WHERE clause excludes every row this statement has already
-- touched, so re-running is a no-op. Applied by hand via the Supabase SQL Editor
-- — this repo has no CLI migration runner.
--
-- VERIFY BEFORE AND AFTER
-- -----------------------
-- Run this on either side of the UPDATE. The two result sets must be identical;
-- only `source` should change from 'derived' to 'stored'.
--
--   SELECT po_number,
--          COALESCE(
--            production_date,
--            CASE EXTRACT(ISODOW FROM requested_delivery_date)::int
--              WHEN 1 THEN requested_delivery_date - 3
--              WHEN 7 THEN requested_delivery_date - 2
--              ELSE requested_delivery_date - 1
--            END
--          ) AS calendar_day,
--          CASE WHEN production_date IS NULL THEN 'derived' ELSE 'stored' END AS source
--   FROM orders
--   WHERE status <> 'cancelled'
--   ORDER BY po_number;
--
-- Sanity check afterwards — this must return zero rows:
--
--   SELECT po_number, production_date
--   FROM orders
--   WHERE production_date IS NOT NULL
--     AND EXTRACT(ISODOW FROM production_date)::int > 5;

UPDATE "orders"
SET "production_date" = CASE EXTRACT(ISODOW FROM "requested_delivery_date")::int
      WHEN 1 THEN "requested_delivery_date" - 3
      WHEN 7 THEN "requested_delivery_date" - 2
      ELSE "requested_delivery_date" - 1
    END
WHERE "production_date" IS NULL
  AND "requested_delivery_date" IS NOT NULL;
