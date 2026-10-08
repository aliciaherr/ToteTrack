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

/**
 * Hash algorithm and digest encoding for `content_hash` (Task 97).
 *
 * Not env vars: the stored hashes of every already-staged PO are hex SHA-256,
 * so changing either value silently stops every future row from matching any
 * existing one and dedupe goes quiet rather than loud. Changing it is a
 * migration, not a setting.
 */
export const CONTENT_HASH_ALGORITHM = 'sha256'
export const CONTENT_HASH_DIGEST_ENCODING = 'hex'

/**
 * Characters of a content hash quoted in a log line or an error message.
 *
 * Logs may carry identifiers only — never body text, attachment bytes,
 * customer names or PO data (SEC-01 / SEC-05). A hash prefix is the safe way
 * to correlate two log lines about the same document, and twelve hex
 * characters is far beyond collision range for one mailbox while staying
 * short enough to read.
 */
export const HASH_LOG_PREFIX_LENGTH = 12

/**
 * Folder prefix for every object written to `PO_DOCUMENTS_BUCKET`.
 *
 * Not an env var: it is part of the storage layout that the review modal's
 * signed-URL reader also assumes, so it belongs with the bucket name in one
 * place. Email-sourced documents are grouped under one prefix so a later
 * upload path (a manual upload, say) can be told apart by key alone.
 */
export const PO_DOCUMENT_PATH_PREFIX = 'inbound'

/**
 * File extension per accepted content type, used to build the storage key.
 *
 * Not an env var: each entry pairs with `ACCEPTED_MIME_TYPES` and with what
 * the extraction call can read. The sender's filename is deliberately **not**
 * used — it is untrusted input that could carry a path (`types.ts`), so the
 * extension is derived from the MIME type the parser reported instead.
 * Anything accepted but unlisted falls back to `PO_DOCUMENT_FALLBACK_EXTENSION`.
 */
export const PO_DOCUMENT_EXTENSIONS: Readonly<Record<string, string>> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/tiff': '.tiff',
}

/** Extension for an accepted `image/*` type not named above. */
export const PO_DOCUMENT_FALLBACK_EXTENSION = '.bin'

/**
 * Quote markers stripped from the **front** of a body line before hashing
 * (Task 97's `normalizeBodyForHash`): one or more `>`, however deeply nested.
 *
 * Stripped rather than used to drop the line, which is the whole point. In a
 * Gmail-style forward the purchase order *is* the quoted block, so dropping
 * quoted lines would throw the PO away and leave only the forwarder's "FYI"
 * — and two forwards of one PO would then hash on their covering notes
 * instead of on the order. Unquoting makes a quoted and an unquoted relay of
 * the same text converge.
 */
export const QUOTE_MARKER_PATTERN = /^\s*(?:>\s?)+/

/**
 * Line patterns dropped entirely from an email body before hashing it, after
 * `QUOTE_MARKER_PATTERN` has been stripped — so a quoted header block is
 * matched here too.
 *
 * Not env vars: each pattern encodes how a specific mail client rewrites a
 * body when it is forwarded or replied to, and the point of the set is that
 * two forwards of one purchase order hash the same. Tuning it changes dedupe
 * behaviour, so it changes in code with a test, never per environment. The
 * set is deliberately conservative — over-stripping would collapse two
 * genuinely different POs onto one hash, which is worse than letting a
 * duplicate through to the review queue (the plan's stated trade-off).
 */
export const RELAY_NOISE_LINE_PATTERNS: readonly RegExp[] = [
  // Gmail / Apple Mail forward and reply separators, in any wording that
  // keeps the dashes: "---------- Forwarded message ----------".
  /^\s*-{2,}\s*(original message|forwarded message)\s*-{2,}\s*$/i,
  // Outlook's plain separator above a quoted block.
  /^\s*_{5,}\s*$/,
  // "On Tue, 6 Oct 2026 at 09:15, Acme Orders <…> wrote:" — Gmail's attribution
  // line, which carries a timestamp that differs between two forwards.
  /^\s*on .*wrote:\s*$/i,
  // The header block a forward re-emits: these lines repeat data already held
  // in columns on `inbound_emails`, and the client rewrites their order and
  // spacing, so they are noise for hashing purposes.
  /^\s*(from|sent|to|cc|bcc|date|subject|reply-to):/i,
]

/**
 * Line that starts an email signature. Everything from it to the end of the
 * body is dropped before hashing: RFC 3676's `-- ` sig separator, and the
 * common unspaced `--` variant. Signatures carry phone numbers and taglines
 * that change between forwards without changing the purchase order.
 */
export const SIGNATURE_DELIMITER_PATTERN = /^\s*--\s*$/
