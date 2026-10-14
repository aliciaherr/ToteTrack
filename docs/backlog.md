# Backlog: ToteTrack

> **Known work that is not a planned task yet.** When an item is planned it becomes a task in
> `docs/plan.md` and a line in `docs/roadmap.md`, and is removed from here. When it is done
> or dropped, it is removed with a session-log note.
> Security findings are listed by ID only: their details stay in the gitignored
> `docs/security-report.md` (SEC-07).

---

## Decisions owed (builder)

- None.

## Verifications owed

- **Flaky integration run (2026-10-13):** `lib/ingest/__tests__/run-deps.integration.test.ts` failed once
  while another integration run was likely using the same local DB; two reruns passed 39/39. If it
  recurs alone, investigate shared-row interference.

- **Task 106 in a browser:** stage a few POs locally (image, body text, a refusal, a PDF), open
  "Review", and check the layout, zoom, Esc and focus on the iPad width.

- **A-14:** the first deploy renders a PDF in a Vercel function (go-live checklist, `roadmap.md`).
- **A-15 and Task 106 on the iPad:** on the Feature 16 go-live checklist (`roadmap.md`); builder tests at the end.
- **`@security` on Task 114 (HIGH-02R):** the plan recorded a re-run as owed, and the report
  that would show it was overwritten by later audits. Confirm it was covered, or run it.

## Code

- **GO-LIVE BLOCKERS: false alarms from the new checks** (fix-review re-check, 2026-10-14):
  - `lib/checks/quotes.ts` boundedAt: `render-pdf.ts` joins text items with `''`, so adjacent
    cells run together ("330"+"23.64" → "33023.64", "1"+"330" → "1330") and genuine quotes now
    fail. Check real PO text layers; prefer joining items with a separator over more exceptions.
  - `lib/checks/dates.ts`: `leadingParts` reads only the first date in a quote; a quote with two
    dates (order + ship, or a range) raises `date_order_mismatch`. Pass if any date matches.
  - `lib/checks/value-in-quote.ts` writtenMatch requires a 4-digit year ("05-MAR-26",
    "Mar 5, '26" fail). Accept 2-digit years.
  - Nit: a line with no quantity is flagged "Quantity looks wrong"; give it its own wording.

- **`useFocusTrap` / `useEscapeClose` live in `components/calendar/productionCardDialogHooks.ts`**
  but the review overlay now imports them too (Task 106). Move them to a shared hooks file.

- **Safe error logging app-wide.** `db/queries/*` still log the raw drizzle `cause`, which can
  carry query params. Adopt `loggableFailure` / `parameterFreeCause` everywhere, as one task.
- **Unique-violation check misses drizzle's wrapping in `createInvoice`:** `lib/actions/invoices.ts`
  (~line 216) checks `code` on the top-level error only, so an invoice-number collision is reported
  as a generic failure. Orders were fixed in Task 108 (`isUniqueViolation` in `orders.create.ts`
  checks `.cause` too); reuse it or copy the two-layer check.

- **Review-flow tidy-ups (`@code-review` 2026-10-14, deferred nits):**
  - one shared loading / error-with-Retry pane view (SourcePane, ReviewFieldsPane, ReviewOverlay,
    PdfPages); one `useEscapeCapture` (DeleteReviewDialog, ExpandedSource); a generic mount-guarded
    loader hook (useReviewQueue, useIngestStatus, useOrderDocumentUrl);
  - `'Invalid PO id.'` defined in both `lib/actions/review.ts` and `review-decisions.ts`;
    shared `toCount` (inbound-pos, ingest-failures); one exported `Tx` type (declared 8 times);
  - `review-fields.ts` uses `in REVIEW_FLAG_WORDING` → `Object.hasOwn`;
    `ReviewSourceShapeError` prefix says `reviewSourceOf:`; stale test name
    "orders failed checks first" (`review-source.integration.test.ts`);
  - JSDoc: `parseAddresses`, `RawCustomerSelectRow`, `storedCheckResultsOf` summary, AppShell's
    doc block sits on `useReviewOverlayState`, `CheckMailButton`, `LoadError`;
  - `RefusalCard` uses raw `text-amber-600`; `ReviewFieldsPane` calls `watch('customer_id')`
    beside `useWatch`; "Fix these before approving" list stays until the next Approve;
    focus drops to body after Delete; ingest status reads can land out of order;
  - layering: `lib/review/review-fields.values.ts` imports `components/orders/orderFormSchema`.
  - `SourcePane`'s expanded flag is not reset when the source changes (unreachable today: the
    enlarged view covers the decision buttons).

- **Feature 16 `@code-review` (2026-10-14), deferred:**
  - **For Task 110 (docs):** `architecture.md` ~486 shows the claim as `WHERE id IN (… SKIP LOCKED)`
    (the shape CONSTRAINT-40 forbids) and ~520/526 name the deleted `countPendingReview` /
    `listPendingReview`; `data-model.md` has no Feature 16 tables, enums, 0020 functions or 0021
    CHECK; the no-run-lock overlap costs should list duplicate-flag misses and double-counted UID
    failures. Also record the fix batch: worker writes fenced to their claim (`LostClaimError`,
    `lost` outcome); a UID failing on a live IMAP connection is a counted failed UID, not a run
    abort; the IMAP timeouts (30/15/60 s); `toOrderQuantities` in `lib/extraction/quantities.ts`;
    new checks `value_not_in_quote` and `date_order_mismatch`.
  - Needs a prod migration: CHECK `(source_kind = 'email_body') = (document_path IS NULL)`; add
    the 0021 CHECK to `db/schema/inbound.ts` so drizzle-kit never drops it.
  - `ingest-state` upsert can move `last_uid` / `last_run_at` backwards under overlapping runs
    (use GREATEST); `proxy.ts` matcher still runs Supabase auth on `/api/ingest/*`;
    `releaseForRetry` uses DB `now()` while the claim uses the app clock;
    `supabase/config.toml` `enable_signup = true` locally.
  - `pipeline.ts` spreads `loggableFailure` instead of nesting under `failure:`;
    `migrate-local.ts` "newly applied" count; `verifyQuote` duplicates `checkQuotes`' guards.
  - Review: Enlarge race when two pages are
    tapped quickly (no "Preparing page…" state); lightbox uses raw `bg-black/90` / `text-white`;
    two panes on a 12.9" iPad in portrait (`lg` = 1024px); focus drops to body after Approve and
    Skip too (widen the Delete item).
  - Quote checks allow an amount ending in 2-digit cents to touch a following digit (PDF text
    layers run table cells together), so "$7,800.00" + "330" is accepted as a boundary.
  - An email body containing the fence markers is sent unescaped (escaping would break quote
    matching against the raw body).
  - Review's "Open the file" link re-signs on wake only, not on a timer like the order page.
  - No `--warning` colour token; the attention badge uses Tailwind `amber-700`.
  - `lib/ingest/types.ts` is 316 lines (types only, over the 300 cap): split it.
  - IMAP: a throw from `connect()` itself does no explicit cleanup.

## Operations

- **pdfjs build warning (Task 117):** `next build` warns "Package pdfjs-dist can't be external" for the worker URL in `components/review/pdfjsClient.ts` (the server pass matches `serverExternalPackages`). Harmless at runtime (the worker is only created in the browser; verified in Chrome). Check the first Vercel preview renders a PDF in Review; if the warning matters, give the client a non-external path.

- **Vercel `DATABASE_URL`** is flagged "needs attention" (not marked Sensitive). Save the value
  first, then re-add it as Sensitive.
- **Delete `docs/customers-export.csv`** (real customer data, gitignored) once it is no longer needed.

## Open security Lows (details in `docs/security-report.md`)

- LOW-T108-1.
- LOW-T104-3: Vercel config; covered by the go-live checklist.
- LOW-T116-2: no minimum secret length; settled by the 64-hex go-live secrets.
- LOW-T115-1, LOW-T115-2: accepted.
- LOW-T103-1 to -3.
- LOW-NEW-1 to -6: the review UI. NEW-1/-4 (stuck-import alert) shipped in Task 105; NEW-2/-3
  are in Task 106; NEW-5 closed in Task 119 (quotes no longer shown; scan/photo POs carry a "wording couldn't be checked" line).

## Deferred by decision (2026-10-12 `@code-review`)

- Retry empty or non-JSON model replies instead of parking the row at once (today
  `ExtractionResponseError` is permanent).
- Log message-free stack traces (EH-03) alongside `loggableFailure`'s class names.
