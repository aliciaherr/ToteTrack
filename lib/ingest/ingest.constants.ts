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
 * without pinning a number. Task 103 owns the retry loop and should revise it
 * against real failure data.
 */
export const MAX_EXTRACTION_ATTEMPTS = 3

/**
 * How long a claimed row may sit at `extracting` before another worker run
 * may reclaim it (Task 115, FB-42). A run that dies mid-row — killed at the
 * function timeout, or crashed while rendering — leaves its row at
 * `extracting`; the lease is what brings it back.
 *
 * Not an env var: it must exceed the worker route's `maxDuration` (60 s,
 * M-04 condition 3) or a live run's row could be claimed twice. Five minutes
 * is five times that, so a slow but healthy run is never overtaken.
 */
export const EXTRACTION_LEASE_MS = 5 * 60 * 1000

/**
 * How long a row released after a transient failure waits before it may be
 * claimed again (MEDIUM-10). Without it, a self-chaining worker re-claims the
 * row within seconds, and a one-minute model outage spends all
 * `MAX_EXTRACTION_ATTEMPTS` and parks every queued PO for manual entry.
 *
 * Not an env var: it trades how fast a PO recovers against how long an outage
 * the attempt limit survives. Five minutes spreads three attempts over at
 * least ten, and matches the fallback cron's cadence (A-11).
 */
export const EXTRACTION_RETRY_DELAY_MS = 5 * 60 * 1000

/**
 * After this long into a run, the worker claims no further row (MEDIUM-09).
 * Rows are claimed one at a time, so a run killed at the route's 60 s
 * `maxDuration` spends only the attempt of the row in flight; this cutoff
 * keeps it from starting a row it has little chance to finish.
 *
 * Not an env var: it is pinned by `maxDuration` and per-row latency. Half the
 * function's limit leaves a typical row (render plus one model call) room to
 * finish. A row slower than the remaining time still dies with the function
 * and comes back through the lease.
 */
export const EXTRACTION_CLAIM_CUTOFF_MS = 30 * 1000

/**
 * Attachment content types treated as PO candidates — an exact list, never a
 * wildcard (CONSTRAINT-35).
 *
 * Not an env var: adding a type here changes what is sent to the model, so it
 * needs matching code and a verified read, not a redeploy. The old `image/*`
 * admitted SVG (M-01) and named HEIC and TIFF, which the model cannot read.
 * Anything not listed becomes an `unsupported_format` review row asking for a
 * re-send (CONSTRAINT-34) — never ignored. `image/jpg` is not a registered type
 * but some clients send it; `candidates.ts` normalises it to `image/jpeg` first.
 */
export const ACCEPTED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const

/** One of `ACCEPTED_MIME_TYPES`. */
export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number]

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
 * Not an env var: keyed by `AcceptedMimeType`, so the compiler fails if this
 * and `ACCEPTED_MIME_TYPES` drift apart — there is no fallback extension
 * because there is no accepted type without an entry. The sender's filename is
 * deliberately **not** used — it is untrusted input that could carry a path
 * (`types.ts`), so the extension is derived from the MIME type instead.
 */
export const PO_DOCUMENT_EXTENSIONS: Readonly<Record<AcceptedMimeType, string>> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

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
