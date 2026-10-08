/**
 * Every tunable value in the email PO ingestion pipeline (Feature 16),
 * in one place.
 *
 * The feature's preamble in `docs/plan.md` audited these on 2026-10-07 and
 * ruled each one a **constant rather than an environment variable**: each
 * changes program behaviour, so changing it is a code decision that goes
 * through review, not a deployment knob that can differ silently between
 * environments. The per-value reasons are repeated below so the next reader
 * does not have to find the plan entry.
 *
 * Follows the `db/queries/calendar.constants.ts` and
 * `production-widget.constants.ts` precedent: no DB import, no runtime
 * dependency, safe to import from anywhere including tests.
 *
 * The three Gmail credentials are **not** here — they are environment
 * variables by definition and are read in `lib/ingest/gmail.ts` (SEC-01).
 */

/**
 * POs extracted per worker invocation.
 *
 * Not an env var: the number is pinned by the Vercel free-tier function
 * timeout divided by per-PO extraction latency. Raising it does not scale the
 * worker, it makes the worker time out mid-batch — so it is a code decision
 * taken against measured latency, not a deployment setting.
 *
 * Four matches `UNSCHEDULED_DROPDOWN_VISIBLE` and
 * `PRODUCTION_WIDGET_ROWS_PER_DAY` by coincidence of value only; they are
 * unrelated and must not be collapsed.
 */
export const INGEST_BATCH_SIZE = 4

/**
 * Extraction attempts on one `inbound_pos` row before it is parked at
 * `extraction_failed` for manual handling.
 *
 * Not an env var for the same reason as the batch size: it trades API spend
 * against recovering from a transient model error, and both sides of that
 * trade are code-level facts. A per-environment value would mean production
 * and local retry differently, which makes a failure unreproducible.
 *
 * Three is a starting value, not a measured one — the plan names the constant
 * without pinning a number. Task 101 owns the retry loop and should revise it
 * against real failure data.
 */
export const MAX_EXTRACTION_ATTEMPTS = 3

/**
 * Attachment content types treated as PO candidates.
 *
 * Not an env var: adding a type here changes how the attachment is parsed and
 * sent to the model, so it needs matching code, not a redeploy. `image/*` is
 * a prefix pattern — match on the part before the `/` plus the `*`, not by
 * string equality. Anything not listed is ignored, and an email whose only
 * attachments are unlisted falls back to its body text (Task 97).
 */
export const ACCEPTED_MIME_TYPES = ['image/*', 'application/pdf'] as const

/**
 * The Supabase Storage bucket holding source PO documents. Private, per
 * CONSTRAINT-06.
 *
 * Not an env var: the bucket is a fixed fact about the Supabase project, and
 * one source of truth beats the same string repeated across the pipeline, the
 * review modal and the signed-URL reader. A wrong value here fails loudly on
 * the first upload; a wrong value in a `.env` fails loudly on one deploy only.
 */
export const PO_DOCUMENTS_BUCKET = 'po-documents'

/**
 * Longest edge, in pixels, that a photographed PO is resized to before upload
 * and extraction.
 *
 * Not an env var: the value is tuned against whether small print on a PO stays
 * legible to the vision model, which is a property of the documents and the
 * model, not of the environment it runs in.
 *
 * 2000 is a starting value — the plan names the constant without pinning a
 * number. Task 98 owns the extraction call and should revise it if legibility
 * or payload size turns out to bind.
 */
export const COMPRESSED_IMAGE_MAX_DIMENSION = 2000

/**
 * JPEG quality, 0..1, for that same resize. Paired with the dimension above
 * and tuned the same way, for the same reason.
 */
export const COMPRESSED_IMAGE_QUALITY = 0.8

/**
 * Day-of-month boundary above which a date component cannot be a month, so a
 * `03/04/2026`-style date is genuinely ambiguous only when **both** components
 * are at or below it.
 *
 * Not an env var, and not configurable at all: twelve is the number of months
 * in a year. It is named rather than written inline so the check reads as what
 * it means instead of as a bare `12`.
 */
export const AMBIGUOUS_DATE_THRESHOLD = 12
