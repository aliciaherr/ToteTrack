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
