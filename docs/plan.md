# Plan: ToteTrack — open tasks

> **Only open tasks live here.** Each one is one-shot-ready: it can be built without asking
> clarifying questions. When a task is done, its block moves to `docs/plan-archive/`.
> One line per task, for every task ever planned: `docs/roadmap.md`. Unplanned work: `docs/backlog.md`.

---

# Feature 16 — Email PO Ingestion

**Source:** `docs/prd.md` → Feature 16. Decisions: `docs/architecture.md` (the Feature 16
sections) and CONSTRAINT-30 to -40. The feature preamble and finished tasks 94–105 / 114–116 are
in `docs/plan-archive/feature-16.md`. Tasks 111–113 run only after the core is in real use.

---

## Task 106: Open the review overlay and show the source — images, email text, refusals

**Planned 2026-10-12** (`@create-plan`). Builder decisions: a **full-screen overlay**, opened
from a "Review" button in the menu's Review queue section (not its own route; a refresh closes
it). PDFs are drawn in the browser with pdf.js, which is **Task 117**; until then a PDF row
shows a holding state with an "Open the file" link. Email text is shown as plain text, never
HTML. Depends on A-15 (Task 117).

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
- [ ] Given at least 1 PO to review, when "Review" is tapped, then the overlay opens on the
      first row in queue order (failed checks, then never-skipped, then oldest).
- [ ] An image row shows the image; tapping opens it full screen with zoom.
- [ ] An email-body row shows the body as plain text: HTML appears as literal text, never
      rendered as markup.
- [ ] A refused row shows the reason card; `staging_failed` says to recover it from Gmail; the
      file type shows as plain text; the Gmail link appears only when there is a message id.
- [ ] A PDF row shows "PDF preview arrives with Task 117" plus "Open the file".
- [ ] A failed sign or load shows "Couldn't load this document" with a retry (EH-01); the
      overlay stays usable.
- [ ] Esc or the close button returns to the page underneath, unchanged.
- [ ] "Review" is disabled when nothing is to review.
- [ ] SEC-04: both actions refuse without a session. SEC-02: a non-UUID id is refused before any
      query. SEC-08: the build manifest lists only the two new actions.
- [ ] SEC-05: signed URLs expire in 1 hour; nothing about a row except its id is logged.
- [ ] Touch targets ≥ 44 px; components < 200 lines; functions < 50 lines.

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
**Status:** [ ]

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
- [ ] Every page of a PDF of up to 5 pages scrolls in the left pane; tap opens it full screen
      with zoom.
- [ ] More than 5 pages shows the first 5, "Only the first 5 pages are shown", and "Open the file".
- [ ] A PDF that fails to load or draw shows "Couldn't display this PDF" plus "Open the file"
      (the A-15 fallback), never a blank pane.
- [ ] pdf.js loads only when a PDF row is shown; the main bundle does not grow.
- [ ] Nothing is fetched from outside the app and Supabase (no CDN worker, no remote fonts).
- [ ] Closing the overlay destroys the document (no leaked worker).
- [ ] Verified on the real iPad before marking done. If it fails there, A-15's fallback becomes
      the PDF view and the builder is told.

**Tests required:**
- `usePdfPages` (pdf.js mocked) → draws N pages; caps at 5 with the notice; a load failure sets
  the error state; unmount destroys the document.
- `PdfPages` → renders the canvases; tap opens the expanded view.

**Depends on:** Task 106.
**Specialist:** @ui-totetrack
**Status:** [ ]
