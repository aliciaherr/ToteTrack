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
