# QA Report

**Date:** 2026-07-27
**Status:** BLOCKED
**Scope:** Full app shippability re-check after Features 10–13 (per-combo unit pricing, Production Calendar, calendar write surface, touch long-press-arm) plus the 2026-07-27 code-review fix pass (`c44464d`). Supersedes the 2026-04-25 APPROVED report, which predates all four features.
**Method:** Two parallel verification agents (test-coverage review; acceptance-criteria + constraint verification against source) + suite/type-check runs. **Browser automation was unavailable this run** (no browser MCP connected) — Phase 2 is replaced by the manual verification checklist below, per the `@qa` no-browser fallback. `docs/testing-setup.md` was created this session (it did not exist; required by `@qa` Phase 0).

---

## Coverage Assessment

### Critical Paths
- [x] **Auth flows tested:** PASS — `signIn` has 1 happy + 3 error tests; shared `assertAuthenticated` guard has both branches tested (missing-session via `calendar.test.ts:343`, service-failure 503 → generic message via `orders.revert.test.ts:149`). `signOut` has happy-path only (see non-blocking finding 4).
- [x] **Payment flows tested:** N/A — no payment surface.
- [x] **Data write operations tested:** PASS — every server action across auth/customers/orders/orders.revert/calendar/leads/invoices/support has happy + error coverage, verified by reading test bodies, not names. Orders tests exercise real modules (only db/supabase/cache mocked) and assert on captured insert/update payloads — price derivation, coupling rules, and the invoiced/cancelled edit lock are all asserted. The Feature 12–13 calendar mutations (`useProductionPlacement`), popup pills, status block, and the entire arm-mode path (`armPlacement`, `useLongPressArm`, `armMode`) have genuine happy + rejected + thrown-transport coverage.
- [ ] **Access control tested:** **FAIL** — `app/(app)/layout.tsx`, the *only* access-control gate on the read path, has **zero tests**. See BLOCKING finding 1. (Action-level writes are well guarded and tested; this gap is specifically the page-read gate.)

**Suite evidence:** `npx vitest run` → 806/806 passing across 75 files, exit 0. `npx tsc --noEmit` → clean. (`next build` not re-run this session; clean at this same commit per the 2026-07-27 review session.)

### Coverage Gaps
1. `app/(app)/layout.tsx` session guard — zero tests (BLOCKING, finding 1).
2. `getInvoiceForMonth` (`db/queries/invoices.ts:117`) — zero tests **and zero callers** (finding 3).
3. `signOut` — no error-case test; a `supabase.auth.signOut()` exception escapes unhandled (finding 4).
4. `useProductionPlacement.setBackhaul` — the one delegation line never exercised at hook level (finding 4).
5. `middleware.ts` — untested; exempt as framework boilerplate (token refresh only, gates nothing). Noted because it touches auth.
6. Standing accepted gap (unchanged): no DB-integration infra — all SQL is tested by compiled shape + bound params, never executed against Postgres.

**Suspect-test check:** none found — bodies were spot-checked specifically for over-mocking and loose substring assertions; none would pass against broken code.

---

## Browser Workflow Verification

**Not performed this run — browser automation unavailable. Manual verification required. Checklist below.**

Note: the Task 68 touch interaction (long-press-arm + tap-to-place) was **already device-validated by the builder on a real iPad on 2026-07-27** (arm, cross-week place, same-day reorder, unschedule, cancel, popup) — item 10 below records what was covered so re-verification is optional.

### Manual Verification Checklist

Setup: `npx next dev -p 3030`, then `http://localhost:3030`. Password per `docs/testing-setup.md`.

1. **Auth — unauthenticated read gate (ties to BLOCKING finding 1):** while signed out, navigate directly to `/dashboard`, `/orders`, `/calendar`. Expected: immediate redirect to `/login`, no data flash.
2. **Auth — login:** wrong password → inline error, no crash. Correct password → lands on `/dashboard`. Visit `/login` while signed in → redirected to `/dashboard`. Sign out via nav drawer → back on `/login`.
3. **Dashboard:** hero cards populated; Production widget shows next 2 business days with built rows dimmed; amber unscheduled count pill links to `/calendar`.
4. **Orders — search + list:** search by partial PO number and by customer name (250ms debounce); combines with status tabs; no pagination controls anywhere.
5. **Orders — create/edit:** create a PO (clearly named, e.g. `PO-QA-*`) with 2+ combos and unit prices → live total is read-only and matches Σ(qty × unit); all-zero quantities rejected with "At least one quantity is required."; edit an invoiced or cancelled PO → qty/price fields rejected, notes/address still editable.
6. **Orders — status:** Mark Complete on an undated PO → delivery date auto-set to today; Cancel with confirm dialog; Revert to Scheduled from completed and invoiced (invoiced revert deletes the invoice — confirm copy says so).
7. **Calendar — layout:** page itself never scrolls on any viewport; only week strip and day columns scroll; Mon–Fri only; full week visible at 1024px (iPad landscape).
8. **Calendar — desktop drag:** drag a card between days, reorder within a day, drag onto the unscheduled callout (card leaves board); completed/invoiced cards are dimmed and not draggable; drop on origin is a no-op.
9. **Calendar — popup writes:** Backhaul + Same-day pills toggle and survive reload; status block matches Orders tab behavior; cancel removes card + closes popup; complete dims card in place; Escape with a confirm dialog open closes only the confirm, popup persists; card/dashboard update without manual reload after every write.
10. **Calendar — touch (iPad):** ~350ms still-finger press arms (shake + outline); tap another card inserts at its position; tap empty column space appends; tap callout unschedules; any other tap cancels; strip stays scrollable while armed. *(Device-validated 2026-07-27 — optional re-check.)*
11. **Calendar — add from day:** `+ Add order → Add Purchase Order` opens the form in a right drawer without leaving `/calendar`; saved PO lands on the clicked day regardless of the delivery date entered.
12. **Invoices:** generate for a month with eligible POs; re-generate same month → overwrite modal naming the existing INV-####; confirm → old invoice replaced, detached orders return to completed; detail rows show per-PO customer column.
13. **Customers/Leads:** create/edit customer; delete blocked with order history (inline error, Inactive suggested); convert a lead → customer created, lead marked converted.
14. **Support:** create ticket with an attachment ≤10MB; oversized/wrong-type rejected with clear message.
15. **Error surfaces:** with the dev server killed mid-session, submitting any form should surface a loud failure message — never a silent spinner or frozen dialog (this was the 2026-07-27 fix-pass theme; worth one spot check).

---

## Edge Case Assessment

Verified statically (test-level, not browser-level this run):
- Invalid inputs: all-zero qty grid, weekend `production_date`, shape-valid-but-impossible dates (`2026-02-31`), malformed `?week=` param, path-traversal + null-byte filenames on attachments — all rejected server-side with explicit messages, all tested.
- Transport failure: dialogs and forms catch rejections (wedge-proof since `c44464d`); pill toggles revert to true state on refused mutation — regression-tested.
- Session expiry mid-action: server actions return the generic failure message via the shared guard (tested); **the page-read path on session expiry is exactly the untested gate in finding 1.**

---

## Findings

### [BLOCKING] — 1. The read-path access-control gate has zero test coverage

**Founder Brief**
**Decided:** The only thing standing between an unauthenticated visitor and every screen of your data — the session check in `app/(app)/layout.tsx` — has no test, so nothing would catch it breaking.
**Means for your product:** Today it works. But any future refactor that touches that file could silently remove the login wall; every customer, order, and invoice would render to anyone with the URL, and the whole 806-test suite would stay green.
**Check before approving:** A test file exists covering both branches — no user → redirected to `/login`; valid user → children render. Suite passes with it.
**What this closes off:** Nothing — additive test work, no redesign.

**What is wrong:** `db/queries/*` functions perform no auth checks by design and `middleware.ts` only refreshes tokens ("errors here are non-fatal" — it gates nothing). The entire read-path enforcement is `getUser()` + `redirect('/login')` in `app/(app)/layout.tsx` — untested. The 2026-04-25 QA report claimed tests existed in `app/(app)/__tests__/`; no such directory exists at `c44464d`. Testing standards require access-control coverage on critical paths (TS-04).
**What must be done:** Add a layout guard test (mock the server Supabase client + `next/navigation.redirect`; assert redirect on no-user/error, render on user). Scope as a numbered task, implement via `@dev`, re-run `@qa`.

### [NON-BLOCKING] — 2. Browser workflow verification not performed this run

**What is wrong:** No browser MCP was connected; Phase 2 could not be automated. All Feature 10–13 acceptance criteria were verified against source with file:line evidence, and Task 68 was device-validated by the builder — but rendered behavior (layout lock, drag, dialogs) has not been re-verified end-to-end since Feature 9.
**What must be done:** Either complete the manual checklist above and record the result here, or connect a browser MCP (Playwright MCP now added is the durable fix) and re-run `@qa` — the re-run after finding 1's fix is the natural moment.

### [NON-BLOCKING] — 3. `getInvoiceForMonth` is dead code

**What is wrong:** `db/queries/invoices.ts:117` has zero callers (its doc comment claims the generator uses it; `createInvoice` does its own existence check) and zero tests.
**What must be done:** Delete it (preferred) or wire it in and test it.

### [NON-BLOCKING] — 4. Minor coverage gaps

**What is wrong:** (a) `signOut` has no error-case test — an exception from `supabase.auth.signOut()` escapes unhandled; auth functions are supposed to carry 2 error cases. (b) `useProductionPlacement.setBackhaul` — the single delegation line is the only untested wiring in the calendar mutation hook.
**What must be done:** One error-branch test + handling for `signOut`; one hook-level test for `setBackhaul`. Cheap; bundle with finding 1's task.

### [NON-BLOCKING] — 5. Spec/documentation drift (4 items)

**What is wrong:**
(a) Plan Task 65 + CONSTRAINT-19 say the popup pill toggles are permitted on `invoiced`/`cancelled`; the server blocks `cancelled` (`lib/actions/calendar.ts:30-40`). Unreachable via UI (cancelled cards never render) — contract/spec mismatch only.
(b) CONSTRAINT-19's "the calendar never writes `requested_delivery_date`" now conflicts with CONSTRAINT-16: marking an undated card complete from the popup auto-sets the delivery date (`lib/actions/orders.ts:215`). Deliberate and identical to the Orders tab — but the constraint texts contradict each other.
(c) Plan Tasks 50/51 acceptance text still describes the deleted read-time derivation design; never annotated as superseded by the CONSTRAINT-19 revision.
(d) Plan Tasks 63–67 acceptance checkboxes are unchecked under "✅ Done" headers (all criteria verified implemented).
**What must be done:** Documentation pass reconciling all four — no code changes.

### [NON-BLOCKING] — 6. Prior QA report inaccuracy

**What is wrong:** The 2026-04-25 report's access-control PASS cited tests that do not exist. This report supersedes it; noted so the record is honest.
**What must be done:** Nothing beyond finding 1.

---

## Summary

**Blocking issues:** 1
**Non-blocking issues:** 5

**Verdict:**
BLOCKED — 1 blocking issue must be resolved (access-control test for `app/(app)/layout.tsx`). Re-run `@qa` after the fix; complete browser verification (manual checklist or MCP) on the re-run.

The product's code was found in strong shape: 806/806 tests, clean types, all Feature 10–13 acceptance criteria and all 8 binding constraint invariants verified against source, no suspect tests. The block is a single missing test on the most security-critical line in the app — cheap to fix, wrong to waive.
