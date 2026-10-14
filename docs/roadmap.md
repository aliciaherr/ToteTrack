# Roadmap: ToteTrack

> **The task tracker: every milestone, feature and task, one line per task.**
> `[x]` done · `[ ]` open · `[~]` cut or superseded. Task numbers are IDs, not order (31–32 were never used); lines are in build order.
> Specs: open tasks in `docs/plan.md`, finished ones in `docs/plan-archive/`. Unplanned work: `docs/backlog.md`.
> Kept current by every planning and build step (project `CLAUDE.md` → "Docs upkeep").

## Where we are

- **App:** live, in daily use by the salesperson on real data.
- **Active:** Milestone 3, Feature 16 (Email PO ingestion). **Review UI core done (121).** Next: `@code-review` on the review flow, then Task 110 (not specced yet).
- **Feature 16 runs nothing in prod** until the go-live checklist below is done.

---

## Milestone 1 — Launch — done · shipped, in daily use since 2026-08

### App runs and you can log in (Feature 1, app shell)

- [x] 1 — Project scaffold + install dependencies
- [x] 2 — Database schema — Drizzle schema files + enums
- [x] 3 — Supabase migrations + RLS policies + storage buckets
- [x] 4 — Supabase client setup + middleware
- [x] 5 — Auth — login page + session guard + server actions
- [x] 6 — App shell + nav drawer

### Customers, orders, leads (Features 3–5)

- [x] 11 — Customer list panel + search + sort
- [x] 12 — Customer detail panel + order history tabs
- [x] 13 — Volume overview component + query
- [x] 14 — Customer form (create / edit / delete) + server actions
- [x] 15 — Order table + status filter tabs
- [x] 16 — Order detail panel
- [x] 17 — Order form (create / edit) + server actions
- [x] 18 — Order status transitions
- [~] 19 — PO document upload (Supabase Storage) · *cut 2026-07-27, superseded by Feature 16*
- [~] 33 — PO document extraction + form pre-fill (Claude vision) · *cut 2026-07-27, superseded by Feature 16*
- [x] 20 — Lead list panel
- [x] 21 — Lead detail panel + notes
- [x] 22 — Lead form (create / edit) + conversion flow

### Dashboard (Feature 2)

- [x] 7 — Dashboard layout + hero cards + stats query
- [x] 8 — Need-to-Contact widget + SQL query
- [x] 9 — Pending Orders + Leads Follow-Up dashboard widgets
- [x] 10 — Invoice trend chart (Recharts, 4 modes)

### Invoices and support (Features 6–7)

- [x] 23 — Generate invoice panel + invoiceable orders query
- [x] 24 — Invoice creation server action
- [x] 25 — Invoice ledger + detail view
- [x] 26 — Support ticket form + attachment upload
- [x] 27 — Support ticket list + detail view

### Production-ready

- [x] 28 — Framer Motion animation layer
- [x] 29 — Toast notifications + global error handling
- [x] 30 — Keep-alive cron + README documentation · *README shipped; the keep-alive cron was declined 2026-08-17*

---

## Milestone 2 — Post-launch features — done

### App shell chrome + Quick-Add FAB (Feature 8)

- [x] 34 — Remove top bar; ship pill hamburger on authenticated routes
- [x] 35 — Dashboard Quick-Add FAB + `?new=1` handling on Customers/Leads

### Feature 9 — PO multi-combo restructure

- [x] 36 — Schema migration — replace legacy PO columns with 6 quantity columns
- [x] 37 — Refactor read queries for new schema (orders, dashboard, volume overview)
- [x] 38 — Refactor `createOrder` + `updateOrder` server actions — new input shape, sum-validation, edit lock
- [x] 39 — Reusable 2×3 size×type grid component (display + input variants)
- [x] 40 — Order form — integrate 2×3 input grid + total price + client validation
- [x] 41 — Order detail — 2×3 display grid + total price prominence
- [x] 42 — Order table — column restructure + shared `BackhaulTag` component
- [x] 43 — Downstream PO list surfaces — Open Orders widget + Customer Order History + Invoice detail PO rows

### Feature 10 — PO per-combo unit pricing

- [x] 44 — Schema — add 6 per-combo unit-price columns
- [x] 45 — Server data contract — validation, actions, detail read
- [x] 46 — `QtyGrid` — unit-price input cell + `qty / $unit` display cell
- [x] 47 — Order form — wire unit-price inputs + read-only live total
- [x] 48 — Order detail — render `qty / $unit` grid

### Feature 11 — Production calendar

- [x] 49 — Schema — add production_date, same_day_delivery, production_sort_index
- [x] 50 — Business-day date helpers in `lib/dates.ts`
- [x] 51 — Calendar read queries
- [x] 52 — Calendar server actions
- [x] 53 — Nav entry + `/calendar` route
- [x] 54 — `ProductionCard` component
- [x] 55 — `CalendarLayout` + `DayColumn` — viewport-locked week strip
- [x] 56 — `@dnd-kit` wiring — drag between days, reorder, edge auto-scroll
- [x] 57 — `UnscheduledCallout` + dropdown drop target
- [x] 58 — `ProductionCardDialog` — read-only popup
- [x] 59 — Dashboard Production widget
- [x] 60 — Documentation sync

### Feature 12 — Orders list ergonomics + calendar write surface

- [x] 61 — Orders list — drop pagination
- [x] 62 — Orders list — search by PO number or customer name
- [x] 63 — `createOrder` accepts a production-date override
- [x] 64 — "Add Purchase Order" from a day column
- [x] 65 — Backhaul + Same-day pill toggles in the card popup
- [x] 66 — Status block in the card popup
- [x] 67 — Dim built orders harder

### Feature 13 — Touch: long-press-to-arm + tap-to-place

- [x] 68 — Long-press-to-arm + tap-to-place on touch devices

### QA fix — 2026-07-27 BLOCKED report

- [x] 69 — Test the read-path access-control gate (+ bundled minor coverage gaps)

### Feature 14 — Multiple saved delivery addresses

- [x] 70 — `customer_addresses` schema, migration 0012, and query layer
- [x] 71 — Customer-address server actions
- [x] 72 — Order form — address dropdown with inline add-new + MRU
- [x] 73 — Customer detail address management + deprecate `default_delivery_address`
- [x] 74 — Need-to-Contact — suppress customers with a scheduled order
- [x] 75 — Calendar card popup — Contact button with nested contact picker

### Feature 15 — Pickups

- [x] 76 — Rename `orders.pickup_only` to `customer_collects`
- [x] 77 — `pickups` table, queries and actions
- [x] 78 — Pickups tab
- [x] 79 — Pickup History on the customer detail panel
- [x] 80 — Pickups on the calendar — rendering, toggles, popup
- [x] 81 — Pickup drag, drop and arm mode

### Maintenance and hardening

- [x] 82 — Pin dependency versions and add crash error boundaries
- [x] 83 — Upgrade to React 19 and Next.js 15
- [x] 84 — Upgrade to Next.js 16 and ESLint 9 flat config
- [x] 85 — Clear the first ESLint sweep (117 findings)
- [x] 86 — Close the last `npm audit --omit=dev` high (ws via Supabase)
- [~] 87 — Fix the `/calendar` hydration mismatch (`@dnd-kit` unstable IDs) · *superseded: accessibility impact accepted*
- [x] 88 — Add Saturday as a production day
- [x] 89 — Renumber the column on placement so intra-day reordering persists
- [x] 90 — Close the three remaining unguarded-`await` wedge bugs
- [x] 91 — One placement rule on touch — the armed card takes the tapped card's position
- [x] 92 — Consolidate the duplicated auth guard — one checker, called inside the try
- [x] 93 — Stop the lead and customer forms failing silently

---

## Milestone 3 — Feature 16: Email PO ingestion — in progress

### Ingestion, extraction, checks, worker, triggers

- [x] 94 — Amend CONSTRAINT-07 to permit a metered extraction API
- [x] 95 — Add the inbound-email staging schema
- [x] 96 — Read unprocessed mail over IMAP
- [x] 97 — Ingest fetched mail into the staging queue
- [x] 98 — Extraction call — OpenRouter + ZDR, schema, source quotes
- [x] 99 — Track processed mail by UID + UIDVALIDITY (CONSTRAINT-33)
- [x] 100 — No silent drops, and the exact accepted file types (CONSTRAINT-34/35)
- [x] 114 — Give up on a UID after 3 failing runs + 1 hour (CONSTRAINT-37, HIGH-02R)
- [x] 101 — Check suite — quotes, arithmetic, dates, field gates
- [x] 102 — Customer matcher — normalise + pg_trgm + address signal
- [x] 103 — Worker foundations — body text, lease column, storage module, failed rows visible
- [x] 115 — Worker core — claim, extract, check, match, persist
- [x] 116 — Worker route — secret, after(), self-chain
- [x] 104 — Triggers — daily cron + manual, through one route

### Review UI (the core)

- [x] 105 — Show the review queue in the menu — count, last checked, check mail
- [x] 106 — Open the review overlay and show the source — images, email text, refusals
- [x] 117 — Draw PDFs in the review overlay with pdf.js
- [x] 107 — Load the review fields — map the extraction to order-form values; Brenntag rule
- [~] 118 — Build the review overlay's right pane — superseded by 119 after the first browser check (too wordy)
- [x] 119 — Rework the review pane — one "To check" section, a clean form, green/red fields
- [x] 108 — Approve, Skip and Delete on the server — one transaction; inactive customer reactivated; duplicates blocked
- [x] 120 — Approve / Skip / Delete buttons and moving through the queue — "You are all caught up"
- [~] 109 — Auto-advance and "You are all caught up" — folded into 120 (2026-10-13), so the queue never dead-ends
- [x] 121 — View the source PO document from the order
- [ ] 110 — Architecture + `document-extraction.md` updates · *not specced yet*

### After the core is in real use — re-evaluate before starting

- [ ] 111 — Duplicate diff + update-existing-order path · *not specced yet* (`Ask the salesperson first: how often does a customer send a revised PO for an order already entered? Is deleting the duplicate and editing the order by hand a real pain, or fine?`)
- [ ] 112 — Inline customer creation, pre-filled, secondary to the picker · *not specced yet* (`Ask the salesperson first: how often does a PO arrive from a customer not yet in ToteTrack? Is leaving Review to add them on the Customers page, then coming back, a problem?`)
- [ ] 113 — Learned per-customer name aliases · *not specced yet* (`Ask the salesperson first: do you keep picking the same customer by hand because the PO names them differently, e.g. a legal name or a branch? Which customers, and how often?`)

---

## Feature 16 go-live checklist (builder, manual)

- [ ] Vercel, **Production only:** `SUPABASE_SECRET_KEY`; `INGEST_TRIGGER_SECRET` and `CRON_SECRET` as two different `openssl rand -hex 32` values; `INGEST_APP_ORIGIN` = the prod URL (leave it unset on Preview).
- [ ] Turn Fluid Compute on (`maxDuration` 120 / 300 need it on Hobby).
- [ ] Check the first deploy renders a PDF (A-14).
- [ ] Check preview deployment protection does not block the internal calls.
- [ ] Move the 4 sample POs from Gmail Spam to the inbox.
- [ ] Check the review overlay draws PDFs on the real iPad (A-15; deferred from Task 117). If it fails, "Open the file" becomes the PDF view.
- [ ] One live end-to-end run on real mail.

---

*History: the original launch roadmap (milestones, sequencing rationale, launch risks) is archived at `docs/plan-archive/roadmap-2026-04.md`.*
