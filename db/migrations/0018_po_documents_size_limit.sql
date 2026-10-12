-- Raise the `po-documents` bucket's size limit to 15 MiB (HIGH-03, 2026-10-12).
--
-- 0003 set it to 10 MiB for the manual upload path (since cut). Email
-- ingestion accepts attachments up to `MAX_ATTACHMENT_BYTES` = 15 MiB (builder
-- decision 2026-10-08, `lib/ingest/limits.constants.ts`). Anything between the
-- two was rejected by Storage with 413 on every run, and since Task 100 an
-- upload failure halts the UID watermark, so one 11 MB attachment could pin
-- ingestion permanently. The bucket must be at least the ingestion cap;
-- `lib/ingest/__tests__/bucket-rules.test.ts` fails if they drift apart.
--
-- 15 MiB is within the Supabase free tier's 50 MB global upload limit.
-- `allowed_mime_types` is unchanged: 0003 already lists exactly
-- `ACCEPTED_MIME_TYPES`.
--
-- **Aborts loudly if the bucket does not exist**, rather than updating nothing.
--
-- Prod: paste into the Supabase SQL editor. Local: `npm run db:migrate-local`.
-- Never `db:migrate`.

DO $$
BEGIN
  UPDATE storage.buckets SET file_size_limit = 15728640 WHERE id = 'po-documents';
  IF NOT FOUND THEN
    RAISE EXCEPTION '0018: bucket po-documents not found; apply 0003 first';
  END IF;
END $$;
