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
- [ ] **PO number** is pre-filled only when exactly one non-empty candidate exists. Otherwise
      every non-empty candidate is a `poNumberOptions` entry with its label, none pre-selected.
- [ ] **Delivery date** is pre-filled only when exactly one `role: 'delivery'` date exists and no
      `ambiguous_date` failure points at it. Otherwise the delivery (then other) dates are
      `deliveryDateOptions` with labels, none pre-selected. Blank, never today, when there is none.
- [ ] **Customer** is pre-filled only from `customerMatch.prefillCustomerId`, and only if that
      customer still exists. A candidate that no longer exists is dropped from `customerChoices`
      and adds a "matched customer no longer exists" flag. Choices keep the matcher's rank.
- [ ] **Quantities and unit prices** come from `toOrderQuantities`. A `conflicts` type gets a blank
      unit price and a flag; a quantity over `MAX_LINE_QUANTITY` or ≤ 0, or a unit price over
      `MAX_UNIT_PRICE` or < 0, is left blank (0 / null) and flagged (L-D). Unit prices are emitted
      as strings, as `QtyGrid` expects.
- [ ] **Delivery address** is the ship-to text as a typed address (`delivery_address_id: null`).
      None on the PO → blank plus the `missing_ship_to` flag.
- [ ] `customer_collects`, `backhaul` and `notes` keep `EMPTY_FORM_VALUES` defaults (never extracted).
- [ ] **Every `check_results.failures` entry** becomes a `FieldFlag` on the field it concerns
      (`field` path mapped to a form key, else `general`), with wording from the `Record`.
      `ingest_limit` entries are left to the refusal card (Task 106).
- [ ] **Quotes**: one `FieldQuote` per `check_results.quotes` entry, text from `extracted`, capped
      at `MAX_QUOTE_CHARS` with "…", plain string only.
- [ ] **Totals**: `computed` = `toOrderQuantities(...).price`; `stated` from `statedTotal`;
      `otherLines` = the `kind: 'other'` lines.
- [ ] **No usable extraction** (`extracted` null: failed, refused, or not yet read) → every value
      empty, no options, flags from `check_results` only. The pane works as a manual-entry screen.
- [ ] **Stored `extracted` fails `extractedPoSchema.safeParse`** → treated as no extraction plus a
      `general` flag "This PO's reading is unreadable; enter it by hand". Logged with the PO id
      only. Never a throw to the UI.
- [ ] **Brenntag rule:** `matchCustomer` does not pre-fill a single exact-name match when a
      **different** candidate has `addressMatched` and the exact-name customer does not. Both stay
      ranked; `customerMatchFailures` emits `ambiguous_customer` with a detail saying the name and
      the ship-to point at different customers. Unit and integration tests updated. Rows already
      matched keep their stored result.
- [ ] `getReviewFields` logs no customer text (SEC-05); a DB failure returns `{ error }` and logs
      with the PO id; the server-action manifest lists only the three review actions (SEC-08).
- [ ] CQ-01/02, no magic numbers, `tsc` and `eslint` clean, full suite green.

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
**Status:** [ ]

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
