# Plan: ToteTrack — open tasks

> **Only open tasks live here.** Each one is one-shot-ready: it can be built without asking
> clarifying questions. When a task is done, its block moves to `docs/plan-archive/`.
> One line per task, for every task ever planned: `docs/roadmap.md`. Unplanned work: `docs/backlog.md`.

---

# Feature 16 — Email PO Ingestion

**Source:** `docs/prd.md` → Feature 16. Decisions: `docs/architecture.md` (the Feature 16
sections) and CONSTRAINT-30 to -40. The feature preamble and finished tasks 94–106 / 114–116 are
in `docs/plan-archive/feature-16.md`. Tasks 111–113 run only after the core is in real use.

## Task 110: Bring the architecture docs up to date and remove `document-extraction.md`

**Planned 2026-10-14** (`@create-plan`). **Infra task:** docs only, no user-visible change, so
no PRD entry. Builder decision 2026-10-14: dissolve `document-extraction.md` and delete it (its
own "Lifespan" line says so).

**Files:**
- `docs/architecture.md` — modify.
- `docs/data-model.md` — modify.
- `docs/document-extraction.md` — delete.

**Acceptance criteria:**
- [ ] `architecture.md`: the claim query shown as CONSTRAINT-40 requires (MATERIALIZED CTE, not
      `WHERE id IN (… SKIP LOCKED)`); no mention of the deleted `countPendingReview` /
      `listPendingReview`; `db/queries/*` no longer called "read-only" (inbound has inserts).
- [ ] `architecture.md` no-run-lock section lists the overlap costs: duplicate-flag misses and
      double-counted UID failures.
- [ ] `architecture.md` records the review-fix batch: worker writes fenced to their claim
      (`LostClaimError`, `lost` outcome); a UID failing on a live IMAP connection is a counted
      failed UID, not a run abort; IMAP timeouts 30/15/60 s; `toOrderQuantities` in
      `lib/extraction/quantities.ts`; checks `value_not_in_quote`, `date_order_mismatch`,
      `quantity_missing`, and the space-joined PDF text layer (Task 122).
- [ ] `data-model.md`: Feature 16 tables, enums, the 0020 functions and the 0021 CHECK.
- [ ] Anything in `document-extraction.md` still true is in the docs above, with a link to
      `architecture-playbooks/playbooks/document-extraction.md`; the file is deleted and no doc
      links to it (`grep`).
- [ ] Every claim checked against the code, not the backlog wording.

**Tests required:** none (docs only). Check: `grep -rn "document-extraction.md" docs/` shows
only the playbook link.

**Depends on:** Tasks 122, 123.
**Status:** [ ]
