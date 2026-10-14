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
