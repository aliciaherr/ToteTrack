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

## Task 118: Build the review overlay's right pane

**Planned 2026-10-12** (`@create-plan`), split from Task 107. Builder decisions: reuse the order
form's parts; quotes are labelled under each field and highlighted in email-body text only.

**Files:**
- `components/review/ReviewFieldsPane.tsx` — create. The right pane: flags summary, then PO
  number, customer, address, quantities and prices, delivery date, logistics, totals.
- `components/review/useReviewForm.ts` — create. `useForm<OrderFormValues>` with
  `defaultValues = fields.values`; resets when the row changes.
- `components/review/CustomerChoices.tsx` — create. Ranked one-tap list (labels: "Inactive",
  "Ship-to matches"), plus "Choose another customer…" revealing the full customer select.
- `components/review/OptionChips.tsx` — create. Labelled one-tap options (PO numbers, dates),
  none selected at start; a tap fills the field.
- `components/review/FieldQuote.tsx` — create. The quote and its status under a field.
- `components/review/ReviewFlags.tsx` — create. Summary at the top; per-field flags inline.
- `components/review/useReviewQueue.ts` — modify. Loads `getReviewFields` in parallel with the
  source; its own loading / error / retry state.
- `components/review/ReviewOverlay.tsx` — modify. Mounts the pane; owns `highlightedQuote`.
- `components/review/SourcePane.tsx` — modify. The text view takes `highlight: string | null`.
- `components/orders/*` — modify only if a part needs a prop to fit; backwards compatible.

**Acceptance criteria:**
- [ ] Reuses `OrderContainerFields`, `AddressSelect` and `OrderLogisticsFields` on the review form.
      New Order and Edit Order behave exactly as before (their tests pass unchanged).
- [ ] Pre-filled values show in their fields; options start unselected; a tap on an option fills
      its field; a customer tap sets `customer_id` and loads that customer's saved addresses.
- [ ] A `missing_ship_to` flag offers the selected customer's saved address as a one-tap fill.
- [ ] Every flag shows beside its field, and the summary lists them, failures first.
- [ ] Each quote shows under its field as plain text, labelled **"Found in document text"**,
      **"Not found in document"** (destructive colour) or **"Can't check (scan or photo)"**
      (LOW-NEW-5).
- [ ] On an email-body PO, tapping a quote highlights its first case-insensitive match in the left
      pane with `<mark>` (built by splitting the text, never HTML) and scrolls it into view. No
      match → no highlight, no error. PDFs and images: label only.
- [ ] Totals: the live computed price beside the document's stated total; on a mismatch, both
      plus the other money lines, with the `total_mismatch` flag.
- [ ] No Approve / Skip / Delete (Task 108). Edits are lost on close.
- [ ] Panes side by side at iPad landscape width, stacked below it; 44 px touch targets; no
      hover-only interactions; light theme tokens only.
- [ ] Fields load error shows "Couldn't load this PO's values" with Retry (EH-01), never blank.
- [ ] Component files < 200 lines, functions < 50 (CQ-01/02); `tsc`, `eslint`, full suite green.
- [ ] Viewed in a browser on seeded local rows (body text, PDF, image, failed extraction) by
      the builder.

**Tests required:**
- `ReviewFieldsPane` → values rendered; flags beside fields; loading and error with retry.
- `OptionChips` → none selected; tap fills the field.
- `CustomerChoices` → ranked labels; tap sets the customer; "Choose another" shows the select.
- `FieldQuote` → each status label; quote rendered as text, not markup.
- `SourcePane` text view → highlight wraps the match in `<mark>`; no match leaves text unchanged.

**Depends on:** Task 107.
**Specialist:** @ui-totetrack
**Status:** [ ]
