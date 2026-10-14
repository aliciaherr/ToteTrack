import { INGEST_BATCH_SIZE } from './ingest.constants'

/**
 * The boundary caps on inbound email, in one place (H-01 / H-02 / M-05 /
 * M-06, all SEC-02).
 *
 * Separated from `ingest.constants.ts` because these five answer a different
 * question from the rest of that file. The others tune how the pipeline
 * behaves; these decide what it will refuse from an **unauthenticated**
 * sender — the ingestion mailbox is the only inbound content path in this
 * application that anyone can write to with no credential and no session.
 * They are enforced in `limits.ts` and `message.ts`.
 *
 * Every one is a constant rather than an env var for the same reason: a cap
 * that differs between environments means a message refused in production
 * cannot be reproduced locally, and a boundary check that can be loosened by
 * a deployment setting is not a boundary check. No DB import, no runtime
 * dependency, safe to import from anywhere including tests.
 */

/**
 * Largest single attachment, in decoded bytes, that will be staged.
 *
 * **Builder decision, 2026-10-08: 15MB.** A high-resolution photo of a paper
 * purchase order, taken on a phone, is the realistic worst case for a genuine
 * document. 15MB sits comfortably above that and below Gmail's own 25MB send
 * limit — so nothing a customer can successfully send is ever refused for
 * size, while an attachment above it is not a photographed PO. This supersedes
 * the 10MB figure in `docs/plan.md:644`, which covers the manual upload path.
 *
 * Not an env var: it is the boundary length check SEC-02 requires on an
 * unauthenticated input path (H-01, CWE-770). A per-environment cap would mean
 * production and local accept different documents, so a rejection found in one
 * could not be reproduced in the other. Same shape and the same reasoning as
 * `MAX_FILE_BYTES` on the authenticated support path
 * (`lib/actions/support.ts:23`), which this path failed to inherit.
 */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024

/**
 * Attachments from one email that will be staged as PO candidates.
 *
 * Bounds a single hostile message: without it, one email with 500 accepted
 * parts yields 500 storage objects, 500 `inbound_pos` rows, 1000 database
 * round trips and — once Task 98 lands — 500 billed extraction calls. No
 * genuine purchase-order email carries ten documents, so the cap costs a real
 * sender nothing.
 *
 * Not an env var, for the same reason as the size cap: it is a boundary check,
 * and anything past it is recorded as a refusal rather than dropped, which is
 * behaviour rather than configuration. The authenticated support path pins the
 * equivalent at 3 (`lib/actions/support.ts:25`); this is looser because a
 * customer may legitimately attach several POs to one email.
 */
export const MAX_ATTACHMENTS_PER_EMAIL = 10

/**
 * Ceiling on message bytes buffered across one invocation.
 *
 * **Derived, deliberately:** `INGEST_BATCH_SIZE * MAX_ATTACHMENT_BYTES`. One
 * invocation stages at most `INGEST_BATCH_SIZE` POs, and the largest document
 * any one of them may carry is `MAX_ATTACHMENT_BYTES`, so that product is the
 * most a well-behaved run ever needs to hold. Written as the product rather
 * than as a literal so the relationship survives a change to either input —
 * raising the per-attachment cap without raising this one would otherwise
 * quietly make the batch ceiling bind first.
 *
 * This is the number that actually protects memory, because it is the one
 * checked against the size IMAP declares *before* a message is downloaded. A
 * message whose declared size exceeds it on its own can never be admitted and
 * is staged for review; one that merely does not fit the bytes left in the
 * current run is left in the mailbox and drains on the next run.
 *
 * Not an env var: a serverless function that holds more than its memory
 * ceiling does not run slower, it dies mid-batch (H-01), so the value is a
 * code decision taken against the runtime, not a deployment knob.
 */
export const MAX_TOTAL_INGEST_BYTES = INGEST_BATCH_SIZE * MAX_ATTACHMENT_BYTES

/**
 * Messages admitted per invocation, whatever their size.
 *
 * `MAX_TOTAL_INGEST_BYTES` bounds memory but does not bound *count*: 60MB of
 * two-kilobyte emails is roughly thirty thousand of them, each becoming an
 * `inbound_emails` row, an `inbound_pos` row via the body fallback, two
 * database round trips and — from Task 98 — one billed extraction call (M-05).
 * The byte budget has no opinion on any of that, so this is the cap that does.
 *
 * 200 is set against legitimate volume with wide headroom: a cron running
 * every fifteen minutes admits 19,200 messages a day at this cap, which is
 * orders of magnitude above what a business of this size receives, while a
 * flood costs 200 rows a run instead of thirty thousand. Exceeding it defers
 * rather than refuses — the remaining messages are perfectly fine and simply
 * wait for the next run, exactly as the byte budget's `defer` already does.
 *
 * Not an env var: like the byte ceiling, it is pinned by what one serverless
 * invocation can finish before its timeout, which is a property of the runtime
 * and the per-message round trips, not of the deployment. Task 104 owns the
 * cron interval and should revise this against it and against measured
 * per-message latency.
 */
export const MAX_MESSAGES_PER_RUN = 200

/**
 * Longest header string, in UTF-8 bytes, written to `inbound_emails`.
 *
 * `message_id`, `from_address` and `subject` are all sender-controlled and all
 * reached the database unbounded (M-06). Since 0017 none is indexed, so the
 * btree key limit no longer applies; the cap stays because an unbounded
 * sender-controlled string has no business in a display column.
 *
 * 998 is RFC 5322's recommended maximum header line length, so no legitimate
 * header is affected — a real `Message-ID` is a few dozen characters. Measured
 * in **bytes, not characters**: 998 characters of four-byte UTF-8 would be
 * 3992 of them.
 *
 * Not an env var: it is a boundary length check (SEC-02) pinned by an RFC,
 * which does not vary by environment.
 */
export const MAX_HEADER_BYTES = 998

/**
 * C0 control characters except tab, plus DEL — stripped from every
 * sender-controlled header before it is stored (HIGH-02).
 *
 * Postgres `text` cannot hold U+0000 at all, so one encoded-word such as
 * `=?utf-8?Q?PO=00?=` made the insert fail on every run and pinned the UID
 * watermark forever. The other controls go with it: these are display
 * labels, and no legitimate header needs a control character to be read.
 */
export const HEADER_CONTROL_CHARACTERS = /[\u0000-\u0008\u000A-\u001F\u007F]/g

/**
 * Plausible `Date:` header window, in epoch milliseconds. A sender-written
 * date outside it is stored as NULL rather than inserted (HIGH-02): JS can
 * represent years far before Postgres `timestamptz`'s 4713 BC floor, and such
 * a value would fail the insert on every run exactly as a NUL byte did.
 * 1970 and 9999 bound every real email with room to spare.
 */
export const RECEIVED_AT_MIN_MS = Date.UTC(1970, 0, 1)
export const RECEIVED_AT_MAX_MS = Date.UTC(9999, 11, 31)

/**
 * Longest content type recorded on an `unsupported_format` or
 * `empty_attachment` refusal (Task 100).
 *
 * The type is sender-controlled and is persisted in `check_results`, which the
 * review UI reads back, so it is bounded like every other sender string. A
 * real `type/subtype` is a few dozen characters; anything longer is recorded
 * with no type at all rather than truncated into something misleading.
 *
 * Not an env var: a boundary length check (SEC-02), the same in every
 * environment.
 */
export const MAX_RECORDED_MIME_TYPE_LENGTH = 100

/**
 * The shape a recorded content type must have: one `type/subtype` pair in
 * RFC 6838's restricted-name characters, lowercase, no parameters. Anything
 * else is dropped from the refusal rather than stored.
 */
export const RECORDABLE_MIME_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/

/**
 * Failing runs before a UID gives up and becomes a placeholder (CONSTRAINT-37,
 * HIGH-02R). **Builder decision, 2026-10-12: 3.** One failure is a blip; three
 * in a row is a message that will not stage, and leaving it would pin the
 * watermark forever. Counted only when staging threw or the post-parse
 * re-check refused it — a deferred UID never counts.
 *
 * Not an env var: it decides when a message stops halting the watermark, and
 * production and local must agree on that to reproduce a give-up.
 */
export const GIVE_UP_MIN_ATTEMPTS = 3

/**
 * Least time since a UID's first failure before it may give up (CONSTRAINT-37).
 * **Builder decision, 2026-10-12: 1 hour.** The run count alone could be
 * reached inside a short Storage or database outage on a tight cron; the age
 * lets that heal before a good PO is turned into a placeholder. Both
 * thresholds must hold. Not an env var, for the same reason as the count.
 */
export const GIVE_UP_MIN_AGE_MS = 60 * 60 * 1000

/**
 * IMAP timeouts, passed to `imapflow` by `createImapSession`. imapflow's own
 * defaults (90 s to connect, 16 s for the greeting, **5 minutes** of socket
 * inactivity) let one stalled server use the whole of `/api/ingest/run`'s
 * `maxDuration` (300 s), so the platform kills the run mid-read and nothing is
 * logged. These keep every stall well inside it: even a connect, greeting and
 * one idle read that each run to their limit (105 s) leave the run time to fail
 * loudly, write no state and still poke the worker. A test in the run route
 * keeps their sum under `maxDuration`.
 *
 * Constants, not env vars: they bound one function invocation, which is fixed
 * by the route, not by the deployment.
 */
/** TCP + TLS handshake budget, DNS included. */
export const IMAP_CONNECTION_TIMEOUT_MS = 30_000
/** Wait for the server's greeting once connected. */
export const IMAP_GREETING_TIMEOUT_MS = 15_000
/** Longest silence on an open socket, e.g. mid-download, before it is dropped. */
export const IMAP_SOCKET_TIMEOUT_MS = 60_000
