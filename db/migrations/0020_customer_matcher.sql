-- Customer matcher — Feature 16, Task 102.
--
-- Enables pg_trgm (A-12: available on the prod project as 1.6, not installed)
-- and adds the two normalisers the matcher compares through. They live here,
-- in SQL, so there is one definition: both sides of every comparison — the
-- name on the PO and each customer's stored name — pass through the same
-- function (db/queries/customer-match.ts).
--
-- Shape notes:
--   * The extension goes in `extensions`, Supabase's schema for them. Callers
--     write `extensions.similarity(...)` explicitly rather than relying on
--     search_path.
--   * Both functions are IMMUTABLE and pin `search_path = ''`, so every call
--     inside them is schema-qualified and nothing on the path can shadow it.
--   * US suffixes (inc, llc, corp, co, …). A-12's contingency listed UK ones
--     (Ltd, PLC); the customers are in the US. `ltd`/`limited` stay because
--     they cost nothing. Periods and apostrophes are deleted, not spaced, so
--     "L.L.C." becomes "llc" and is stripped like "LLC".
--   * `nf` is stripped as a suffix too: "(NF)" / "- NF" is the salesperson's
--     own tag on ~15 customer names, never part of a company's name (builder,
--     2026-10-12). Without this, those customers could never match exactly.
--   * No trigram index. There are ~100 customers, so a sequential scan per PO
--     is trivial and an index is only something to maintain. Revisit past a
--     few thousand rows.
--   * EXECUTE is revoked from PUBLIC, anon and authenticated: the app calls
--     these as the owning `postgres` role, and nothing needs them over the
--     PostgREST API.
--
-- Prod: paste into the Supabase SQL editor before Task 104. Local:
-- `npm run db:migrate-local`. Never `db:migrate`. Re-runnable: IF NOT EXISTS
-- and CREATE OR REPLACE throughout.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.normalise_company_name(name text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(
      pg_catalog.btrim(
        pg_catalog.regexp_replace(
          pg_catalog.regexp_replace(
            pg_catalog.replace(pg_catalog.translate(pg_catalog.lower(name), '''.', ''), '&', ' and '),
            '[^[:alnum:]]+', ' ', 'g'
          ),
          ' +', ' ', 'g'
        )
      ),
      '^the ', ''
    ),
    '( (inc|incorporated|llc|ltd|limited|co|corp|corporation|company|nf))+$', ''
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.normalise_address(address text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT pg_catalog.regexp_replace(pg_catalog.regexp_replace(pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(pg_catalog.regexp_replace(pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(pg_catalog.regexp_replace(
      pg_catalog.btrim(
        pg_catalog.regexp_replace(
          pg_catalog.regexp_replace(pg_catalog.lower(address), '[^[:alnum:]]+', ' ', 'g'),
          ' +', ' ', 'g'
        )
      ),
      '\mstreet\M', 'st', 'g'),
      '\mroad\M', 'rd', 'g'),
      '\mavenue\M', 'ave', 'g'),
      '\msuite\M', 'ste', 'g'),
      '\mdrive\M', 'dr', 'g'),
      '\mboulevard\M', 'blvd', 'g'),
      '\mhighway\M', 'hwy', 'g'),
      '\mparkway\M', 'pkwy', 'g')
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.normalise_company_name(text) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION public.normalise_address(text) FROM PUBLIC, anon, authenticated;
