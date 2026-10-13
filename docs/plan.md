# Plan: ToteTrack — open tasks

> **Only open tasks live here.** Each one is one-shot-ready: it can be built without asking
> clarifying questions. When a task is done, its block moves to `docs/plan-archive/`.
> One line per task, for every task ever planned: `docs/roadmap.md`. Unplanned work: `docs/backlog.md`.

---

# Feature 16 — Email PO Ingestion

**Source:** `docs/prd.md` → Feature 16. Decisions: `docs/architecture.md` (the Feature 16
sections) and CONSTRAINT-30 to -40. The feature preamble and finished tasks 94–106 / 114–116 are
in `docs/plan-archive/feature-16.md`. Tasks 111–113 run only after the core is in real use.

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
