# Roadmap: ToteTrack

**Built from:** `docs/plan.md`
**Date:** 2026-04-20
**Status:** Approved

> Milestone task checkboxes are visual reference only. `docs/plan.md` is the source of truth for task status.

---

## Milestone 1: App runs and you can log in

**Goal:** A working Next.js app is running locally with Supabase connected, authentication working, and the nav shell in place — every screen route exists (even if empty).

**Tasks:**
- [ ] Task 1: Project scaffold + install dependencies
- [ ] Task 2: Database schema — Drizzle schema files + enums
- [ ] Task 3: Supabase migrations + RLS policies + storage buckets
- [ ] Task 4: Supabase client setup + middleware
- [ ] Task 5: Auth — login page + session guard + server actions
- [ ] Task 6: App shell + nav drawer

**Done when:** `npm run dev` starts without errors; login with the correct password redirects to `/dashboard`; hamburger opens the nav drawer with all 6 items; navigating between routes works; wrong password shows an error message.

**Known risks at this milestone:** A-04 (Framer Motion client boundaries) — the nav drawer in Task 6 is the first animated component. Boundary discipline set here carries into all subsequent milestones.

---

## Milestone 2: Salesperson can enter and manage their data

**Goal:** The salesperson can create customers, log orders, advance order statuses, upload PO documents, create leads, and convert leads to customers — the full daily workflow, end to end.

**Tasks:**
- [ ] Task 11: Customer list panel + search + sort
- [ ] Task 12: Customer detail panel + order history tabs
- [ ] Task 13: Volume overview component + query
- [ ] Task 14: Customer form (create / edit / delete) + server actions
- [ ] Task 15: Order table + status filter tabs
- [ ] Task 16: Order detail panel
- [ ] Task 17: Order form (create / edit) + server actions
- [ ] Task 18: Order status transitions
- [ ] Task 19: PO document upload (Supabase Storage)
- [ ] Task 20: Lead list panel
- [ ] Task 21: Lead detail panel + notes
- [ ] Task 22: Lead form (create / edit) + conversion flow

**Done when:** A new customer can be created with a contact; a new order can be logged against that customer; the order can be advanced from scheduled → pending → completed; a PO document can be uploaded and downloaded; a lead can be created, have a note added, and be converted to a customer.

**Known risks at this milestone:** A-03 (cold start) — data entry UX must feel fast on iPad. If creating a customer or logging an order takes too many taps, the salesperson will abandon populating backlog data and the dashboard stays empty indefinitely. Prioritize form UX quality in Tasks 14, 17, and 22.

---

## Milestone 3: Dashboard shows meaningful data

**Goal:** The dashboard is fully functional with real data flowing in from Milestone 2 — hero cards, Need-to-Contact list, Pending Orders, Leads Follow-Up, and the invoice trend chart are all built and testable against actual entries.

**Tasks:**
- [ ] Task 7: Dashboard layout + hero cards + stats query
- [ ] Task 8: Need-to-Contact widget + SQL query
- [ ] Task 9: Pending Orders + Leads Follow-Up dashboard widgets
- [ ] Task 10: Invoice trend chart (Recharts, 4 modes)

**Done when:** Dashboard loads with real data from Milestone 2 entries — Need-to-Contact list shows overdue customers; pending orders appear with backhaul pinned to top; leads with past follow-up dates appear; monthly/yearly toggle correctly changes hero card values; invoice chart renders with all 4 modes switching correctly.

**Known risks at this milestone:** The Need-to-Contact SQL aggregation (Task 8) is the most complex query in the codebase. Test it with real data from Milestone 2 before marking this milestone done.

---

## Milestone 4: Full business workflow operational

**Goal:** The complete salesperson workflow is end-to-end — orders can be invoiced, invoices can be marked paid, and the salesperson has a way to report bugs and feature requests.

**Tasks:**
- [ ] Task 23: Generate invoice panel + invoiceable orders query
- [ ] Task 24: Invoice creation server action
- [ ] Task 25: Invoice ledger + detail view
- [ ] Task 26: Support ticket form + attachment upload
- [ ] Task 27: Support ticket list + detail view

**Done when:** Can select a billing month, see completed uninvoiced orders, create an invoice (verifying all selected orders flip to 'invoiced' status), mark the invoice as paid, and see it in the ledger; can submit a support ticket with an attachment and see it in the ticket list.

**Known risks at this milestone:** Invoice creation is an atomic DB transaction (Task 24) — the most operationally critical action in the app. Test the rollback case explicitly: what happens when one order in the batch is already invoiced.

---

## Milestone 5: Production-ready

**Goal:** The app is polished, all Framer Motion animations are applied, error feedback is consistent across every screen, the README is complete, and the keep-alive cron is configured — ready to deploy to Vercel.

**Tasks:**
- [ ] Task 28: Framer Motion animation layer
- [ ] Task 29: Toast notifications + global error handling
- [ ] Task 30: Keep-alive cron + README documentation

**Done when:** All animations from `docs/design-decisions.md` are working (page transitions, drawer, tab switching, stagger, collapsibles); every server action shows a success or error toast; `useReducedMotion()` disables animations correctly; README has complete setup instructions including keep-alive cron steps; cron-job.org is configured and pinging Supabase every 5 days.

**Known risks at this milestone:** A-01 (Supabase pausing) — the keep-alive cron must be configured before the app goes into regular use. Don't skip Task 30.

---

## What's Not in V1

Deliberately excluded per `docs/prd.md` — not deferred, out of scope:

- **Invoice delivery** — no PDF export, no email send; invoices are read-only records inside the app
- **Supplier management** — single supplier, managed outside the tool
- **Offline support** — internet always required
- **Multi-user** — single-user architecture by design; expansion requires a separate planning phase
- **External integrations** — no QuickBooks, no email send, no calendar sync
- **Margin / profitability tracking** — order prices are recorded, but no cost or margin calculation

---

## Sequencing Rationale

**M1 first:** Technical dependency — no screen can be built or tested without DB schema, Supabase connection, and auth in place.

**M2 before M3:** Product priority over technical simplicity. Dashboard queries are simpler to build, but the dashboard is meaningless without data. Building data entry first means the dashboard can be tested with real entries from day one. This directly reflects the A-03 contingency: the salesperson's first experience should be entering data, not staring at zeros.

**M3 after M2:** Need-to-Contact aggregation and volume overview are unverifiable without customer and order history. Building them after M2 gives immediate, real validation.

**M4 after M3:** Invoices require completed orders from M2. Support is standalone but lower priority than the core workflow.

**M5 last:** Animations layer on top of complete features — Task 28 explicitly requires all screens built. Toast error handling is additive; inline form errors function throughout M2–M4 without it. Docs and cron are deployment prerequisites, not development ones.

---

## Open Risks

| Risk | From | Milestone affected | Contingency |
|------|------|--------------------|-------------|
| Supabase free tier pausing | A-01 | Milestone 5 (Task 30) | Keep-alive cron via cron-job.org every 5 days. If missed: manual unpause via Supabase dashboard (~30s). Document unpause steps in README. |
| Cold start — salesperson won't enter backlog data | A-03 | Milestone 2 | Form UX quality in Tasks 14/17/22 is high-stakes. If data entry feels slow or painful on iPad, historical data never gets entered and the dashboard stays empty. |
| Framer Motion / Next.js client boundary violations | A-04 | All milestones | Any file importing from `framer-motion` must have `'use client'`. Enforced from Task 6 onward. Violations cause runtime errors that are hard to trace retroactively. |
