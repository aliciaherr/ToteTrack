# Plan archive: Feature 16, done tasks

**Archived 2026-10-12 doc audit.** The Feature 16 preamble and every finished Feature 16 task, moved
verbatim out of `docs/plan.md`. Open Feature 16 tasks stay in `docs/plan.md`; one-line status
per task lives in `docs/roadmap.md`. The task table in the preamble below is historical.

# Feature 16 — Email PO Ingestion (Tasks 94–113)

**Source:** `docs/prd.md` → "Feature 16: Email PO Ingestion". Supersedes the cut recorded at
`prd.md:178` (Tasks 19 and 33). New assumptions A-07 through A-13 in `docs/assumptions.md`.

**Manifest pre-check waived across this feature** (FI-01) — `manifest.md` is absent and this
project predates the requirement. Following the Task 49 precedent: the waiver is recorded
here, and `**Specialist:**` fields use the existing `@db` / `@ui-totetrack` convention rather
than being omitted.

**Only Tasks 94–97 are written.** Tasks 98–113 are planned in shape but deliberately not yet
specced — they depend on the extraction schema and field descriptions, which are informed by
the first real documents. The agreed sequence:

| # | Task | Specialist |
|---|---|---|
| 98 | Extraction call — OpenRouter + ZDR, schema, source quotes | — |
| 99 | UID + UIDVALIDITY watermark (CONSTRAINT-33) — **[x] done 2026-10-12, security CLEAR** | @db |
| 100 | No silent drops + exact MIME list (CONSTRAINT-34/35) — **[x] done 2026-10-12** (HIGH-02R still open, not in spec) | — |
| 114 | Give up on a UID after 3 failing runs + 1 hour (CONSTRAINT-37, HIGH-02R) — **[x] done 2026-10-12**; `@security` re-run owed; 0019 applied in prod 2026-10-12 | @db |
| 101 | Check suite — quote verification, arithmetic, date ambiguity — **[x] done 2026-10-12**; eval passed on 4 POs, builder confirmed | — |
| 102 | Customer matcher — normalise + `pg_trgm` + address signal — **[x] done 2026-10-12**; 0020 applied in prod 2026-10-12 | @db |
| 103 | Worker foundations — body text, lease column, storage module, failed rows visible (split 2026-10-12, FB-42) — **[x] done 2026-10-12**; 0021 applied in prod 2026-10-12 | @db |
| 115 | Worker core — claim, extract, check, match, persist — **[x] done 2026-10-12** | @db |
| 116 | Worker route — secret, `after()`, self-chain — **[x] done 2026-10-12**; `@security` CLEAR | — |

**Task 103 sign-off conditions from `@security` (M-04 residual, 2026-10-12)** — the PDF render
deadline cannot interrupt one page mid-render, so the worker must guarantee a hostile PDF still
ends visible (CONSTRAINT-34): (1) increment `attempt_count` **before** rendering starts;
(2) at `MAX_EXTRACTION_ATTEMPTS` the PO becomes a visible review row and is never retried;
(3) set the function's `maxDuration` explicitly; (4) render in a `worker_thread`, **or** the
builder records accepting the CPU cost. HIGH-01 was closed by Task 99 (`@security` CLEAR); it no longer blocks Task 104
(corrected 2026-10-12).
| 104 | Triggers — daily cron (11:00 UTC) + manual, one route — **[x] done 2026-10-12**; `@security` CLEAR | — |
| 105 | Review-queue badge in the menu (count, last checked, check mail) — **[x] done 2026-10-12** | @ui-totetrack |
| 106 | Review overlay — left pane for images, email text and refusals; click-to-expand | @ui-totetrack |
| 117 | Review overlay — PDFs drawn with pdf.js (A-15) | @ui-totetrack |
| 107 | Review modal — right pane, quote highlighting, pickers | @ui-totetrack |
| 108 | Approve / skip / delete — duplicates blocked with a message | — |
| 109 | Auto-advance and "You are all caught up" | @ui-totetrack |
| 110 | Architecture + `document-extraction.md` updates | — |
| — | **core complete — re-evaluate before continuing** | |
| 111 | Duplicate diff + update-existing-order path | — |
| 112 | Inline customer creation, pre-filled, secondary to the picker | @ui-totetrack |
| 113 | Learned per-customer name aliases | @db |

Tasks 111–113 are **in scope but sequenced last by decision (2026-10-07)**. They were
proposed for cutting as exception-path work; the builder kept them and moved them behind the
core. That ordering only pays off if the core is genuinely used before they are started —
`prd.md` records them as "sequenced after the core, pending real usage", not as committed.

**A-12 resolved 2026-10-08:** `pg_trgm` 1.6 is available on the prod project but not
installed. Task 102's migration 0020 enables it.

**`check_results` shape — settled by Task 95, 2026-10-7.** The column is free-form
`jsonb`, but one key is a contract the queue query already depends on: **a failure is an
entry in a top-level `failures` array.** `db/queries/inbound.ts:82-93` sorts the review
queue on `jsonb_array_length(check_results -> 'failures') > 0`, written total so a NULL
column, a missing key or a non-array all count as "no failures" rather than breaking the
queue. **Task 101 must emit that key**; what goes *inside* each entry is deliberately still
open and Task 101 decides it. **Task 107** reads it to order and label the right pane.
Note what the shape cannot express: every entry ranks equally — there is no hard-failure
vs. warning distinction. Adding one is a change *inside* an entry, not to this contract.
Checks rank attention and never gate acceptance: a failure sorts a row to the top, it does
not keep it out of the list.

**No magic numbers anywhere in Feature 16 — audited 2026-10-07.** Every tunable value below
goes in `lib/ingest/ingest.constants.ts` (or `extraction.constants.ts` for Task 98),
following the existing `db/queries/calendar.constants.ts` and
`production-widget.constants.ts` precedent. Not literals buried in logic.

| Value | Where it lives | Why not an env var |
|---|---|---|
| `INGEST_BATCH_SIZE` (POs per invocation, start at 4) | constant | Tied to the Vercel timeout and per-PO latency; changing it is a code decision, not a deployment one |
| `MAX_EXTRACTION_ATTEMPTS` (retries before `extraction_failed`) | constant | Same |
| `ACCEPTED_MIME_TYPES` (`image/*`, `application/pdf`) | constant | Changing it changes parsing behaviour |
| `PO_DOCUMENTS_BUCKET` (`po-documents`) | constant | Fixed by the Supabase project; one source of truth beats a string repeated across files |
| `COMPRESSED_IMAGE_MAX_DIMENSION` / quality | constant | Tuned against legibility, not environment |
| `AMBIGUOUS_DATE_THRESHOLD` (12) | constant | Derived from the calendar, not configurable |

**Environment variables** (all in `.env.example` with placeholder values):
`GMAIL_IMAP_USER`, `GMAIL_IMAP_APP_PASSWORD`, `GMAIL_IMAP_HOST`, `OPENROUTER_API_KEY`,
`OPENROUTER_MODEL`, `INGEST_TRIGGER_SECRET`.

**The one deliberate hardcode, and the reasoning so it is not "fixed" later.** The
per-request `zdr` flag is `true` in code with no override. The configuration-over-hardcoding
rule exists so that values which legitimately *differ* between environments are not baked
in. ZDR must never differ — it is an invariant, not a setting. Behind an environment
variable it acquires a silent failure mode (wrong `.env`, a variable missed on a new deploy)
where privacy is off and nothing breaks loudly. Hardcoding it serves the rule's intent
rather than breaking it. Task 98 asserts it in a test.

**Configuration rules for Task 98, agreed 2026-10-07 — settle these before writing it.**
`OPENROUTER_API_KEY` and `OPENROUTER_MODEL` both come from environment variables, never
hardcoded; `OPENROUTER_MODEL` defaults to `openai/gpt-4.1-mini` but is overridable without
a code change, which is what makes swapping models cheap if accuracy disappoints. This
matches the extraction playbook's rule that config is passed *into* the extraction layer
and never read inside it. **The `zdr` flag is the exception: always `true`, in code, with
no environment override** — a privacy guarantee that can be switched off by environment is
one that will eventually ship switched off. `.env.example` gains both variables with
placeholder values.

---

## Task 94: Amend CONSTRAINT-07 to permit a metered extraction API

**Constraint amendment — no `docs/prd.md` entry by design.** Changes no code and no
user-visible behaviour. It is a gate: CONSTRAINT-07 currently forbids the paid API that
Task 98 requires, and `prd.md:178` already cites this task as the condition being met.

**Files:**
- `docs/constraints.md` — modify. Amend CONSTRAINT-07 in place using the established
  `~~strikethrough~~` + `**Amended [date]:**` convention; do not rewrite history

**Acceptance criteria:**
- [x] CONSTRAINT-07 permits a metered LLM API **scoped to PO extraction only**, via
      OpenRouter with ZDR enforced account-wide
- [x] The amendment restates what remains forbidden: paid Supabase plan, Redis, external
      CDN, any other paid infrastructure
- [x] **No cost figure is pinned.** A dated follow-up action is recorded to write the
      measured figure in after the first few days of real use
- [x] A-13 is cross-referenced for the cost basis (~$0.0015/PO, ~$8/year at 15/day)
- [x] The decisions-log table at `constraints.md:558` gains a row for the amendment

**Tests required:** None — documentation change, no executable code.

**Status:** [x] Done (2026-10-07) — all five criteria met. CONSTRAINT-07 amended in place with the established `~~strikethrough~~` + `**Amended [date]:**` convention; the original decision text stays readable under strikethrough. The API is permitted **only** for PO-document extraction, via OpenRouter with ZDR enforced account-wide (A-08) and the per-request `zdr` flag hardcoded; paid Supabase plan, Redis, external CDN and all other paid infrastructure remain forbidden. **No cost figure was pinned** — A-13 is cited as the basis (~$0.0015/PO, ~$8/year at 15/day), explicitly not as a limit, with a dated follow-up to write the measured spend in after the first few days of real use. Decisions-log row **31** added. No `docs/prd.md` entry, by design. **Note:** `docs/plan.md` has no summary task-status table — status lives only in these per-task `**Status:**` lines — so there was no table row to reconcile.
**Depends on:** None

---

## Task 95: Add the inbound-email staging schema

**Files:**
- `db/schema/inbound.ts` — create. `inbound_emails` + `inbound_pos`, ~~two~~ **three**
  new enums — corrected 2026-10-07: the spec body below defines three (`classification`,
  `source_kind`, `status`); "two" was a miscount, not a scope change
- `db/migrations/0016_inbound_email_ingestion.sql` — create (0015 is the latest)
- `db/queries/inbound.ts` — create. Read/write helpers
- `db/queries/__tests__/inbound.test.ts` — create

**Approach:** two tables, not one. An email yields 0..n POs (three attachments are three
POs), so the email row is the processed-marker and the PO rows are the review queue.

`inbound_emails`: `message_id` text **NOT NULL UNIQUE** — this is both dedupe layer 1 and
the processed marker that replaces the IMAP `\Seen` flag; `classification` enum
(`po_found` | `no_po_found` | `failed`), `from_address`, `subject`, `received_at`,
`processed_at`.

`inbound_pos`: `inbound_email_id` FK cascade; `source_kind` enum (`image` | `pdf` |
`email_body`); `document_path` nullable (null for `email_body`); `content_hash` text
**NOT NULL, indexed, NOT unique**; `duplicate_of_id` uuid self-FK nullable; `status` enum
(`pending_extraction` | `extracting` | `pending_review` | `approved` | `discarded` |
`extraction_failed`); `attempt_count` int default 0; `extracted` jsonb nullable;
`check_results` jsonb nullable; `confirmed` jsonb nullable; `order_id` FK to orders
nullable; `skipped_at` timestamptz nullable.

**Why `content_hash` is not unique:** a duplicate document must still be insertable,
because the agreed design keeps duplicates in the review queue flagged rather than
rejecting them. Uniqueness would make that impossible. This corrects an earlier brainstorm
note that called for a unique index here.

**Why `extracted` and `confirmed` are both retained:** together they are the Feature 16
success metric (% approved with zero edits) and the only correction signal available to
Tasks 111–113. Deleting either loses it permanently.

**Functions to implement:**
- `insertInboundEmail(input): Promise<{ id: string } | { duplicate: true }>` — unique
  violation on `message_id` is caught and reported, not thrown
- `insertInboundPo(input): Promise<{ id: string }>`
- `findPoByContentHash(hash: string): Promise<{ id: string } | null>`
- `listPendingReview(): Promise<InboundPoRow[]>` — check-failures first, then
  `skipped_at NULLS FIRST`, then `created_at`
- `countPendingReview(): Promise<number>`

**Acceptance criteria:**
- [x] RLS is **enabled** on both new tables with policies matching the existing pattern —
      never disabled or bypassed (CONSTRAINT-06 — *the RLS constraint is actually
      **CONSTRAINT-05**; CONSTRAINT-06 is private storage buckets. Implemented against 05*)
- [x] `docs/constraints.md`'s "RLS is enabled on all 8 database tables" is updated to 10,
      or the count is made non-numeric. A stale number here is a security-relevant claim —
      **made non-numeric**: "8" was already stale against 10 live tables, so "10" would have
      been wrong too (the real post-0016 figure is 12). CONSTRAINT-05 now reads "every table
      in the database, without exception" and points at `architecture.md`'s per-table list,
      which was reconciled to 12 the same day. Decisions-log row 32
- [x] `message_id` is UNIQUE; a repeat insert returns `{ duplicate: true }` rather than
      throwing
- [x] `content_hash` is indexed and **not** unique; `duplicate_of_id` is a nullable self-FK
      (`set null`, matching the `orders.invoice_id` nullable-FK precedent)
- [x] Migration 0016 is forward-only — no `DROP`, no destructive statement. Asserted by
      `db/migrations/__tests__/0016.test.ts`, which also pins the only two `ALTER TABLE`
      targets to the two new tables
- [x] `listPendingReview` orders check-failures first, then unskipped before skipped
- [x] CQ-01: every function under 50 lines; CQ-02 all files under 300

**Tests required:**
- `insertInboundEmail` → happy: row created, id returned
- `insertInboundEmail` → error: duplicate `message_id` returns `{ duplicate: true }`,
  does not throw
- `listPendingReview` → check-failures sort ahead of clean rows; skipped sort last

**Status:** [x] Done (2026-10-07) — `db/schema/inbound.ts`, `db/migrations/0016_inbound_email_ingestion.sql`, `db/queries/inbound.ts` and `db/queries/__tests__/inbound.test.ts` created, plus `db/migrations/__tests__/0016.test.ts` (every migration since 0008 has one, and four criteria here are assertions about the SQL file). Three enums — the Files line says two, the body specifies three; the body wins. `content_hash` is NOT NULL + indexed + **not unique**, with the reason comments in both the schema and the migration and a test asserting no unique index, so it cannot be reverted by tidying. `message_id` NOT NULL UNIQUE; a repeat insert returns `{ duplicate: true }` without throwing. `duplicate_of_id` is a nullable self-FK; `duplicate_of_id` and `order_id` are `set null` (spec silent — follows the `orders.invoice_id` precedent). **New contract Task 101 must honour:** a check failure is an entry in a `failures` array on `check_results`, and the ORDER BY type-tests the jsonb before `jsonb_array_length` so an unexpected shape sorts as "no failures" rather than breaking the queue. CONSTRAINT-05's count made non-numeric (log row 32) and `architecture.md`'s RLS list reconciled to 12. **Migration 0016 written by hand and deliberately NOT applied** — no `db:*` command was run against the live database; applying it is the builder's call. `db/migrations/meta/` left untouched: it is a drizzle-kit artifact (`_journal.json` still lists only `0001`). No integration test split out — `db/queries/__tests__/` has never had one; all 11 files mock `@/db` and assert on compiled SQL, so there were no DB-dependent tests to move. Suite: 115 files / 1425 tests passing; `tsc` and `eslint` clean. **Open for Task 110:** `architecture.md:101` still calls `db/queries/*` "read-only DB functions", which this module's insert helpers contradict by spec.
**Depends on:** None
**Specialist:** @db

---

## Task 96: Read unprocessed mail over IMAP

**Files:**
- `lib/ingest/gmail.ts` — create
- `lib/ingest/types.ts` — create. `InboundMessage`, `InboundAttachment`, `GmailDeps`
- `lib/ingest/__tests__/gmail.test.ts` — create

**Approach:** `imapflow` for the connection, `mailparser` for MIME. This module performs
**no database and no storage writes** — it takes the set of already-processed message IDs
as an argument and returns parsed messages. Keeping it pure is what lets its tests run
without a database, matching the extraction playbook's package-boundary rule.

**Read state is never used.** Selection is by UID watermark plus the supplied processed-ID
set, never the `\Seen` flag — opening the inbox in Gmail must not affect ingestion.

**A-09 resolves itself here.** The first action of this task is an IMAP connection; if the
app password no longer works, that surfaces within minutes. Fallback is Gmail API OAuth,
with the 7-day testing-mode refresh-token trap noted in A-09.

**Functions to implement:**
- `fetchUnprocessedMail(processedIds: Set<string>, deps: GmailDeps): Promise<InboundMessage[]>`
- `parseMessage(raw: Buffer): Promise<InboundMessage>` — `{ messageId, from, subject,
  receivedAt, bodyText, attachments: { filename, mimeType, bytes }[] }`

**Acceptance criteria:**
- [x] SEC-01: `GMAIL_IMAP_USER`, `GMAIL_IMAP_APP_PASSWORD`, `GMAIL_IMAP_HOST` read from
      environment only; no credential in source, in a default, or in a log line
- [x] The app password never reaches `console.*`. Test asserts its absence from all logged
      arguments, following the precedent `LoginForm.test.tsx:79` set for the login password
- [x] EH-01 / EH-02: a connection or auth failure throws with context — host and user, never
      the password — and is never swallowed
- [x] No DB write, no storage write, no `db/` import in this module
- [x] Messages already in `processedIds` are not returned
- [x] **`GMAIL_IMAP_USER` must not equal `ADMIN_EMAIL`.** The ingestion inbox is a
      separate account; `ADMIN_EMAIL` is a live Supabase Auth credential
      (CONSTRAINT-04). A startup guard throws with context if the two match, rather
      than quietly reading the login mailbox
- [x] `.env.example` gains `GMAIL_IMAP_USER`, `GMAIL_IMAP_APP_PASSWORD` and
      `GMAIL_IMAP_HOST`, with a comment stating the separate-account rule and that
      the app password requires 2FA plus IMAP enabled on that account. Placeholder
      values only — that file is committed
- [x] Attachments are returned as bytes with their MIME type; body is returned as text
- [x] CQ-01: functions under 50 lines

**Tests required:**
- `parseMessage` → happy: fixture MIME with one PDF attachment yields one attachment and
  the body text
- `fetchUnprocessedMail` → error: auth failure throws with host and user in the message and
  the app password absent from it

**Status:** [x] Done (2026-10-07) — `lib/ingest/gmail.ts`, `lib/ingest/types.ts` and `lib/ingest/__tests__/gmail.test.ts` created (14 tests), plus `lib/ingest/ingest.constants.ts`, which this Files line omits but the feature preamble requires and Task 97 imports: it holds exactly the seven tunables the preamble names, each with its reason for being a constant rather than an env var. **No mailbox, network service or database was contacted** — `GmailDeps.openSession` is required with no default and `createImapSession` (the real `imapflow` session) is exported separately, so no test can reach a live inbox by forgetting to inject a fake. Three error classes went into `lib/errors.ts` beside the nine existing ones: `IngestConfigError`, `ImapConnectionError` (host + user in the message, app password actively scrubbed out of the interpolated reason) and `MimeParseError` (carries the IMAP UID, never body content). The `ADMIN_EMAIL` guard compares trimmed and case-insensitively and names `GMAIL_IMAP_USER`, `ADMIN_EMAIL` and CONSTRAINT-04 — but **not either address**, which CONSTRAINT-04 keeps out of every file including a log sink. Inbox opened `readOnly: true` and `imapflow`'s own logger disabled, so "`\Seen` is never touched" and "the LOGIN line is never printed" are properties of the connection, not promises about the code. **`GmailDeps` carries `config` and `sinceUid`, which the spec does not mention** — the spec requires a UID watermark but gives it no route into the pinned signature, so it travels in this task's own deps type, defaulting to the whole mailbox. **Nothing advances that watermark: Task 99 must decide where the high-water mark is persisted, or every run re-reads the whole mailbox** and relies on `processedIds` alone. **A-09 did NOT resolve** — the spec expects this task's first action to be a live IMAP connection, none was made, so a revoked app password is still undetected. Three constants the preamble names without pinning (`MAX_EXTRACTION_ATTEMPTS`, `COMPRESSED_IMAGE_MAX_DIMENSION`, `COMPRESSED_IMAGE_QUALITY`) were given starting values, each commented as such and pointing at the task that owns revising it. MIME fixture built in memory because `*.pdf` is gitignored repo-wide (CONSTRAINT-30). No integration-test file — nothing under `lib/` has ever had one. Suite: 116 files / 1439 tests passing (1425 before); `tsc` and `eslint` clean. **Doc defect, flagged not fixed:** this task's criteria cite SEC-01, SEC-05, EH-01, EH-02 and CQ-01, none of which exist in `docs/constraints.md` — they are framework rule ids, read as their obvious intent. No constraint was amended.
**Depends on:** None

---

## Task 97: Ingest fetched mail into the staging queue

**Files:**
- `lib/ingest/pipeline.ts` — create
- `lib/ingest/hash.ts` — create. `contentHash`, `normalizeBodyForHash`
- `lib/ingest/__tests__/pipeline.test.ts`, `lib/ingest/__tests__/hash.test.ts` — create

**Approach:** for each message — skip if its `message_id` already exists; write the
`inbound_emails` row; identify candidate POs (attachments of `image/*` or
`application/pdf`, else the body text); for each, hash it, upload to the `po-documents`
bucket, and write an `inbound_pos` row at `pending_extraction`, setting `duplicate_of_id`
when the hash has been seen before.

**Classification here is provisional.** This task can only classify *structurally* — an
accepted-type attachment means "probably a PO", and body-only text cannot be judged
without the model. Task 98 may retroactively set `no_po_found`. Stated so the two tasks do
not contradict each other.

**Body-only hashing is the weakest dedupe layer.** A twice-forwarded email quotes
differently each time, so `normalizeBodyForHash` strips quoted replies, signatures and
whitespace, and some duplicates will still reach the queue as new POs. Accepted —
nothing auto-approves, and the save-time PO-number check is the backstop.

**Functions to implement:**
- `ingestMessages(messages: InboundMessage[], deps: IngestDeps): Promise<IngestSummary>`
- `contentHash(input: Buffer | string): string` — SHA-256, hex
- `normalizeBodyForHash(body: string): string`

**Acceptance criteria:**
- [x] Idempotent: running twice over the same mailbox creates no new rows and no duplicate
      storage objects
- [x] Three accepted attachments on one email produce three `inbound_pos` rows
- [x] A body-only PO gets `source_kind = email_body`, a normalised-body hash, and no
      `document_path`
- [x] A repeat `content_hash` **still inserts** a row, with `duplicate_of_id` set and status
      `pending_extraction`, so it reaches the review queue
- [x] An email with no candidate PO still writes its `inbound_emails` row with
      classification `no_po_found` — nothing is silently discarded
- [x] CONSTRAINT-30: documents are written only to the `po-documents` bucket. No source
      document is ever written to the repository or any non-gitignored path. PO documents
      are production data by the same reasoning that applied to QA screenshots
- [x] EH-01 / EH-02: a failure on one message is caught, logged with its message id, sets
      that email's classification to `failed`, and the loop continues. One bad email must
      never abort the batch
- [x] A storage upload failure leaves **no** `inbound_pos` row — no row may point at a
      missing object
- [x] Logged context carries identifiers only — message id, hash, counts. No body text, no
      customer names, no attachment contents (SEC-01 / SEC-05)
- [x] CQ-01: functions under 50 lines; `pipeline.ts` under the service file cap

**Tests required:**
- `ingestMessages` → happy: one email with one PDF yields one email row, one PO row, one
  storage upload
- `ingestMessages` → error: storage upload rejects, so no PO row is created, classification
  is `failed`, and the remaining messages still process
- `normalizeBodyForHash` → happy: two forwarded variants of the same body hash equal
- `contentHash` → error case: empty input throws rather than returning a hash of nothing

**Status:** [x] Done (2026-10-07) — `lib/ingest/pipeline.ts` (240 lines), `lib/ingest/hash.ts`, `lib/ingest/candidates.ts` and the two test files created (22 tests; suite 118 files / 1461 tests passing, `tsc` and `eslint` clean); documents are hashed and uploaded **before** the `inbound_emails` row is written, because the Task 95 data layer has no classification-update helper and a storage failure must land as `classification = 'failed'` with no PO row on the first and only write; a repeat `content_hash` still inserts a row with `duplicate_of_id` set and `status` left to its column default, so a duplicate is flagged and reviewed rather than rejected; storage keys are content-addressed (`inbound/<sha256><ext>`, never the sender's filename), which is what makes a repeated batch create no duplicate object; `normalizeBodyForHash` unquotes `>` markers rather than dropping those lines (in a forward the PO *is* the quoted block) and strips forward/reply separators, attribution lines, re-emitted headers and the signature; `contentHash` throws `ContentHashError` on empty input; logs carry message ids, counts and 12-character hash prefixes only. **Deviations:** `candidates.ts` is a fifth file, split out because `pipeline.ts` was 331 lines against the 300-line cap this task's own CQ-01 criterion cites; `IngestDeps` / `IngestSummary` are declared in `pipeline.ts` because `types.ts` defines neither and was off-limits; `lib/errors.ts` gained `ContentHashError` and `DocumentUploadError`. **Flagged, not fixed:** a DB failure *after* the email row is written cannot correct that row's classification — it is logged with the message id and reported in `failedMessageIds`, but reconciling it needs an update helper in `db/queries/inbound.ts` (at 298/300 lines). **Owed by Task 104:** production wiring of `IngestDeps`, and a "list processed message ids" query, which `db/queries/inbound.ts` does not have.
**Depends on:** Task 95, Task 96

---

## Task 98: Extraction call — OpenRouter + ZDR, schema, source quotes

**Written 2026-10-12 after reading the first 4 real POs** (four senders, four layouts, all
single-page digital PDFs). Sample documents are production data and are **not** committed
or quoted here — not even sender names (`constraints.md:536`).

**Scope: one pure function, document in → structured reading out.** No database writes, no
queue, no retries — those are Task 103's worker. No checks — those are Task 101. This task
produces the JSON that `inbound_pos.extracted` will hold.

**Decisions from the brainstorm (2026-10-12), binding on this task:**
- **Tote types are interpreted, not matched.** Six types — 275/330 × Recon / Rebottled /
  New. Field descriptions give *examples* of each (Recon: `RECON`, `REC`,
  `Reconditioned`; Rebottled: `REB`, `REBOT`, `Rebottled`; sizes `275`/`330` with or
  without `GAL`/`G`), and the model is told to interpret unseen abbreviations. Extra
  descriptors (`Limited Use`, `NAT`, valve/bung specs) are ignored. **When the type is
  undeterminable the line is returned as `unknown` with its quote — never guessed.**
- **Every PO is a delivery.** `customer_collects` is not extracted (also PRD Out of Scope);
  the salesperson marks a pickup in review.
- **Delivery-date synonyms include ship date.** `Sched. Delivery Date`, `Need Date`,
  `Expected`, `Ship Date` are delivery-date candidates; `Order Date` / `P.O. Date` are
  not. All labelled dates are returned with label and role — choosing among several is
  Task 101/107's job (PRD: none pre-selected).
- **Price = Σ(qty × unit price) over tote lines only.** Non-tote lines (service notes,
  accruals, freight) are returned as `other` lines with any amount, **for Task 101's
  arithmetic check only — never persisted to `orders`.** A dedicated "Other" order field was
  proposed and **parked by the builder** — the existing order structure is unchanged.
- **One PO per document.** Confirmed by the builder; multi-PO PDFs are not handled.

**The vendor-block trap.** Every sample names *us* in a "Vendor" block, under varying legal
names. The prompt states the vendor is never the customer; the customer is the issuer
(letterhead / buyer / bill-to). Our name variants live in `extraction.constants.ts`.

**The several-numbers trap.** One sample carries its PO number under a bare `Number` label
*plus* an end-customer `CUST PO` and a `REF#`. The schema returns **all** PO-number
candidates with labels; the field description says the issuer's own PO number is the one
in the header, not one quoted inside a line description.

**Files:**
- `lib/extraction/extraction.constants.ts` — create. Default model (`openai/gpt-4.1-mini`),
  temperature 0, request timeout, `MAX_PDF_PAGES`, render scale, our vendor-name variants
- `lib/extraction/types.ts` — create. `ExtractionInput`, `ExtractedPo`, `ExtractedLine`,
  `ExtractedDate`, `Quoted<T>` (`{ value, quote }`)
- `lib/extraction/schema.ts` — create. JSON schema sent as `response_format`, per-field
  descriptions, and the zod schema validating the response
- `lib/extraction/prompt.ts` — create. System prompt
- `lib/extraction/config.ts` — create. `readExtractionConfig(env)`, mirroring
  `readGmailImapConfig`: `OPENROUTER_API_KEY` required, `OPENROUTER_MODEL` optional
- `lib/extraction/render-pdf.ts` — create. PDF → one PNG per page (CONSTRAINT-35/36)
- `lib/extraction/openrouter.ts` — create. The HTTP call
- `lib/extraction/extract.ts` — create. `extractPo` orchestrator + `toOrderQuantities`
- `lib/extraction/__tests__/*.test.ts` — create
- `.env.example` — modify. `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` placeholders
- `package.json` — modify. Adds the PDF renderer

**Approach:**
1. **Input by kind.** PDF → rendered to page images. Image (`jpeg`/`png`/`webp`) → passed
   through unmodified. Email body → sent as text. Over `MAX_PDF_PAGES` → a typed error
   naming the page count, which Task 103 turns into a visible review row (CONSTRAINT-34) —
   **never silently truncated**.
2. **PDF renderer: `pdfjs-dist` + `@napi-rs/canvas`** (Apache-2.0 / MIT, prebuilt Linux
   binaries for Vercel). Rejected: `mupdf` — one package, but **AGPL**; native PDF
   passthrough — unverified with this provider (CONSTRAINT-36). **Assumption to verify in
   this task:** `@napi-rs/canvas` loads in a Vercel function. If not, stop and re-decide.
3. **The call.** `POST /api/v1/chat/completions` with a strict `json_schema`
   `response_format` and `provider: { zdr: true, require_parameters: true }`. **`zdr: true`
   is a literal in code, no env override** (plan header). No usable ZDR route → OpenRouter
   errors → we throw loudly; there is no fallback.
4. **Response handling.** Parsed with zod. Malformed JSON, schema mismatch, non-2xx and
   timeout each throw a distinct typed error with model, status and context — **never
   document content** (SEC-01/05).
5. **Output shape (stored as `extracted`).** Per field `{ value, quote }`: PO-number
   candidates, customer name, ship-to address, bill-to address, labelled dates (value,
   label, role: `order` | `delivery` | `other`), stated total, and lines — each
   `{ kind: 'tote' | 'other', toteType: one of 6 | 'unknown', qty, unitPrice, lineTotal,
   quote }`. Plus `isPurchaseOrder: boolean`, so a non-PO document can become
   `no_po_found` (Task 97's provisional classification).
6. **`toOrderQuantities(extracted)`** — pure; sums tote lines into the six `qty_*` /
   `unit_price_*` slots and derives `price`. Two lines of one type at **different** unit
   prices → reported as a conflict, not averaged.

**Evaluation — acceptance gate, outputs never committed.** Run `extractPo` on the 4 real POs
via a scratchpad script; the builder checks every field against the document. Pass bar:
tote type, qty and unit price right on every tote line; PO number and delivery date right
where present; nothing invented where the document is blank.

**Functions to implement:**
- `extractPo(input: ExtractionInput, config: ExtractionConfig, deps?): Promise<ExtractedPo>`
- `renderPdfPages(pdf: Buffer, maxPages: number): Promise<Buffer[]>`
- `callOpenRouter(request, config, fetchImpl): Promise<unknown>`
- `readExtractionConfig(env): ExtractionConfig`
- `toOrderQuantities(extracted: ExtractedPo): OrderQuantities`

**Acceptance criteria:**
- [x] `zdr: true` on every request; a test fails if it is absent or env-controlled
- [x] `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` from env only; a missing key throws at
      config read, naming the variable
- [x] PDFs reach the model as page images, never as a PDF; images unmodified
- [x] Every returned value carries a quote; `unknown` tote type is a valid output, not an error
- [x] Over-page-limit, malformed response, non-2xx and timeout each throw a distinct typed
      error; none caught and swallowed (EH-01/02)
- [~] Logs carry model, status, page count, durations — **moved to Task 103** (@security L-A, 2026-10-12): `lib/extraction/` deliberately has no log statements; the worker that calls it logs model, status, page count and ms, never content. Ticked in error at first
- [x] Evaluation passes on all 4 POs, confirmed by the builder
- [x] CQ-01/02: functions < 50 lines, files < 300
- [x] Full suite green; `tsc` and `lint` clean

**Tests required:**
- `readExtractionConfig` → happy; missing key throws
- `callOpenRouter` → body has `zdr: true`, strict schema, model from config; non-2xx
  throws with status; timeout throws
- `extractPo` → happy with mocked fetch; malformed JSON throws; schema mismatch throws
- `renderPdfPages` → synthetic in-test PDF (never a real PO) yields N PNGs; over limit throws
- `toOrderQuantities` → lines sum into the right slots; one type at two prices reports a
  conflict; `other` lines excluded from price

**Model output is untrusted input for Tasks 101/107 (@security L-D).** Prompt injection in a
document can set any field: `isPurchaseOrder: false`, negative or huge quantities and prices,
arbitrary-length quotes. Downstream must: keep `no_po_found` a visible review row, never a drop
(CONSTRAINT-34); bound numbers (integer quantity > 0, price ≥ 0 with a sane max) before they
reach `orders`; render quotes as text only, never HTML.

**Open for Task 101, surfaced so it is not lost:** quote verification against a **rendered
image** has no local text to check — CONSTRAINT-35 forbids local text extraction.
Body-text POs verify trivially; images do not. Task 101 must decide how.

**Specialist:** —
**Status:** [x] Done 2026-10-12 — `lib/extraction/`: constants, types, errors, schema, prompt, config, render-pdf, openrouter, extract (largest file 150 lines, longest function ~30). Built by three parallel subagents against a hand-written shared contract (types, schema, errors). **Evaluation passed on all 4 real POs, confirmed by the builder** — tote type, qty and unit price right on every tote line; PO number and delivery date right where present; nothing invented. **It took two prompt iterations:** first run named one PO's ship-to company as the customer; second named a buyer's initials; the customer rule is now "Bill To company, else letterhead — never ship-to, never a person". Empty `$0.00` template rows were also being returned as lines; now skipped. **Deviations:** errors live in `lib/extraction/errors.ts` rather than `lib/errors.ts` (merging would push that file to ~319 lines, over CQ-02); `toOrderQuantities` stayed in `extract.ts` (141 lines). **New deps:** `pdfjs-dist` 6.4.299, `@napi-rs/canvas` 1.0.11, pinned — **not yet run on Vercel** (A-14 records the `serverExternalPackages` + Node ≥ 22.13 prerequisites for Task 103/104). Timeout covers the response body too, not just headers. Suite 127 files / 1591 tests; `tsc` and `eslint` clean. Also fixed in passing: a `db/seed.ts` type error introduced by the CONSTRAINT-20 guard commit.
**Depends on:** Task 94 (done)

---

## Task 99: Track processed mail by UID + UIDVALIDITY (CONSTRAINT-33)

**Planned 2026-10-12.** Pulled ahead of the check suite by decision: it has no dependency on
extraction and clears HIGH-01, the only open High. **Re-run `@security` after this task.**

**Files:**
- `db/migrations/0017_uid_watermark.sql` — create. `inbound_emails` gains `uid_validity bigint
  NOT NULL` and `uid bigint NOT NULL` + `UNIQUE (uid_validity, uid)`; `message_id` drops
  `UNIQUE` and `NOT NULL`. New table `ingest_mailbox_state` (`mailbox text PK`,
  `uid_validity bigint NOT NULL`, `last_uid bigint NOT NULL`, `last_run_at timestamptz`) with
  RLS matching CONSTRAINT-05. **The migration aborts loudly if `inbound_emails` has any row.**
  Applied locally via `db:migrate-local`; prod by the builder pasting into the SQL editor
  (never `db:migrate`).
- `db/migrations/__tests__/0017.test.ts` — create
- `db/schema/inbound.ts` — modify to match; header comment rewritten (message_id is a label)
- `db/queries/inbound.ts` — **split** (298/300 lines) into `inbound-emails.ts`,
  `inbound-pos.ts`, `ingest-state.ts`; tests split to match
- `lib/ingest/imap-session.ts` — modify. Expose the open mailbox's `uidValidity`
- `lib/ingest/gmail.ts`, `lib/ingest/message.ts`, `lib/ingest/types.ts` — modify
- `lib/ingest/identity.ts` — **delete** (with its tests). `boundHeader` moves to `message.ts`
- `lib/ingest/hash.ts` — modify. `refusalHash(uidValidity, uid, failure)` replaces
  `surrogateContentHash`
- `lib/ingest/pipeline.ts` — modify. Writes via `stageEmailWithPos`
- `lib/ingest/run.ts` — create. Orchestrator; not wired to any route (Task 104)

**Approach:**
1. **Admission is by UID only.** `collectUnprocessed` drops `processedIds`; a message is admitted
   iff `uid > watermark` and `uid ∉ stagedUidsAbove(watermark)` (a UID-only DB lookup, so H-01's
   "admission before bytes" holds and no parsed header participates). The post-parse UID
   re-check returns as layer two (architecture rule 3).
2. **`InboundMessage` gains `uid`; `messageId` becomes `string | null`** — a bounded display
   label. No branch reads it. `identityForDeclared`, `standInMessageId`, `canonicalMessageId`
   and the `ingest-uid:` / `ingest-longid:` / `ingest-claimed:` prefixes are removed.
3. **One transaction per message.** `stageEmailWithPos(email, pos[])` inserts the email row and
   all its PO rows atomically; a `(uid_validity, uid)` unique violation returns
   `{ duplicate: true }` (reported, not thrown). Uploads happen before it (content-addressed,
   idempotent).
4. **`runIngestion(deps): Promise<IngestRunSummary>`** — read state → open session → compare
   UIDVALIDITY → fetch → stage → advance → write `last_run_at`. The watermark advances to the
   **highest UID such that every listed UID ≤ it is committed or already staged**. A failed or
   deferred message halts the advance there and is returned in the summary
   (`haltedAtUid`, `failedUids`, `deferredUids`). Later messages are still staged.
5. **UIDVALIDITY changed** → `console.error` with old and new values, watermark reset to 0 under
   the new validity; `content_hash` flags the re-ingested duplicates (architecture failure-mode
   table).

**Functions to implement:**
- `runIngestion(deps: IngestRunDeps): Promise<IngestRunSummary>`
- `advanceWatermark(current: number, outcomes: UidOutcome[]): number` — pure
- `stageEmailWithPos(email, pos): Promise<{ id: string } | { duplicate: true }>`
- `readIngestState(mailbox)`, `writeIngestState(state)`, `stagedUidsAbove(uidValidity, uid)`
- `refusalHash(uidValidity, uid, failure): string`

**Acceptance criteria:**
- [x] No branch reads `message_id`; a test stages two messages sharing one `Message-ID`, both land
- [x] Crash between staging and watermark advance: next run re-lists, the composite unique blocks
      a second staging, no bytes are re-downloaded for already-staged UIDs
- [x] A failed or deferred UID halts the watermark below it and appears in the run summary
- [x] UIDVALIDITY change resets the watermark and logs loudly
- [x] `identity.ts` deleted; no `ingest-uid:` / `ingest-longid:` / `ingest-claimed:` left in `lib/` or `db/`
- [x] Migration test: no unique index on `message_id`; composite unique present; abort-if-rows
      guard present; RLS enabled on `ingest_mailbox_state`
- [x] `readOnly: true` on the IMAP connection unchanged
- [x] SEC-05: logs carry UIDs, counts and hash prefixes — never addresses, subjects or bodies *(re-ticked after MEDIUM-04 was fixed and re-verified 2026-10-12)*
- [x] CQ-01/02: functions < 50 lines, files < 300; full suite green; `tsc` and `eslint` clean

**Tests required:**
- `advanceWatermark` → contiguous success advances; a gap halts; empty run unchanged
- `runIngestion` → happy path advances + writes `last_run_at`; failure halts; UIDVALIDITY change
  resets; already-staged UID skipped without `fetchSource`
- `stageEmailWithPos` → inserts both; duplicate returns `{ duplicate: true }`; other DB error throws
- `collectUnprocessed` → admits by UID; post-parse re-check rejects a UID at/below the watermark
- `0017` migration → SQL assertions above

**Depends on:** Tasks 95–97 (done)
**Specialist:** @db
**Status:** [x] Done (2026-10-12). `@security` CLEAR after two targeted fixes: HIGH-02 (NUL headers and implausible dates cleaned at the boundary) and MEDIUM-04 (`lib/loggable-failure.ts`). **Residual HIGH-02R** (a message that keeps failing pins the watermark) is owed by **Task 100** as builder option 1, "give up after N tries", via `@cto`; it gates Task 104. 0017 applied locally only, not prod. `stageEmailWithPos` resolves `duplicate_of_id` inside its transaction, so sibling POs in one email are flagged. `insertInboundEmail`, `insertInboundPo` and `findPoByContentHash` are removed: nothing calls them now. `fetchUnprocessedMail` is replaced by `openMailbox` / `collectUnprocessed` / `closeMailbox`, because UIDVALIDITY is only known once the session is open. The upload-failure path still commits a `failed` email row; Task 100 changes that. See the session log.

---

## Task 100: No silent drops, and the exact accepted file types (CONSTRAINT-34/35)

**Planned 2026-10-12.** Every path that today drops part of a message becomes a review row.

**Files:**
- `lib/ingest/ingest.constants.ts` — modify. `ACCEPTED_MIME_TYPES` = exactly
  `application/pdf`, `image/jpeg`, `image/png`, `image/webp`; `PO_DOCUMENT_EXTENSIONS` shrinks to
  match; `PO_DOCUMENT_FALLBACK_EXTENSION` removed
- `lib/ingest/candidates.ts` — modify. Wildcard matcher removed; `image/jpg` normalised to
  `image/jpeg` before matching
- `lib/ingest/types.ts` — modify. `IngestLimitReason` gains `unsupported_format`,
  `empty_attachment`, `no_po_found`; `IngestLimitFailure` gains optional `mimeType`
  (sanitised to `type/subtype`, ≤ 100 chars). Discriminator `check: 'ingest_limit'` unchanged
- `lib/ingest/limits.ts`, `lib/ingest/pipeline.ts` — modify
- tests for each

**Approach:**
- Unlisted type → `unsupported_format` refusal row carrying the sanitised MIME type, so the
  review row can say "ask the vendor to re-send as PDF or JPG".
- Empty attachment → `empty_attachment` refusal row (replaces the `console.error` + `continue`).
- No candidates and no refusals → one `email_body` row with reason `no_po_found`, in the review
  queue. Spam is dismissed by a human, never by the system.
- **Storage upload failure throws for that message** — nothing commits, Task 99's watermark halts
  below it, the next run retries. The current "write the refusals only and classify `failed`"
  partial path is removed.
- **M-03 (inline parts) accepted as-is, by decision 2026-10-12:** a signature GIF becomes an
  `unsupported_format` row beside the real PO; filtering inline images would be a drop path, and
  a pasted PO screenshot is an inline image. Revisit after real usage.

**Acceptance criteria:**
- [x] Every path through `selectCandidates` / `stageDocuments` ends in a committed row or a thrown
      error — one test per message shape
- [x] SVG, HEIC, TIFF and GIF attachments each produce an `unsupported_format` row
- [x] An email with no PO and no attachment content produces exactly one `no_po_found` review row
- [x] An upload failure leaves no row for that message and halts the watermark
- [x] SEC-05: no sender filename, subject or body in `check_results` or logs
- [x] CQ-01/02; full suite green; `tsc` and `eslint` clean

**Tests required:**
- `selectCandidates` → accepted types pass; each excluded type refused; `image/jpg` accepted;
  empty attachment refused; nothing → `no_po_found`
- `ingestMessages` / `runIngestion` → upload failure throws and nothing commits

**Depends on:** Task 99
**Status:** [x] Done (2026-10-12). `selectCandidates` now ends every attachment as a candidate or a refusal (`triageAttachment`), and an email with neither yields one `no_po_found` row (email classified `no_po_found`, not `failed`). `PO_DOCUMENT_EXTENSIONS` is keyed by `AcceptedMimeType`, so the compiler enforces the pairing; `documentPathFor` has no fallback. `mimeType` on a refusal is lowercased, parameter-stripped, checked against RFC 6838 characters and dropped (not truncated) above `MAX_RECORDED_MIME_TYPE_LENGTH`. Upload failure propagates to `ingestMessages` → `failedUids` → watermark halts; proven end to end in `run.test.ts`. **Not in this task:** HIGH-02R "give up after N tries" — the Task 99 status line says Task 100 owes it, but this spec never included it; it still needs `@cto` and gates Task 104. Suite 132 files / 1633 tests.

---

## Task 114: Give up on a UID after 3 failing runs + 1 hour (CONSTRAINT-37, HIGH-02R)

**Planned 2026-10-12** (`@cto` → FB-41, CONSTRAINT-37). Numbered 114 to avoid another renumber;
**executes before Task 101 and gates Task 104.** Closes HIGH-02R: no message can pin the
watermark. Design: `docs/architecture.md` → "Give-up rule".

**Files:**
- `db/migrations/0019_ingest_uid_failures.sql` — create. Table `ingest_uid_failures`
  (`uid_validity bigint`, `uid bigint`, PK both; `attempts integer NOT NULL`;
  `first_failed_at`, `last_failed_at timestamptz NOT NULL`). RLS per the 0002 single-user
  pattern. Prod: pasted by hand before Task 104; locally `db:migrate-local`. Never `db:migrate`.
- `db/migrations/__tests__/0019.test.ts` — create
- `db/schema/inbound.ts` — modify (table definition)
- `db/queries/ingest-failures.ts` + `db/queries/__tests__/ingest-failures.test.ts` — create
- `lib/ingest/limits.constants.ts` — modify. `GIVE_UP_MIN_ATTEMPTS = 3`,
  `GIVE_UP_MIN_AGE_MS = 60 * 60 * 1000` (builder decision, not env vars)
- `lib/ingest/types.ts` — modify. `IngestLimitReason` gains `staging_failed`; `unit` gains
  `runs`; `DeclaredMessage` and `InboundMessage` gain `arrivedAt: Date | null` (IMAP
  `INTERNALDATE`, server-assigned); `CollectedMail` gains `arrivals: Map<number, Date | null>`
- `lib/ingest/imap-session.ts` — modify. Listing also requests `internalDate`; still never `source`
- `lib/ingest/message.ts`, `lib/ingest/gmail.ts` — modify. Carry `arrivedAt` through, fill `arrivals`
- `lib/ingest/give-up.ts` + `lib/ingest/__tests__/give-up.test.ts` — create
- `lib/ingest/run.ts` + `lib/ingest/__tests__/run.test.ts` — modify. New injected deps:
  `recordFailures`, `clearFailures`, `clearOtherValidities`

**Functions to implement:**
- `recordFailures(uidValidity: number, uids: number[], now: Date): Promise<FailureRecord[]>` —
  upsert; `attempts + 1`, `last_failed_at = now`, `first_failed_at` kept on conflict; returns
  the post-increment rows. Throws `DatabaseError`
- `clearFailures(uidValidity: number, uids: number[]): Promise<void>`
- `clearOtherValidities(uidValidity: number): Promise<void>` — on a UIDVALIDITY reset
- `shouldGiveUp(record: FailureRecord, now: Date): boolean` — `attempts >= GIVE_UP_MIN_ATTEMPTS`
  **and** `now - first_failed_at >= GIVE_UP_MIN_AGE_MS`. Pure
- `placeholderMessage(uid: number, arrivedAt: Date | null, attempts: number): InboundMessage` —
  `messageId`/`from`/`subject` null, `receivedAt = arrivedAt`, empty body, no attachments,
  `rejection = { check: 'ingest_limit', reason: 'staging_failed', part: 'message',
  measured: attempts, limit: GIVE_UP_MIN_ATTEMPTS, unit: 'runs' }`. Pure

**Flow in `runIngestion`** (after `ingestMessages`, before `writeState`):
1. `failed = staging.failedUids ∪ collected.rejectedUids`. Deferred UIDs are never included.
2. `records = recordFailures(failed)`; for each record where `shouldGiveUp`, stage
   `placeholderMessage(...)` through `ingestMessages`; its committed UIDs move from failed to
   committed.
3. `clearFailures` for every committed UID, placeholders included. On a UIDVALIDITY reset,
   `clearOtherValidities` first.
4. `advanceWatermark` as today; summary reports `gaveUpUids`.

**Acceptance criteria:**
- [x] 3 failing runs but < 1 hour since the first → no placeholder, watermark still halted
- [x] ≥ 1 hour but < 3 failing runs → no placeholder
- [x] 3 runs **and** ≥ 1 hour → one `failed` `inbound_emails` row (`message_id`, `from_address`,
      `subject` NULL; `received_at` = INTERNALDATE) + one `staging_failed` row at
      `pending_review`; the watermark passes the UID
- [x] Deferred UIDs never increment a counter
- [x] A UID that commits on retry has its counter row deleted
- [x] Placeholder write fails (DB down) → UID stays failed, counter kept, retried next run
- [x] A UIDVALIDITY change clears counters belonging to the old validity
- [x] SEC-05: no sender-written value in the placeholder, `check_results` or logs
- [x] H-01: the listing still never requests `source` (existing test stays green)
- [x] EH-01/02: counter failures throw `DatabaseError` with UIDs only, no headers
- [x] CQ-01/02; full suite green; `tsc` and `eslint` clean

**Tests required:**
- `shouldGiveUp` → both thresholds on each side of the boundary
- `placeholderMessage` → exact shape; no header field set
- `runIngestion` → fail ×3 with the clock advanced past 1 hour → placeholder staged, watermark
  advances, counter cleared; deferred never counts; retry success clears the counter;
  placeholder write throws → UID still failed, counter kept
- `ingest-failures` against local Postgres → upsert increments, `first_failed_at` preserved,
  clear removes rows
- `0019` → table, PK, RLS present

**Depends on:** Task 100 (done)
**Specialist:** @db
**Status:** [x] Done (2026-10-12). `giveUpOnFailures` (in `give-up.ts`) owns increment → threshold → placeholder staging; `runIngestion` calls it through `settleFailures` and then clears the counter. Two small additions beyond the spec: (1) `clearFailures` also clears **already-staged** UIDs, so a crash between a commit and its clear leaves no stale row; (2) `recordFailures` rejects an unparseable timestamp read back from the DB instead of returning `Invalid Date`. New `npm run test:integration` loads `.env` and runs `*.integration.test.ts` against the local stack (guarded to localhost); `npm test` skips those visibly. 0019 applied locally and pasted into prod by the builder (2026-10-12). Mutation-checked: OR'd thresholds, counting deferred UIDs and dropping the clear all fail tests. Suite 137 files / 1670 passed + 3 integration skipped.

---

## Task 101: Check suite — quotes, arithmetic, dates, field gates

**Planned 2026-10-12.** Pure functions: extraction in, `check_results` out. No DB writes (Task 103's
worker persists). Quote verification per FB-40 / CONSTRAINT-35 (amended).

**Files:**
- `lib/extraction/render-pdf.ts` — modify. The same parse also returns each page's text layer
  (`getTextContent`), under the existing bounds and deadline
- `lib/extraction/extract.ts` — modify. `extractPo` returns `{ extracted, sourceText }`;
  `sourceText` is `string[]` (PDF pages, or `[body]` for text input) or `null` (image, or a PDF
  whose text layer is blank — a scan). **The text is never added to the model request.**
- `lib/checks/checks.constants.ts` — create. `MAX_QUOTE_CHARS`, `MAX_LINE_QUANTITY`,
  `MAX_UNIT_PRICE`, `MONEY_TOLERANCE_CENTS` (0)
- `lib/checks/types.ts` — create. `CheckName`, `CheckFailure { check, field, detail }`,
  `QuoteResult { field, status: 'verified' | 'not_found' | 'unverifiable' }`, `CheckResults`
- `lib/checks/quotes.ts`, `arithmetic.ts`, `dates.ts`, `fields.ts`, `run-checks.ts` — create
- `lib/checks/__tests__/*.test.ts` — create

**Output:** `check_results = { version: 1, failures: CheckFailure[], quotes: QuoteResult[] }` —
`failures` honours the Task 95 contract.

**Checks (each a `failures` entry):**
- **Quote:** `not_found`; or longer than `MAX_QUOTE_CHARS`. `unverifiable` is recorded in
  `quotes`, never a failure. Matching normalises case, whitespace and punctuation spacing; a
  token-order fallback tolerates table-column reordering — tuned on the 4 POs.
- **Arithmetic:** stated total ≠ Σ(qty × unit) over tote lines **to the cent** (the $7,800 vs
  $7,800.18 gap fails), unless `other` lines account for the delta exactly (pass, listed in
  `detail`); qty × unit ≠ line total; line total with no unit price that does not divide evenly
  by qty to the cent.
- **Dates:** ambiguous (both numeric components ≤ 12 and unequal) **unless another date on the
  same document proves the order** (a component > 12 fixes MM/DD vs DD/MM for the document);
  more than one `delivery` candidate.
- **Fields:** no PO number; no ship-to address; any `unknown` tote line; one tote type at two
  prices (`toOrderQuantities` conflicts); `isPurchaseOrder: false`; bounds (L-D) — quantity an
  integer > 0 and ≤ `MAX_LINE_QUANTITY`, unit price ≥ 0 and ≤ `MAX_UNIT_PRICE`; flagged, never
  clamped.

**Functions to implement:**
- `runChecks(extracted: ExtractedPo, sourceText: string[] | null): CheckResults`
- `verifyQuote(quote: string, sourceText: string[] | null): QuoteResult['status']`
- `checkArithmetic(extracted): CheckFailure[]`, `checkDates(extracted): CheckFailure[]`,
  `checkFields(extracted): CheckFailure[]`

**Evaluation — acceptance gate, outputs never committed:** run extraction + checks on the 4 real
POs via a scratchpad script. Every genuine quote `verified` — **zero false `not_found`**; a planted
invented value returns `not_found`; the Dakota-style gap is flagged. Builder confirms.

**Acceptance criteria:**
- [x] A test proves `sourceText` never appears in the OpenRouter request body
- [x] Image input → every quote `unverifiable`, no quote failures
- [x] Each check above has a passing and a failing test
- [x] Every number in the checks comes from `checks.constants.ts` (no magic numbers)
- [x] Quotes rendered nowhere as HTML (L-D) — checks store status, not markup
- [x] Evaluation passes on all 4 POs, confirmed by the builder
- [x] CQ-01/02; full suite green; `tsc` and `eslint` clean

**Tests required:** per check — happy and failing; `verifyQuote` → verified / not_found /
unverifiable / column-reordered match; `renderPdfPages` → synthetic PDF returns text per page,
blank-text PDF yields `null` upstream; `runChecks` → `failures` key always an array.

**Depends on:** Task 98 (done). Independent of 112/113.
**Status:** [x] Done (2026-10-12). `lib/checks/` (constants, types, fuzzy, quotes, arithmetic, dates, fields, run-checks); `renderPdfPages` now returns `{ images, text }` from the same parse; `extractPo` returns `{ extracted, sourceText }`. **Evaluation passed, builder confirmed:** live run on the 4 POs: 36/36 quotes `verified`, zero false `not_found`; a planted total is `not_found` on all 4; Dakota flagged. **Builder decision:** a total gap that `other` lines cover exactly is still a `total_mismatch` failure, with the covering lines named in `detail` (the spec contradicted itself). **Beyond the spec:** (1) all-letter quote tokens of 5+ characters may differ by one edit, because the model fixes misspellings when quoting ("Arlintgon", "VITON"); digits always exact; (2) `MAX_SOURCE_TEXT_CHARS` (30k): over it, quotes are `unverifiable` plus a `source_text_too_long` failure, which bounds the matcher; (3) a tote line with no quantity fails `quantity_out_of_bounds`; (4) the same delivery date printed twice is not flagged. **Known limit:** the token fallback does not require tokens to be adjacent. **Not built:** a check for a date read against the document's proven day/month order. Limits: `MAX_LINE_QUANTITY` 500, `MAX_UNIT_PRICE` $1,000, `MAX_QUOTE_CHARS` 600. Mutation-checked. Suite 1740 passed + 3 integration skipped; `tsc` and `eslint` clean.

---

## Task 102: Customer matcher — normalise + pg_trgm + address signal

**Planned 2026-10-12.** Builder decisions (2026-10-12): pre-fill on an exact normalised match
only; results live in `check_results.customerMatch`; the address signal boosts and surfaces but
never pre-fills alone; thresholds are tuned on a customer CSV the builder exports. Task 103's
worker calls the matcher and persists the result. This task writes no `inbound_pos` rows.
A-12 is resolved (`pg_trgm` 1.6 available, not installed).

**Files:**
- `db/migrations/0020_customer_matcher.sql` — create. `CREATE EXTENSION IF NOT EXISTS pg_trgm
  WITH SCHEMA extensions`; `public.normalise_company_name(text)` and
  `public.normalise_address(text)`, both `IMMUTABLE` with `SET search_path = ''`. No trigram
  index: at ~100 customers a sequential scan is trivial. The file records that reason.
- `db/migrations/__tests__/0020.test.ts` — create (assertions on the SQL file, following the 0016+ precedent)
- `db/queries/customer-match.ts` — create. One parameterised query
- `db/queries/__tests__/customer-match.integration.test.ts` — create (real pg_trgm on the local stack)
- `lib/matching/matching.constants.ts` — create. `NAME_SIMILARITY_MIN`, `ADDRESS_SIMILARITY_MIN`,
  `ADDRESS_BOOST`, `MAX_CUSTOMER_CANDIDATES`
- `lib/matching/types.ts`, `lib/matching/match-customer.ts` — create
- `lib/checks/types.ts` — modify. Add `no_customer_match` and `ambiguous_customer` to `CheckName`;
  add an optional `customerMatch?: CustomerMatch` to `CheckResults` (additive, so the version stays 1)
- `lib/matching/__tests__/match-customer.test.ts` — create

**Normalisation (SQL is the single source):** lowercase; `&` becomes `and`; strip punctuation;
collapse whitespace; drop trailing US suffixes (inc, llc, ltd, co, corp, corporation, company)
and a leading "the". Address: lowercase, strip punctuation, collapse whitespace, and unify
common abbreviations (street/st, road/rd, avenue/ave, suite/ste). The UK suffixes in A-12's
contingency (Ltd/PLC) were for the wrong market.

**Output:** `customerMatch = { prefillCustomerId: string | null, candidates: { customerId,
score, nameScore, addressMatched, status }[] }`. **IDs and numbers only, never names or
addresses** (SEC-05 / L-D).

**Functions to implement:**
- `findCustomerCandidates(name: string | null, shipTo: string | null): Promise<CandidateRow[]>`:
  customers with name similarity ≥ `NAME_SIMILARITY_MIN`, UNION any customer with a saved
  address at similarity ≥ `ADDRESS_SIMILARITY_MIN`. Returns the name score, the best address
  score and an exact-match flag.
- `matchCustomer(extracted: ExtractedPo): Promise<CustomerMatch>`: rank by nameScore, plus
  `ADDRESS_BOOST` when an address matched; cap at `MAX_CUSTOMER_CANDIDATES`.
- `customerMatchFailures(match: CustomerMatch): CheckFailure[]`: pure.

**Acceptance criteria:**
- [x] Exactly one customer's normalised name equals the PO's → `prefillCustomerId` set
- [x] Two customers share that normalised name → no pre-fill, `ambiguous_customer`
- [x] Fuzzy-only matches → ranked, `prefillCustomerId` null, `ambiguous_customer`
- [x] Address-only match → listed but never pre-filled, even when it is the only candidate
- [x] No candidates (or both name and ship-to null) → `no_customer_match`, empty list
- [x] Inactive customers are included and carry `status`
- [x] The query is parameterised; no SQL is built from strings (SEC: parameterised queries)
- [x] The migration is applied locally with `db:migrate-local` only. Prod gets it when the builder
      pastes it in. **Never `db:migrate`.**
- [x] Every threshold comes from `matching.constants.ts` (no magic numbers)
- [x] A DB failure throws with context (EH: loud) and never returns an empty match
- [x] CQ-01/02; full suite green; `tsc` and `eslint` clean
- [x] Evaluation passes, confirmed by the builder (below)

**Evaluation — acceptance gate, outputs never committed:** the builder exports `company_name`
and addresses from prod to a CSV in the scratchpad. A script loads it into the local DB and runs
the 4 sample POs' `customerName` / `shipToAddress` through `matchCustomer`. Pass: each PO's true
customer is either pre-filled or ranked #1, and no wrong customer is ever pre-filled. Thresholds
are adjusted in the constants file only.

**Tests required:** normalisation (suffixes, `&`, punctuation, a leading "The") in the
integration test; a passing and a failing test for each criterion above; a DB error throws with
context; `customerMatchFailures` covers each failure kind.

**Risks:** the evaluation takes prod customer data to local disk (scratchpad only, never
committed). Migration 0020 must be pasted into prod before Task 104 goes live. A customer renamed
or deleted after matching leaves a stored ID that is stale or missing, and Task 107 must handle it.

**Depends on:** Task 101 (done). Feeds Task 103 (which calls it), Task 107 (which renders the
candidates) and Task 113 (whose aliases feed `findCustomerCandidates`).
**Specialist:** @db
**Status:** [x] Done (2026-10-12). Migration 0020 (pg_trgm in `extensions`, two IMMUTABLE normalisers with `search_path=''`, EXECUTE revoked from the API roles) is applied locally; **pasted into prod by the builder 2026-10-12.** `db/queries/customer-match.ts` and `lib/matching/` are in; `lib/checks/types.ts` gains `no_customer_match`, `ambiguous_customer` and an optional `customerMatch`. **Evaluation passed, builder confirmed:** on a 100-row prod export (local only, gitignored as `docs/*.csv`), Mansfield, BASCO and Dakota are pre-filled correctly, and Rhenium is ranked #1 without a pre-fill. **Changes from the evaluation (builder-approved):** (1) periods and apostrophes are deleted, not turned into spaces, so "L.L.C." is stripped (a bug); (2) `nf` counts as a suffix, because "(NF)" is the salesperson's own tag; (3) a new list-only signal, `NAME_IN_ADDRESS_SIMILARITY_MIN` (0.8), uses pg_trgm `word_similarity` to find the PO name inside saved addresses. Saved addresses open with the legal name while `company_name` holds a nickname ("Delta Energy/Rhenium"), so this signal never pre-fills. Also beyond the spec: address normalisation unifies drive, boulevard, highway and parkway. Mutation-checked the pre-fill rule and the address boost. Suite 1767 passed; integration passes on the local stack; `tsc` and `eslint` clean.

---

## Task 103: Worker foundations — body text, lease column, storage module, failed rows visible

**Planned 2026-10-12 (@cto FB-42, CONSTRAINT-38).** The original Task 103 ("drain, self-chain,
retry") is split into three: **103** (data and access, this task), **115** (worker core) and
**116** (route and self-chain). This keeps each piece testable on its own and within CQ-02.
This task adds data and access only; no extraction runs yet.

**Files:**
- `db/migrations/0021_worker_foundations.sql` + `db/migrations/__tests__/0021.test.ts` — create.
  `inbound_pos.body_text text NULL` plus CHECK `(body_text IS NULL OR source_kind = 'email_body')`;
  `inbound_pos.extraction_started_at timestamptz NULL`. Re-runnable (IF NOT EXISTS, guarded CHECK).
- `db/schema/inbound.ts` — modify (two columns)
- `lib/ingest/candidates.ts`, `lib/ingest/pipeline.ts`, `db/queries/inbound-pos.ts` — modify. A body
  candidate carries its normalised text; `poRow` writes `body_text`; attachment and refusal rows
  write NULL. The body is stored in full and never truncated (`extractPo` refuses an over-cap
  body loudly, M-05).
- `db/queries/inbound-pos.ts` — modify. The queue list and count include `extraction_failed`
  alongside `pending_review` (PRD: a failed PO appears in the queue, usable as manual entry).
- `lib/storage/po-documents.ts` — create. `uploadPoDocument(path, bytes, contentType)` and
  `downloadPoDocument(path): Promise<Buffer>`. It reads `SUPABASE_SECRET_KEY` and is the only
  file that may; the bucket is pinned to `PO_DOCUMENTS_BUCKET`; uploads use `upsert: true`,
  which closes MEDIUM-06 early.
- `lib/storage/errors.ts` — create. `StorageConfigError`, `PoDocumentStorageError`
- `.env.example` — add `SUPABASE_SECRET_KEY` and `INGEST_TRIGGER_SECRET` with placeholder values

**Acceptance criteria:**
- [x] A body PO staged locally has `body_text` equal to the normalised body; attachment rows have NULL
- [x] The CHECK rejects `body_text` on a `pdf` row (integration test)
- [x] `extraction_failed` rows appear in `listPendingReview` and `countPendingReview`
- [x] Storage module: upload then download round-trips the bytes on the local stack; a second
      upload to the same path succeeds (MEDIUM-06); a missing key throws `StorageConfigError`
- [x] A test asserts that no other source file references `SUPABASE_SECRET_KEY` (CONSTRAINT-38)
- [x] Errors name the path only, never document content (SEC-05)
- [x] Applied locally with `db:migrate-local`; the builder pastes it into prod before Task 104.
      **Never `db:migrate`.**
- [x] CQ-01/02; full suite green; `tsc` and `eslint` clean

**Tests required:** a migration-file test; a body-candidate unit test; queue inclusion (the
compiled SQL lists both statuses); storage happy, missing-key and failure paths (unit, mocked
client) plus an integration round-trip; the CONSTRAINT-38 grep test.

**Depends on:** Task 102 (done).
**Specialist:** @db
**Status:** [x] Done (2026-10-12). Migration 0021 applied locally with `db:migrate-local` and re-run clean (re-runnable); **pasted into prod by the builder 2026-10-12.** `@security` CLEAR (LOW-T103-1 to -3; MEDIUM-06 closes when Task 104 wires `uploadPoDocument`). `body_text` flows candidate → `StagedCandidate` → `poRow`; `InsertInboundPoInput.body_text` is **required** (`string | null`) so no writer can omit it. Queue reads `status IN (pending_review, extraction_failed)` from one constant. `lib/storage/po-documents.ts` builds a fresh session-less client per call (no cached client to outlive a rotated key). CONSTRAINT-38 grep test walks every non-test source file; mutation-checked (a planted reader fails it). Local `.env` gained the local stack's `SUPABASE_SECRET_KEY`. Suite 1784 passed; integration 16/16 incl. the storage round-trip and the CHECK (SQLSTATE 23514); `tsc` and `eslint` clean.

---

## Task 115: Worker core — claim, extract, check, match, persist

**Planned 2026-10-12 (FB-42).** Meets M-04 sign-off conditions 1 and 2 (condition 4 accepted by the
builder: no `worker_thread`) and the L-A logging rule moved here from Task 98.

**Files:**
- `db/queries/extraction-queue.ts` — create:
  - `claimBatch(limit, leaseMs, now)`: one UPDATE with `FOR UPDATE SKIP LOCKED` that sets
    `extracting`, `attempt_count + 1` and `extraction_started_at`. It claims `pending_extraction`
    rows and `extracting` rows whose lease has expired.
  - `completeExtraction(id, extracted, checkResults)` → `pending_review`
  - `failExtraction(id, checkResults)` → `extraction_failed`
  - `releaseForRetry(id)` → `pending_extraction`
- `lib/ingest/worker.ts` — create. `drainExtractionBatch(deps): Promise<BatchSummary>`
- `lib/ingest/worker-errors.ts` — create. `isPermanentExtractionError(error)`
- `lib/ingest/ingest.constants.ts` — add `EXTRACTION_LEASE_MS` (5 minutes; must exceed the route's `maxDuration`)
- `lib/checks/types.ts` — add the `extraction_failed` CheckName

**Behaviour for each claimed row:**
1. `attempt_count` (already incremented) above `MAX_EXTRACTION_ATTEMPTS` → `failExtraction`
   without rendering. This is M-04 condition 2: a row that keeps killing the function ends visible.
2. Load the input: `pdf` / `image` → `downloadPoDocument`; `email_body` → `body_text`
3. `extractPo` → `runChecks` → `matchCustomer` → `completeExtraction`, writing
   `{ ...checks, failures: [...checks.failures, ...customerMatchFailures(match)], customerMatch }`
4. A permanent error (`TextInputTooLongError`, `PdfTooManyPagesError`, `PdfPageTooLargeError`,
   `ExtractionResponseError`) → `failExtraction` immediately. A transient one (HTTP, timeout,
   render timeout, storage, DB) → `releaseForRetry`, until attempts run out and it becomes
   `failExtraction`.
5. The failure entry is `{ check: 'extraction_failed', field: 'document', detail: <error class name> }`
6. One row's failure never stops the batch. `ExtractionConfigError` does stop it, loudly:
   nothing in the batch could succeed.

**Acceptance criteria:**
- [x] Two concurrent `claimBatch` calls never return the same row (integration test)
- [x] The attempt is counted at claim time, before any render (M-04 condition 1)
- [x] Lease: a row stuck at `extracting` past `EXTRACTION_LEASE_MS` is reclaimed; one inside the lease is not
- [x] Each branch above is tested; a planted permanent error ends `extraction_failed` in one run
- [x] Logs carry model, status, page count, duration and row id only. A test asserts that no
      extracted value, quote, body text or `sourceText` reaches `console.*` (L-A, SEC-05)
- [x] `sourceText` is never persisted (MEDIUM-07 precondition), asserted on the written row
- [x] Every number comes from constants; CQ-01/02; full suite green; `tsc` and `eslint` clean

**Tests required:** a happy path and the error case for each function; the integration tests
for claim and lease on the local stack; the worker with injected deps (download, `extractPo`, matcher).

**Depends on:** Task 103.
**Specialist:** @db
**Status:** [x] Done (2026-10-12). `claimBatch` is one UPDATE over a `FOR UPDATE SKIP LOCKED` subselect, counting the attempt and stamping the lease at claim time; it also reclaims a lease-less `extracting` row. Proven against the local stack: a claim skips rows an open transaction holds, without waiting (mutation-checked: dropping SKIP LOCKED hangs it). The worker reads the extraction config **before** claiming, so a missing key costs no row an attempt. `StorageConfigError` also stops the batch (spec named only `ExtractionConfigError`), and both release every unprocessed row before rethrowing. Image MIME type comes from the stored key's extension (no MIME column). New permanent errors: `MissingExtractionInputError` and `ExtractionAttemptsExhaustedError`. A transient error on the last attempt is parked at once, not released. If the failure write itself fails, the row is logged `stranded` and left to the lease. Queue writes log via `loggableFailure` and throw with `parameterFreeCause`, which moved from `customer-match.ts` into `lib/loggable-failure.ts`. `@security` CLEAR. Its two Mediums were fixed in this task: **MEDIUM-09**, where the worker now claims one row at a time and stops claiming after `EXTRACTION_CLAIM_CUTOFF_MS` (30 s), so a killed run spends only the in-flight row's attempt; and **MEDIUM-10**, where `releaseForRetry` stamps the release time and the claim skips that row for `EXTRACTION_RETRY_DELAY_MS` (5 min). `BatchSummary.rowsMayRemain` (false once a claim comes back empty) is Task 116's self-chain signal; Task 116 must chain on it, never on `claimed`. LOW-T115-1 and -2 are open; **Builder decision 2026-10-12:** `PdfRenderError` stays transient (3 tries), because it also wraps environment glitches. `test:integration` now runs files one at a time (`--no-file-parallelism`): the claim is unscoped and took other files' staged rows. Suite 1836 passed; integration 24/24; `tsc` and `eslint` clean.

---

## Task 116: Worker route — secret, after(), self-chain

**Planned 2026-10-12 (FB-42).** Meets M-04 sign-off condition 3 and A-11 (self-chaining).
Task 104 reuses `isAuthorisedTrigger`.

**Files:**
- `app/api/ingest/extract/route.ts` — create. `POST`:
  - a constant-time compare of `Authorization: Bearer <INGEST_TRIGGER_SECRET>`, otherwise 401
  - respond 202, and run the batch in `after()`
  - if rows remain, `fetch` its own origin once (A-11)
  - `export const maxDuration = 60` (M-04 condition 3)
- `lib/ingest/trigger-auth.ts` — create. `isAuthorisedTrigger(request, secret)`
- `next.config.js` — `serverExternalPackages: ['pdfjs-dist', '@napi-rs/canvas']` (A-14)

**Acceptance criteria:**
- [x] A missing or wrong secret → 401 with no DB access; an unset env secret → 500, logged, never "open"
- [x] A valid request → 202 immediately; the batch runs after the response (tested with `after` mocked)
- [x] The self-chain fires only when `drainExtractionBatch` reports rows remaining, and at most once
- [x] No `'use server'`; the secret is never logged (SEC-01/05)
- [x] The `proxy.ts` matcher does not block the route (no session required), tested
- [x] Local end-to-end: stage a PDF and POST the route; the row reaches `pending_review` with
      `extracted` and `check_results.customerMatch`. Manual check in Studio, confirmed by the builder.
- [x] CQ-01/02; full suite green; `tsc` and `eslint` clean

**Tests required:** auth helper (match, mismatch, length mismatch, unset); route 401 / 500 / 202;
self-chain on and off.

**Risks:** A-11 (Vercel may drop the self-fetch; fallback is an external 5-minute cron). Vercel
deployment protection blocks self-fetch on previews only; check at Task 104.

**Depends on:** Task 115.
**Status:** [x] Done (2026-10-12). Builder confirmed the row in Studio; `@security` CLEAR (LOW-T116-1, -2 open). Route answers 202 in ~20 ms; the work runs in `after()` via `lib/ingest/extract-trigger.ts` (`drainAndChain`), which never throws: a batch error is logged through `loggableFailure` and stops the chain. An unset secret makes `isAuthorisedTrigger` throw (→ 500), never open. Compare is `timingSafeEqual` over SHA-256 digests (length-safe). **Builder decision 2026-10-12: `maxDuration = 120`** (was 60): the 30 s claim cutoff plus a 60 s model call did not fit in 60. A test pins cutoff + timeout < maxDuration < lease. Local end-to-end run: a staged PDF reached `pending_review` with `extracted` and `customerMatch`; the logs carry no content. Suite 1858; `tsc`, `eslint` clean.

---

## Task 104: Triggers — daily cron + manual, through one route

**Planned 2026-10-12** (`@create-plan`). Builder decisions: Vercel cron at `0 11 * * *` UTC
(06:00–06:59 CDT, 05:00–05:59 CST; Hobby fires anywhere inside the hour; accepted as a safety
net). **No run lock**: overlapping runs are safe (unique `(uid_validity, uid)`, idempotent
content-addressed uploads, a lower watermark only re-lists already-staged UIDs). The one cost is
a failing UID counted twice, which reaches the 3-run give-up sooner; the 1-hour floor still holds.
Task 105's button disables itself while a run is in flight.

**Shape:** the manual trigger does not run ingestion itself. It POSTs the same route the cron
GETs, so there is one route, one `maxDuration` and one code path. "Last checked" is
`ingest_state.last_run_at` (Task 105 reads it). A failed run leaves it stale, which is the PRD's
"silence ≠ failure" signal.

**Files:**
- `lib/ingest/run-deps.ts` — create. `buildIngestRunDeps()`: production `IngestRunDeps`
  (`createImapSession`, `readGmailImapConfig`, `stageEmailWithPos`, **`uploadPoDocument`** (closes
  MEDIUM-06), `readIngestState` / `writeIngestState`, `stagedUidsAbove`, `recordFailures` /
  `clearFailures` / `clearOtherValidities`, `now: () => new Date()`)
- `lib/ingest/run-trigger.ts` — create. `runAndKick`; never throws (runs in `after()`, same
  contract as `drainAndChain`)
- `app/api/ingest/run/route.ts` — create. `GET` = Vercel cron (`CRON_SECRET`); `POST` = manual
  trigger (`INGEST_TRIGGER_SECRET`). Both use `isAuthorisedTrigger`, answer 202 and run in
  `after()`. `export const maxDuration = 300`. Pokes `new URL('/api/ingest/extract', request.url)`
- `lib/actions/ingest.ts` — create. `'use server'` `triggerIngestion()`
- `vercel.json` — create. `{"crons":[{"path":"/api/ingest/run","schedule":"0 11 * * *"}]}`
- `.env.example` — add `CRON_SECRET` and `INGEST_APP_ORIGIN` (local `http://localhost:3000`)
- `docs/architecture.md` — trigger flow, the no-lock rationale, the cron DST window

**Functions to implement:**
- `buildIngestRunDeps(): IngestRunDeps` — production wiring; a missing env var throws
  `IngestConfigError` at build time
- `runAndKick(extractUrl: string, secret: string, deps?: RunTriggerDeps): Promise<IngestRunSummary | null>`
  — runs `runIngestion`, logs a UIDs-and-counts summary, then POSTs `extractUrl` once with
  `triggerAuthHeaders`. Pokes **even when the run threw**: rows from earlier runs still need draining
- `triggerIngestion(): Promise<{ error: string } | { accepted: true }>` — `assertAuthenticated()`,
  then POST `${INGEST_APP_ORIGIN}/api/ingest/run` with `triggerAuthHeaders(INGEST_TRIGGER_SECRET)`

**Acceptance criteria:**
- [x] Wrong or missing secret → 401; unset secret → 500, logged; valid secret → 202, run in `after()`
- [x] `GET` accepts only `CRON_SECRET`, `POST` only `INGEST_TRIGGER_SECRET`; neither secret opens the other method
- [x] Given unread mail, when the route is called, then `inbound_emails` rows exist, `last_run_at`
      advanced, and `/api/ingest/extract` received one POST
- [x] Given `runIngestion` throws (e.g. IMAP auth failure), then it is logged via `loggableFailure`,
      nothing throws out of `after()`, `last_run_at` is unchanged, and the worker is still poked
- [x] Given no session, `triggerIngestion` returns the generic error and makes no fetch
- [x] Given `INGEST_APP_ORIGIN` or `INGEST_TRIGGER_SECRET` unset, `triggerIngestion` fails loudly
      (logged + error returned), never silently
- [x] SEC-01: no secret logged, echoed or committed. CONSTRAINT-38: `run-deps.ts` imports
      `uploadPoDocument` and never reads `SUPABASE_SECRET_KEY` (existing grep test)
- [x] SEC-05: logs carry UIDs and counts, never message content
- [x] A test pins `maxDuration` ≤ 300 (Hobby + Fluid Compute ceiling)
- [x] `proxy.ts` never redirects `/api/ingest/run` (tested, as for the extract route)
- [x] CQ-01/02: files < 300 lines, functions < 50; full suite green; `tsc` and `eslint` clean

**Tests required:**
- `route.test.ts` → 401 / 500 / 202 per method; no secret crossover; `after()` receives `runAndKick`
- `run-trigger.test.ts` → success: one run, one poke; run throws: logged, still pokes, returns
  `null`; poke throws: logged, no throw
- `run-deps.test.ts` → wiring complete; missing env var → `IngestConfigError`
- `ingest.test.ts` (action) → no session → no fetch; happy path → one POST with bearer header;
  missing env var → loud error
- Integration (local stack) → one synthetic message: route → `inbound_emails` → watermark advanced

**Go-live checklist (builder, Vercel):**
1. Env, Vercel only: `SUPABASE_SECRET_KEY` (Supabase → Settings → API Keys); `INGEST_TRIGGER_SECRET`
   and `CRON_SECRET`, each a separate `openssl rand -hex 32` (settles LOW-T116-2);
   `INGEST_APP_ORIGIN` = the production URL
2. Fluid Compute on (`maxDuration` 120 / 300 requires it on Hobby)
3. A-14: check the PDF renderer on the first preview deploy
4. Check that preview deployment protection does not block the self-chain fetch
5. Move the 4 sample POs from Gmail Spam to INBOX; one real-mail end-to-end check

**Risks:** A-11 (self-fetch dropped; fallback is an external 5-minute cron). Cron window
shifts an hour with DST (accepted). `triggerIngestion` has no button until Task 105.
LOW-T116-1 (chain URL from `request.url`) remains optional.

**Depends on:** Tasks 99, 114, 115, 116.
**Status:** [x] Done (2026-10-12). One route, two callers: `GET` = Vercel cron (`CRON_SECRET`), `POST` = `triggerIngestion` (`INGEST_TRIGGER_SECRET`); `GET` also needs the worker secret (500 without it). `runAndKick` pokes the worker even when the run fails. MEDIUM-06 closed (`uploadPoDocument` wired). Suite 1889 passed; integration 25/25 incl. `run-deps.integration.test.ts` (real queries, fake mailbox); `tsc`, `eslint` clean. **Not done:** live run against the real inbox (go-live checklist); no button until Task 105. `@security` CLEAR (LOW-T104-1 to -3; MEDIUM-06 closed).

---

## Task 105: Show the review queue in the menu — count, last checked, check mail

**Planned 2026-10-12** (`@create-plan`). Builder decisions:
- **One control, merged into the menu button** (deviation from `prd.md`, which puts a dropdown
  on the home, orders and calendar pages). A header pill would collide with existing top-right
  header buttons; the menu button is on every page and needs no layout change. The menu button
  shows the count; opening the drawer shows a "Review queue" panel above the nav links.
- **The count is every ingested PO without a decision**: every status except `approved` and
  `discarded` — skipped, waiting, being read, failed and refused all count. The bubble only
  disappears when every PO is approved or deleted, so nothing skipped or stuck goes silent.
- **Progress is a spinner**, not staged steps. **Count only**, no PO list. **No mockup.**
- The "Review" action is **not** in this task: Task 106 adds it to this panel.

**Files:**
- `db/queries/ingest-failures.ts` — modify. Add `countFailingUids`.
- `db/queries/inbound-pos.ts` — modify. Add `countUndecided`. `countPendingReview` is unchanged
  (it stays the review-queue count Task 106 uses).
- `lib/actions/ingest.ts` — modify. Add `getIngestStatus` (the only new export; SEC-08).
- `lib/ingest/ingest-status.constants.ts` — create. `INGEST_STATUS_POLL_MS` (5 s),
  `INGEST_RUN_WATCH_MS` (5 min, the run route's `maxDuration`), `INGEST_STALE_AFTER_MS` (26 h:
  a daily cron plus its one-hour window), `MAX_BADGE_COUNT` (99). No DB import; safe in the browser.
- `components/shell/useIngestStatus.ts` — create. Loads the status, runs the trigger and polls.
- `components/shell/IngestStatusPanel.tsx` — create. The drawer section.
- `components/shell/PillHamburger.tsx` — modify. Count bubble.
- `components/shell/NavDrawer.tsx` — modify. Mounts the panel above the nav links.
- `components/shell/AppShell.tsx` — modify. Owns `useIngestStatus`, so polling survives the
  drawer closing; passes status to the pill and the drawer.
- `docs/architecture.md`, `docs/design-decisions.md` — modify. Record the menu placement and
  the undecided-count rule.

**Functions to implement:**
- `countUndecided(): Promise<{ toReview: number; beingRead: number }>` — `toReview` counts
  `pending_review` + `extraction_failed`; `beingRead` counts `pending_extraction` + `extracting`.
  One query. Throws `DatabaseError`.
- `countFailingUids(): Promise<number>` — rows in `ingest_uid_failures` (emails that keep
  failing to import). Throws `DatabaseError`.
- `getIngestStatus(): Promise<{ error: string } | IngestStatus>`, where
  `IngestStatus = { toReview: number; beingRead: number; lastRunAt: string | null; failingCount: number }`.
  `assertAuthenticated` first; the three reads run in parallel (`countUndecided`,
  `readIngestState('INBOX')`, `countFailingUids`). On failure returns
  `{ error: GENERIC_FAILURE_MESSAGE }` and logs through `loggableFailure`.
- `useIngestStatus(): { status, loadError, isChecking, refresh, checkMail }`:
  - loads on mount; `refresh` re-runs it when the drawer opens;
  - `checkMail` calls `triggerIngestion`, then polls `getIngestStatus` every
    `INGEST_STATUS_POLL_MS` until `lastRunAt` moves past its value before the click;
  - polling stops after `INGEST_RUN_WATCH_MS`;
  - a second `checkMail` while one is in flight does nothing.
- `IngestStatusPanel` shows:
  - "**N pending** · X to review · Y being read" (N = X + Y), or "Nothing pending" at 0;
  - "Last checked …" in the device's time zone; amber when null ("Never checked") or older
    than `INGEST_STALE_AFTER_MS`;
  - when `failingCount > 0`: "N emails can't be imported. They retry automatically, then
    appear for review.";
  - a "Check mail now" button with a spinner, disabled while a check is in flight.
- `PillHamburger({ onClick, pendingCount, needsAttention })` — a teal count bubble when
  `pendingCount > 0`, capped at "99+"; warning-coloured when `needsAttention` (stale check or
  failing imports).

**Acceptance criteria:**
- [x] Given any ingested PO without a decision, when any page loads, then the menu button shows
      the undecided count; the bubble is hidden only at 0.
- [x] Given a PO is skipped, then the count does not change.
- [x] Given a PO is waiting for or in extraction, then it is counted (under "being read").
- [x] Only approve or delete lowers the count.
- [x] Given the drawer opens, then the panel refreshes and shows the split count and the
      last-checked time.
- [x] Given `last_run_at` is null or older than 26 h, then the last-checked line is amber (PRD:
      silence must be distinguishable from failure).
- [x] Given `ingest_uid_failures` has rows, then the alert shows their count and the bubble
      shows the warning state.
- [x] Given "Check mail now" is tapped, then the button disables and spins until `last_run_at`
      moves, then the count refreshes and a success toast shows.
- [x] Given `last_run_at` has not moved after 5 min, then the spinner stops and an error toast
      says the check did not finish and to look at the last-checked time.
- [x] Given `triggerIngestion` returns `{ error }`, then the spinner stops and an error toast shows (EH-04).
- [x] Given the status load fails, then the panel says "Couldn't load the review queue" with a
      retry, the bubble is hidden, and the rest of the app is unaffected (EH-01).
- [x] Closing the drawer mid-check does not stop polling (state lives in `AppShell`).
- [x] SEC-04: `getIngestStatus` refuses without a session. SEC-08: it is the only new export in
      `lib/actions/ingest.ts`.
- [x] SEC-05: counts and one timestamp only; no email or PO data reaches the client.
- [x] Touch targets ≥ 44 px. Components < 200 lines (CQ-02). No literal timings outside the
      constants file (CQ-04).

**Tests required:**
- `countUndecided` → counts each status in the right group; `approved` and `discarded` excluded;
  skipped rows still counted; throws `DatabaseError` on query failure.
- `countFailingUids` → returns the count; throws `DatabaseError` on query failure.
- `getIngestStatus` → returns the four values; refuses with no session; returns the generic
  error and logs when a query fails.
- `useIngestStatus` (fake timers) → stops polling when `lastRunAt` moves; stops at 5 min with
  the error result; stops on a trigger error; ignores a second `checkMail` while in flight.
- `IngestStatusPanel` → split count; "Nothing pending"; stale amber; failing alert; load-error
  state with retry; button disabled while checking.
- `PillHamburger` → bubble and "99+"; no bubble at 0; warning state.

**Risks:** The badge refreshes on page load, drawer open and after a check — not live while the
06:00 cron runs with the app open (accepted for a daily cron). A failed run leaves
`last_run_at` unchanged, so it surfaces at the 5-minute timeout (the stale-timestamp signal
from Task 104, by design).

**Depends on:** Task 104 (`triggerIngestion`).
**Specialist:** @ui-totetrack
**Status:** [x] Done (2026-10-12). Badge on the menu button + "Review queue" drawer section; `countUndecided` / `countFailingUids` / `getIngestStatus`. Unit 1968 passed, integration 27/27, `tsc`, `eslint`, `next build` clean; SEC-08 manifest checked. **Not done:** browser check; live run (go-live checklist).

---

---

## Task 106: Open the review overlay and show the source — images, email text, refusals

**Planned 2026-10-12** (`@create-plan`). Builder decisions: a **full-screen overlay**, opened
from a "Review" button in the menu's Review queue section (not its own route; a refresh closes
it). PDFs are drawn in the browser with pdf.js, which is **Task 117**; until then a PDF row
shows a holding state with an "Open the file" link. Email text is shown as plain text, never
HTML. A-15 (pdf.js) belongs to Task 117, not this task.

**Files:**
- `db/queries/review-source.ts` — create.
  - `listReviewQueueIds(): Promise<string[]>`: review order (same statuses and `ORDER BY` as
    `listPendingReview`), ids only.
  - `getReviewSourceRow(poId: string): Promise<ReviewSourceRow | null>`: the PO joined to its
    email — `source_kind`, `document_path`, `body_text`, `check_results`, `from_address`,
    `subject`, `received_at`, `message_id`.
- `lib/review/review-source.ts` — create, pure.
  - `ReviewSource` union: `{ kind: 'pdf' | 'image'; url: string }`, `{ kind: 'text'; text: string }`,
    `{ kind: 'refused'; refusal: RefusalDescription; email: ReviewEmail }`.
  - `refusalOf(checkResults: unknown): IngestLimitFailure | null`: the row's `ingest_limit`
    failure, if any. A refused row is `email_body` with NULL `body_text` (`limits.ts`).
  - `describeRefusal(failure): RefusalDescription`: a plain-language title and next step for
    each of the nine `IngestLimitReason`s; `staging_failed` reads "Couldn't be imported. Open it
    in Gmail to recover the PO." (LOW-NEW-3).
  - `gmailSearchUrl(messageId: string | null): string | null`: `rfc822msgid:` search,
    URL-encoded; `null` without an id.
- `lib/actions/review.ts` — create (`'use server'`); exports **only** `getReviewQueue()` and
  `getReviewSource(poId)`. `assertAuthenticated` first; `poId` must be a UUID (SEC-02). PDF and
  image rows get a 1-hour signed URL from the **session** client (the
  `getSupportAttachmentSignedUrl` pattern; no secret key, CONSTRAINT-38).
- `components/review/ReviewOverlay.tsx` — create. Fixed full-screen; left pane = source, right
  pane = neutral placeholder until Task 107. Close button and Esc; focus trapped while open and
  returned to the menu on close (the `useFocusTrap` pattern). Loads the queue on open and
  shows the first row; next/skip are Tasks 108/109.
- `components/review/SourcePane.tsx` — create. Image / text / refusal / PDF-holding / loading /
  error view by kind.
- `components/review/RefusalCard.tsx` — create. Title, next step, sender, subject, received
  time, file type as plain text (LOW-NEW-2), Gmail link (new tab, `rel="noopener noreferrer"`).
- `components/review/ExpandedSource.tsx` — create. Click-to-expand for images and text:
  full-screen view, zoom in/out within bounds, close.
- `components/shell/IngestStatusPanel.tsx`, `components/shell/AppShell.tsx` — modify. "Review"
  button (disabled when `toReview === 0`); `AppShell` owns the overlay's open state and closes
  the drawer when it opens.
- `docs/architecture.md` — modify. Review overlay in the component tree.

**Acceptance criteria:**
- [x] Given at least 1 PO to review, when "Review" is tapped, then the overlay opens on the
      first row in queue order (failed checks, then never-skipped, then oldest).
- [x] An image row shows the image; tapping opens it full screen with zoom.
- [x] An email-body row shows the body as plain text: HTML appears as literal text, never
      rendered as markup.
- [x] A refused row shows the reason card; `staging_failed` says to recover it from Gmail; the
      file type shows as plain text; the Gmail link appears only when there is a message id.
- [x] A PDF row shows "PDF preview arrives with Task 117" plus "Open the file".
- [x] A failed sign or load shows "Couldn't load this document" with a retry (EH-01); the
      overlay stays usable.
- [x] Esc or the close button returns to the page underneath, unchanged.
- [x] "Review" is disabled when nothing is to review.
- [x] SEC-04: both actions refuse without a session. SEC-02: a non-UUID id is refused before any
      query. SEC-08: the build manifest lists only the two new actions.
- [x] SEC-05: signed URLs expire in 1 hour; nothing about a row except its id is logged.
- [x] Touch targets ≥ 44 px; components < 200 lines; functions < 50 lines.

**Tests required:**
- `listReviewQueueIds`, `getReviewSourceRow` → SQL and mapping (unit); the join against the
  local DB (integration).
- `describeRefusal` → one case per reason; an unknown reason is the error case.
- `gmailSearchUrl` → encodes; `null` without an id.
- `getReviewSource` → each kind (pdf/image signed, text, refused); no session; non-UUID;
  not found; sign failure.
- `ReviewOverlay` → opens on the first row; Esc and close; empty and error states.
- `SourcePane` → one test per view. `RefusalCard` → Gmail link present/absent; file type as text.
- `ExpandedSource` → open/close; zoom bounds. `IngestStatusPanel` → "Review" disabled at 0,
  calls `onReview` otherwise.

**Risks:** Each task deploys from `main` as it lands. Prod has no ingested rows yet, so
"Review" stays disabled there until go-live and the half-built overlay is unreachable.

**Depends on:** Task 105.
**Specialist:** @ui-totetrack
**Status:** [x] Done (2026-10-12). Full-screen review overlay from "Review" in the menu; image / plain-text / refusal / PDF-holding source pane; `getReviewQueue` + `getReviewSource`. Unit + integration 29/29, tsc, eslint, next build clean; SEC-08 manifest checked. **Not done:** browser check.

---

## Task 117: Draw PDFs in the review overlay with pdf.js

**Planned 2026-10-12** (`@create-plan`), split from Task 106. Builder decision: draw PDFs in
the browser with pdf.js rather than embedding them (iPad Safari often shows only page 1 of an
embedded PDF). A-15 is the assumption this rests on.

**Files:**
- `components/review/usePdfPages.ts` — create. Loads pdf.js on demand (dynamic import, so the
  main bundle does not grow); opens the signed URL with `isEvalSupported: false`; draws each
  page to a canvas at device pixel ratio, up to `MAX_PDF_PAGES` (5); destroys the document on
  unmount.
- `components/review/PdfPages.tsx` — create. Scrolling pages; tap to expand into `ExpandedSource`.
- `components/review/SourcePane.tsx` — modify. Replaces the PDF holding state.
- Worker: `pdfjs-dist/build/pdf.worker.min.mjs` via `new URL(…, import.meta.url)`, served by
  the app, never from a CDN.

**Acceptance criteria:**
- [x] Every page of a PDF of up to 5 pages scrolls in the left pane; tap opens it full screen
      with zoom.
- [x] More than 5 pages shows the first 5, "Only the first 5 pages are shown", and "Open the file".
- [x] A PDF that fails to load or draw shows "Couldn't display this PDF" plus "Open the file"
      (the A-15 fallback), never a blank pane.
- [x] pdf.js loads only when a PDF row is shown; the main bundle does not grow.
- [x] Nothing is fetched from outside the app and Supabase (no CDN worker, no remote fonts).
- [x] Closing the overlay destroys the document (no leaked worker).
- [~] Verified on the real iPad before marking done. **Deferred by the builder (2026-10-12):** no iPad to hand; the salesperson tests the whole feature at the end. Moved to the go-live checklist. If it fails there, A-15's fallback becomes
      the PDF view and the builder is told.

**Tests required:**
- `usePdfPages` (pdf.js mocked) → draws N pages; caps at 5 with the notice; a load failure sets
  the error state; unmount destroys the document.
- `PdfPages` → renders the canvases; tap opens the expanded view.

**Depends on:** Task 106.
**Specialist:** @ui-totetrack
**Status:** [x] Done (2026-10-12). PDFs drawn page by page with pdf.js (legacy build, app-served worker, lazy chunk); 5-page cap with notice; "Couldn't display this PDF" fallback; tap to full screen with zoom. Verified in desktop Chrome on a 1-page and a 7-page PDF. **iPad check deferred** to the go-live checklist. Spec's `isEvalSupported: false` dropped: pdf.js 6 removed the option.

---

## Task 107: Load the review fields: map the extraction to order-form values

**Planned 2026-10-12** (`@create-plan`). Builder decisions: Task 107 split into data (this
task) and UI (Task 118); the right pane reuses the order form's value shape
(`OrderFormValues`) so Task 108 saves through `createOrder`; the Brenntag rule (below).

**Files:**
- `lib/review/review-fields.ts` — create. Pure: no DB, no storage.
- `lib/review/review-fields.wording.ts` — create. Plain-language flag text per `CheckName`, a
  `Record<CheckName, …>` so a new check fails `tsc` (same pattern as `REFUSAL_WORDING`).
- `lib/review/errors.ts` — modify if a new failure mode needs a named class (EH-05).
- `db/queries/review-source.ts` — modify. `getReviewSourceRow` also returns `extracted` and
  `check_results`; new `getCustomersForReview(ids: string[])` returns those customers, **inactive
  included**, as `CustomerSelectOption` plus `status` (the matcher lists inactive customers;
  `getActiveCustomersForSelect` does not).
- `lib/actions/review.ts` — modify. Add `getReviewFields`.
- `lib/matching/match-customer.ts` — modify. The Brenntag rule.

**Functions to implement:**
- `reviewFieldsOf(row: ReviewSourceRow, customers: ReviewCustomer[]): ReviewFields` — `ReviewFields` is
  `{ values: OrderFormValues; flags: FieldFlag[]; quotes: FieldQuote[]; poNumberOptions: LabelledOption[];
  deliveryDateOptions: LabelledOption[]; customerChoices: CustomerChoice[]; totals: ReviewTotals }`.
  `FieldFlag` = `{ field: keyof OrderFormValues | 'general'; check: CheckName; message: string }`;
  `FieldQuote` = `{ field; quote: string; status: QuoteStatus }`; `CustomerChoice` = `{ customerId;
  companyName; status; addressMatched }`; `ReviewTotals` = `{ stated: number | null; computed: number;
  otherLines: { quote: string; amount: number | null }[] }`.
- `getReviewFields(poId: string): Promise<{ fields: ReviewFields } | { error: string }>` — session
  check, UUID check, row read, candidate customers read, `reviewFieldsOf`. Same shape and error
  handling as `getReviewSource`.

**Acceptance criteria:**
- [x] **PO number** is pre-filled only when exactly one non-empty candidate exists. Otherwise
      every non-empty candidate is a `poNumberOptions` entry with its label, none pre-selected.
- [x] **Delivery date** is pre-filled only when exactly one `role: 'delivery'` date exists and no
      `ambiguous_date` failure points at it. Otherwise the delivery (then other) dates are
      `deliveryDateOptions` with labels, none pre-selected. Blank, never today, when there is none.
- [x] **Customer** is pre-filled only from `customerMatch.prefillCustomerId`, and only if that
      customer still exists. A candidate that no longer exists is dropped from `customerChoices`
      and adds a "matched customer no longer exists" flag. Choices keep the matcher's rank.
- [x] **Quantities and unit prices** come from `toOrderQuantities`. A `conflicts` type gets a blank
      unit price and a flag; a quantity over `MAX_LINE_QUANTITY` or ≤ 0, or a unit price over
      `MAX_UNIT_PRICE` or < 0, is left blank (0 / null) and flagged (L-D). Unit prices are emitted
      as strings, as `QtyGrid` expects.
- [x] **Delivery address** is the ship-to text as a typed address (`delivery_address_id: null`).
      None on the PO → blank plus the `missing_ship_to` flag.
- [x] `customer_collects`, `backhaul` and `notes` keep `EMPTY_FORM_VALUES` defaults (never extracted).
- [x] **Every `check_results.failures` entry** becomes a `FieldFlag` on the field it concerns
      (`field` path mapped to a form key, else `general`), with wording from the `Record`.
      `ingest_limit` entries are left to the refusal card (Task 106).
- [x] **Quotes**: one `FieldQuote` per `check_results.quotes` entry, text from `extracted`, capped
      at `MAX_QUOTE_CHARS` with "…", plain string only.
- [x] **Totals**: `computed` = `toOrderQuantities(...).price`; `stated` from `statedTotal`;
      `otherLines` = the `kind: 'other'` lines.
- [x] **No usable extraction** (`extracted` null: failed, refused, or not yet read) → every value
      empty, no options, flags from `check_results` only. The pane works as a manual-entry screen.
- [x] **Stored `extracted` fails `extractedPoSchema.safeParse`** → treated as no extraction plus a
      `general` flag "This PO's reading is unreadable; enter it by hand". Logged with the PO id
      only. Never a throw to the UI.
- [x] **Brenntag rule:** `matchCustomer` does not pre-fill a single exact-name match when a
      **different** candidate has `addressMatched` and the exact-name customer does not. Both stay
      ranked; `customerMatchFailures` emits `ambiguous_customer` with a detail saying the name and
      the ship-to point at different customers. Unit and integration tests updated. Rows already
      matched keep their stored result.
- [x] `getReviewFields` logs no customer text (SEC-05); a DB failure returns `{ error }` and logs
      with the PO id; the server-action manifest lists only the three review actions (SEC-08).
- [x] CQ-01/02, no magic numbers, `tsc` and `eslint` clean, full suite green.

**Tests required:**
- `reviewFieldsOf` → full happy path; one vs several PO numbers; one vs several vs ambiguous
  delivery dates; prefill vs deleted customer; price conflict; out-of-bounds quantity; missing
  ship-to; null extraction; schema-invalid extraction; quote cap; every `CheckName` has wording.
- `matchCustomer` → Brenntag case does not pre-fill; exact match that also matches the address
  still pre-fills.
- `getReviewFields` → unauthenticated, bad UUID, DB error.
- `getCustomersForReview` (integration) → inactive customer returned with its addresses.

**Depends on:** Task 106.
**Specialist:** @db
**Status:** [x] Done (2026-10-12). `reviewFieldsOf` (types, check-results reader, values, wording in separate modules), `getCustomersForReview`, `getReviewFields` (returns `{ fields, customers }`: customers = every active one plus inactive candidates, for Task 118's picker), Brenntag rule via `prefillWithheld`. Unit 2078, integration 30/30, tsc, eslint, next build clean. The rule lives in `matchCustomer` above the query, so the matcher's integration test needed no change.
