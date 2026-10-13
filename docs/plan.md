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

## Task 108: Approve, Skip and Delete a review PO (server)

**Planned 2026-10-13** (`@create-plan`). Builder decisions: approving to an inactive customer
**reactivates** it (1a); approve links the source document, viewing it is Task 121; Task 109
is folded into Task 120; Delete is a soft `discarded`, confirmed in-app (Task 120); a PO whose
document hash repeats an earlier one shows a "To check" line.

**Files:**
- `lib/actions/orders.create.ts` — create (no `'use server'`, SEC-08). Moves `createOrder`'s
  shared pieces out of `orders.ts`: `insertOrderRow(executor, data, extra)`, the address
  ownership pre-check, the after-insert MRU bookkeeping + revalidation, `isUniqueViolation`,
  `DUPLICATE_PO_MESSAGE`. `createOrder` calls them; its behaviour and tests stay unchanged.
- `lib/actions/orders.ts` — modify. `createOrder` uses the moved pieces.
- `db/queries/review-decisions.ts` — create. Row lock and the three status writes.
- `lib/actions/review-decisions.ts` — create (`'use server'`). The three actions.
- `lib/review/review-fields.types.ts`, `review-fields.wording.ts`, `review-fields.ts` — modify.
  `duplicate_document` review flag (field `general`) when the row has a `duplicate_of_id`.
- `db/queries/review-source.ts` — modify. `ReviewSourceRow` gains `duplicate_of_id`.

**Functions to implement:**
- `lockReviewRow(tx, poId: string): Promise<{ documentPath: string | null } | null>` —
  `SELECT … FOR UPDATE` of a row still in the review queue (`pending_review` /
  `extraction_failed`); `null` when it is not (already decided, or gone).
- `markApproved(tx, poId: string, orderId: string, confirmed: CreateOrderInput): Promise<void>`
  — `status = 'approved'`, `order_id`, `confirmed` (exactly what was submitted).
- `reactivateCustomer(tx, customerId: string): Promise<boolean>` — `status = 'active'` where
  inactive; `true` when it changed a row.
- `markSkipped(poId: string): Promise<boolean>` / `markDiscarded(poId: string): Promise<boolean>`
  — guarded by the queue statuses; `false` when the row was already decided.
- `approveReviewPo(poId: string, input: CreateOrderInput): Promise<{ orderId: string; reactivated: boolean } | { error: string }>`
- `skipReviewPo(poId: string): Promise<{ success: true } | { error: string }>`
- `discardReviewPo(poId: string): Promise<{ success: true } | { error: string }>`

**Acceptance criteria:**
- [ ] Approve validates with `createOrderInputSchema` and the address ownership check exactly
      as `createOrder` does (SEC-02, SEC-03), then in **one transaction**: locks the PO row,
      inserts the order with `document_url` = the row's `document_path` (null for email body),
      reactivates an inactive customer, and marks the PO approved with `order_id` and
      `confirmed`. Any failure rolls all of it back.
- [ ] A PO number that already exists returns "PO number already exists." and leaves the PO in
      the queue, unchanged.
- [ ] Approve, Skip or Delete on a PO no longer in the queue returns "This PO was already
      handled." and changes nothing; two approvals of one PO create one order.
- [ ] Skip stamps `skipped_at = now()`; the PO stays counted and goes to the back of the queue.
- [ ] Delete sets `status = 'discarded'`; the row and its file are kept; the count drops.
- [ ] After an approve: MRU address bookkeeping and the order-screen revalidation run as in
      `createOrder` (outside the transaction, failures contained as there).
- [ ] A row with `duplicate_of_id` gets the flag "Same document as a PO already received".
- [ ] Each action: auth checked first (SEC-04), `poId` refused unless a UUID (SEC-02), only
      the PO id logged (SEC-05), failures logged with context and returned as the generic
      message (EH-01/02).
- [ ] `createOrder`'s tests pass unchanged. Files < 300 lines, functions < 50 (CQ-01/02);
      `tsc`, `eslint`, unit and integration suites green.

**Tests required:**
- `approveReviewPo` (integration, local stack) → order created with `document_url`, PO approved
  with `order_id` and `confirmed`; inactive customer reactivated; duplicate PO number → error,
  PO still pending, no order; second approve → "already handled", one order; a failure after
  the insert rolls the order back.
- `approveReviewPo` (unit) → bad id, no session, invalid input, forged address id refused.
- `skipReviewPo` / `discardReviewPo` → happy path; already decided; bad id; no session.
- `reviewFieldsOf` → `duplicate_document` raised with `duplicate_of_id`, not without.

**Depends on:** Task 119.
**Specialist:** @db
**Status:** [ ]

---

## Task 120: Add Approve, Skip and Delete to the review pane and move through the queue

**Planned 2026-10-13** (`@create-plan`). Supersedes Task 109 (auto-advance and "all caught
up"), folded in so the queue never dead-ends after one PO.

**Files:**
- `components/review/ReviewActions.tsx` — create. Approve (primary), Skip, Delete at the foot
  of the right pane; busy state; the action's error message.
- `components/review/DeleteReviewDialog.tsx` — create. In-app confirm: "Delete this PO? It
  won't become an order." (no browser `confirm()`).
- `components/review/useReviewDecisions.ts` — create. Runs the three actions; on success asks
  the queue to load the next PO; toasts "Order created." / "Skipped." / "Deleted.".
- `components/review/reviewApproval.ts` — create. Client checks before Approve.
- `components/review/useReviewQueue.ts` — modify. `advance()` reloads the queue and loads its
  first PO; tracks the position.
- `components/review/ReviewOverlay.tsx` — modify. Header "1 of N" from the reloaded queue;
  empty queue → "You are all caught up."
- `components/review/ReviewFieldsPane.tsx`, `ToCheckSection.tsx` — modify. Mount the actions;
  the inactive-customer line.
- `components/shell/AppShell.tsx` — modify. Refresh the ingest status when Review closes.

**Functions to implement:**
- `approvalProblems(values: OrderFormValues): string[]` — what blocks Approve: no PO number,
  no customer, no address unless the customer collects, no quantity, a quantity without a unit
  price (reusing `totalQuantity` / `firstUnitPriceCouplingError`).

**Acceptance criteria:**
- [ ] Approve with problems shows them in one alert above the buttons and sends nothing.
- [ ] Approve sends `formValuesToCreateInput(values)` to `approveReviewPo`; on success the
      next PO loads and "Order created." is toasted.
- [ ] Skip and Delete call their actions; Delete only after the in-app confirm; each then loads
      the next PO.
- [ ] An `{ error }` result shows inline above the buttons and keeps the edits; "already
      handled" reloads the queue instead. A transport failure shows the generic message (EH-01).
- [ ] Buttons are disabled while an action runs, so one tap = one action.
- [ ] The header shows the position ("1 of 5"); when the queue empties, "You are all caught up."
- [ ] With an inactive customer selected, "To check" adds "<name> is inactive: approving
      reactivates it".
- [ ] Closing Review refreshes the menu badge.
- [ ] 44 px targets, light tokens only, components < 200 lines (CQ-02); `tsc`, `eslint`, full
      suite and `next build` green.
- [ ] Builder walks the four local rows through Approve, Skip and Delete in a browser.

**Tests required:**
- `approvalProblems` → each missing field reported; a complete form passes.
- `ReviewActions` → problems block Approve; success advances; error kept inline; buttons
  disabled while busy.
- `DeleteReviewDialog` → cancel does nothing; confirm deletes.
- `ReviewOverlay` → advances after an action; "You are all caught up" when empty; position.
- `ToCheckSection` → inactive-customer line only for an inactive selection.

**Depends on:** Task 108.
**Specialist:** @ui-totetrack
**Status:** [ ]

---

## Task 121: View the source PO document from the order

**Planned 2026-10-13** (`@create-plan`). Approve links the stored document to the order
(Task 108); this makes it viewable.

**Files:**
- `lib/actions/order-document.ts` — create (`'use server'`). Signs the order's document.
- `components/orders/OrderDetailParts.tsx` — modify. `PODocumentSlot` gets "View PO document".

**Functions to implement:**
- `getOrderDocumentUrl(orderId: string): Promise<{ url: string } | { error: string }>` — reads
  the order's `document_url`; signs it for 1 hour from `po-documents` with the **session**
  client (CONSTRAINT-38) only when it is a path under `inbound/`; otherwise an error.

**Acceptance criteria:**
- [ ] An order approved from a PDF or image shows "View PO document", which opens the signed
      link in a new tab (`rel="noopener noreferrer"`).
- [ ] An order with no document keeps today's text; an email-body order says "Created from an
      email: no file".
- [ ] A `document_url` that is not an `inbound/` path is never signed or linked (SEC-02).
- [ ] Auth first (SEC-04); `orderId` refused unless a UUID; only the order id logged (SEC-05);
      signing failure → generic message, logged with context (EH-01/02).
- [ ] `tsc`, `eslint`, full suite green; checked in a browser by the builder.

**Tests required:**
- `getOrderDocumentUrl` → signed URL for an `inbound/` path; refuses a non-`inbound/` value, a
  bad id and no session; signing failure → error.
- `PODocumentSlot` → link shown only with a document; email-body text.

**Depends on:** Task 108.
**Specialist:** @ui-totetrack
**Status:** [ ]
