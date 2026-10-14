# Plan: ToteTrack — open tasks

> **Only open tasks live here.** Each one is one-shot-ready: it can be built without asking
> clarifying questions. When a task is done, its block moves to `docs/plan-archive/`.
> One line per task, for every task ever planned: `docs/roadmap.md`. Unplanned work: `docs/backlog.md`.

---

# Feature 16 — Email PO Ingestion

**Source:** `docs/prd.md` → Feature 16. Decisions: `docs/architecture.md` (the Feature 16
sections) and CONSTRAINT-30 to -40. The feature preamble and finished tasks 94–106 / 114–116 are
in `docs/plan-archive/feature-16.md`. Tasks 111–113 run only after the core is in real use.

## Task 123: Fix the date false alarms and give a missing quantity its own flag

**Planned 2026-10-14** (`@create-plan`). Go-live blockers (backlog, 2026-10-14): a quote with
two dates raises `date_order_mismatch`; written dates with a 2-digit year fail
`value_not_in_quote`; a line with no quantity says "Quantity looks wrong".

**Files:**
- `lib/checks/dates.ts` — modify. Use every numeric date in a quote, not only the first.
- `lib/checks/value-in-quote.ts` — modify. `writtenMatch` accepts a 2-digit year.
- `lib/checks/fields.ts`, `lib/checks/types.ts` — modify. New check `quantity_missing`.
- `lib/review/review-fields.values.ts`, `lib/review/review-fields.wording.ts` (and the flag-kind
  type) — modify. Map and word the new flag.
- Matching `__tests__` files — modify.

**Functions to implement:**
- `datePair(value: string, quote: string): [number, number] | null` (replaces `leadingParts`) —
  of the quote's numeric dates, the first whose year matches and whose two numbers equal the
  value's month/day in either order; if none does, the first numeric date; `null` if none.
- `checkDates` — proof of month-first / day-first comes from **every** numeric date in every
  quote; ambiguity and order checks use `datePair` per date.
- `writtenMatch(date, quote)` — year matched by `yearMatches` (4 digits, or 2 digits as the last
  two); the year token must be a different token from the day token.
- `fields.ts` `checkToteLine` — `quantity === null` → `quantity_missing` ("no quantity stated");
  `quantityProblem` keeps its bounds rules for stated quantities (it stays shared with review).
- Review: a line with no quantity → flag `quantity_missing`, wording
  `'No quantity found: enter it'`; a bad stated quantity keeps `quantity_out_of_bounds`.

**Acceptance criteria:**
- [ ] "Order 10/14/26 Ship 10/20/26" with value 2026-10-20 → no `date_order_mismatch`; a range
      "10/20/26 - 10/24/26" with either end as the value → no failure.
- [ ] A value matching none of the quote's dates → still `date_order_mismatch` /
      `value_not_in_quote`. A day-first document is still flagged (CONSTRAINT-41).
- [ ] "05-MAR-26" and "Mar 5, '26" for 2026-03-05 pass; "Mar 26" (no year) for 2026-03-26 fails.
- [ ] No quantity → "No quantity found: enter it"; quantity 0 or over the limit → "Quantity
      looks wrong: left blank". `REVIEW_FLAG_WORDING` has an entry (type check enforces it).
- [ ] Failure details hold no document text (SEC-05); `tsc`, `eslint`, full suite green.

**Tests required:**
- `checkDates` → two-date quote and range pass (happy); mismatching value fails (error).
- `dateInQuote` → 2-digit written years pass (happy); day reused as year fails (error).
- `checkFields` → null quantity → `quantity_missing` (happy); 0 → `quantity_out_of_bounds` (error).
- Review mapping → each kind gets its wording.

**Depends on:** None.
**Status:** [ ]

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
