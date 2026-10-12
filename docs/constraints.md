# Constraints: ToteTrack

> Per-project file. Seeded by `@plan` with binding decisions made during planning.
> Updated whenever a new binding decision is made during development.
> Loaded by `@session-start` every session.
>
> **What belongs here:** Active binding decisions only. Not history. Not rationale. Not options considered. Just what is locked and what it means in practice.
>
> **Distinct from `docs/assumptions.md`:** Assumptions are things to validate before planning. Constraints are decisions already made that close off future options.

---

## Active Constraints

---

### CONSTRAINT-01 — Stack is locked

**Decision:** The full stack is: Next.js App Router, Supabase (PostgreSQL + Auth + Storage), Drizzle ORM, shadcn/ui, Tailwind CSS, Framer Motion, Recharts, Vercel. No substitutions.

**What it means in practice:** Do not introduce alternative ORMs, UI libraries, animation libraries, or hosting platforms. If a library is missing a capability, extend it or work around it within the existing stack.

**Who decided and when:** @cto (via @plan), 2026-04-20

**What this closes off:** Swapping any layer requires updating all code that depends on it — not justified within this project's scope.

---

### CONSTRAINT-02 — Server Actions only — no REST API

**Decision:** All mutations use Next.js Server Actions. All data fetching uses Server Components. No separate REST API layer (no `app/api/` route handlers for app data operations).

**What it means in practice:** Every data mutation is a `'use server'` function in `lib/actions/[domain].ts`. No fetch() calls to internal API routes. No JSON request/response boilerplate.

**Who decided and when:** @cto (via @plan), 2026-04-20

**What this closes off:** External API consumers and native mobile apps would require extracting Server Actions into REST endpoints — a significant refactor.

---

### CONSTRAINT-03 — Component boundary rule (client-only libraries = 'use client')

**Decision:** Any file that imports from `framer-motion`, `recharts`, `@dnd-kit/core`, or `@dnd-kit/sortable` must be a client component (`'use client'` at the top of the file). Server components fetch data only — no animation, chart, or drag-and-drop imports.

> This sentence is duplicated verbatim in `docs/architecture.md` → Component Boundary Rule. The two must stay identical; if a library is added to one list, add it to the other in the same change.

**What it means in practice:** The pattern is always: server component (fetch data, pass as props) → client component (render with animation). Never import one of these libraries in a file without `'use client'`. Violating this causes runtime errors.

A **type-only** import is erased at compile time and does not require the directive — `import type { DragEndEvent } from '@dnd-kit/core'` in `components/calendar/calendarDnd.ts` is deliberate and correct.

**Who decided and when:** @plan (A-04 resolution), 2026-04-20. `@dnd-kit` added to the list 2026-07-27 (Feature 11 Task 60; the dependency itself was approved 2026-07-26 — see FB-12).

**What this closes off:** Nothing — this is a correctness requirement, not an option.

---

### CONSTRAINT-04 — Single-user auth: fixed dummy email pattern

**Decision:** Supabase Auth is configured with one user: email = value of `ADMIN_EMAIL` env var (set to `admin@totetrack.app`), password = salesperson's chosen password. The login UI shows a password field only — email is never visible.

**What it means in practice:** The `signIn` server action always uses `process.env.ADMIN_EMAIL` as the email. Never hardcode `admin@totetrack.app` in source code. Never show, mention, or expose the email in the UI. `ADMIN_EMAIL` must be set in `.env.local` and Vercel environment variables.

> **Revised 2026-07-27 (`@security` CRIT-01):** the email's secrecy is defense-in-depth, not a wall — it appears in committed docs (`architecture.md`, `assumptions.md`, this file) on a public repo and must be treated as **publicly known**. The password is the only real secret: it lives nowhere but the Supabase dashboard, the salesperson's memory, and the gitignored `docs/testing-setup.md` — never in any committed file, *including QA and review reports* (that is how the 2026-04-25 leak happened; see `docs/security-report.md` and FI-06). The no-hardcode / no-UI rules above still stand unchanged — tests use placeholder emails (`user@example.com`), not the real one.

> **Revised 2026-08-02 (CRIT-01 rotation):** two Supabase Auth users now exist — the **prod user** (new internal email, set only in Vercel's `ADMIN_EMAIL`) and the **QA user** (the original email, rotated password, kept in local `.env` + gitignored `testing-setup.md`). The single-user *pattern* is unchanged: each environment's `signIn` uses its own `ADMIN_EMAIL`, the UI still shows password-only, and neither email appears in source or UI. Both users have identical full RLS access to the one shared DB — the QA user is a separate identity, not a sandbox (CONSTRAINT-20 unchanged).

**Who decided and when:** @plan (A-02 resolution), 2026-04-20; two-user revision: Builder, 2026-08-02

**What this closes off:** Adding multiple *product* users without a significant auth architecture change. This is single-user by design.

---

### CONSTRAINT-05 — RLS on all tables

**Decision:** Row Level Security is enabled on ~~all 8 database tables~~ **every table in the database, without exception**. RLS is never disabled, bypassed, or relaxed.

**Amended 2026-10-07 (Task 95): the count is deliberately no longer a number.** This line said "8 tables" while the database held 10, and `architecture.md:474` said 10 — a security-relevant claim that had quietly gone stale. A number here has to be re-counted by hand on every migration and has already drifted three times (`customer_addresses` in Feature 14, `pickups` in Feature 15, `inbound_emails` + `inbound_pos` in Feature 16). **"Every table, without exception" cannot go stale**, which is the only property that matters for a constraint someone reads to decide whether a table is covered. The authoritative per-table list stays in `docs/architecture.md`, where it is maintained alongside the schema; if a count is ever wanted, count `ENABLE ROW LEVEL SECURITY` across `db/migrations/*.sql` rather than trusting prose.

**What it means in practice:** Every `db/migrations/` file that creates a new table must also include the RLS enable + policy statements. Migration `0016` does this for `inbound_emails` and `inbound_pos`, in the same file that creates them. Do not use the Supabase service role key to bypass RLS — use it only when there is no authenticated session context (e.g., server-side admin operations during setup).

**Who decided and when:** @cto (via @plan), 2026-04-20; count made non-numeric by Builder (Task 95), 2026-10-07

**What this closes off:** Nothing meaningful. RLS is additive.

---

### CONSTRAINT-06 — Supabase Storage for files, private buckets only

**Decision:** All uploaded files (PO documents, support attachments) are stored in private Supabase Storage buckets and served exclusively via server-generated signed URLs (1-hour expiry).

**What it means in practice:** Never make a bucket public. Never return a raw storage path as a download URL. Every file download must go through `getPODocumentSignedUrl` or equivalent — which requires an active auth session.

**Who decided and when:** @cto (via @plan), 2026-04-20

**What this closes off:** Files cannot be shared via link without the app. Storage bucket changes require updating all upload/download code.

---

### CONSTRAINT-07 — $0 hosting — Vercel free + Supabase free tiers only

**Decision:** The app must run entirely on Vercel free tier + Supabase free tier. ~~No paid services.~~

**What it means in practice:** ~~Do not introduce any paid infrastructure (paid Supabase plan, Redis, external CDN, third-party services).~~ If a feature requires paid infrastructure, it is out of scope until explicitly approved by the builder.

**Amended 2026-10-07 (Task 94): one metered API is permitted, scoped to PO extraction only.** Email PO ingestion (Feature 16) cannot work without a vision-capable LLM, and nothing on a free tier serves one at usable accuracy — so this constraint now permits **a single metered LLM API, used only to extract fields from purchase-order documents**, billed through OpenRouter with **ZDR enforced account-wide** on the model group (A-08 — ZDR leaves the two Azure routes, and the per-request `zdr` flag is hardcoded `true` with no environment override). Any other use of that key — chat, summarisation, anything outside extraction — is a fresh decision, not covered by this amendment.

**Everything else stays forbidden:** a paid Supabase plan, Redis, an external CDN, and any other paid infrastructure or third-party service. Hosting remains Vercel free + Supabase free, and a feature needing any of the above is still out of scope until the builder explicitly approves it.

**No cost figure is pinned here, deliberately.** A-13 is the cost basis — ~$0.0015 per PO, roughly $8/year at 15 POs/day — cited as an estimate and **not** adopted as a binding limit. A number written before the first real document is a guess that later gets quoted as a budget. **Follow-up, dated 2026-10-07 and due after the first few days of real use:** read actual OpenRouter spend per PO and per month, and write the measured figure into this constraint then.

**Who decided and when:** Builder (kickoff), 2026-04-20; amended by Builder (Task 94), 2026-10-07

**What this closes off:** Background jobs (Supabase free has no pg_cron), additional storage beyond 1GB, high bandwidth features.

---

### CONSTRAINT-08 — ~~Invoice statuses: Draft and Paid only~~ — **SUPERSEDED by CONSTRAINT-17**

**Decision:** ~~Invoices have exactly two statuses: `draft` and `paid`. The status `sent` does not exist in this codebase.~~

**Status:** Superseded 2026-04-22 — invoices no longer carry a status at all. The `status` column and `invoice_status` enum were dropped in migration `0007`. See **CONSTRAINT-17** for the v3 invoice model.

**Who decided and when:** Builder (D6 approval in @plan Phase 1), 2026-04-20; superseded by Builder (Bundle H), 2026-04-22

---

### CONSTRAINT-09 — Container sizes and types are fixed enums

**Decision:** Container sizes are exactly: 275 gal, 330 gal. Container types are exactly: Rebottled, Reconditioned, Brand New. These are not user-configurable.

**What it means in practice:** `container_size` and `container_type` are `pgEnum` columns. No settings screen or admin panel for these values. If new sizes/types are ever needed, they require a DB migration and enum update.

**Who decided and when:** Builder (D9 approval in @plan Phase 1), 2026-04-20

**What this closes off:** Dynamic product type management. Deliberate — scope control.

---

### CONSTRAINT-10 — PO status changes via action buttons, not dropdown

**Decision:** Order status transitions are exposed as labeled action buttons in the `OrderStatusActions` component ("Mark as Pending", "Mark as Complete", "Cancel Order"). Not a status dropdown.

**What it means in practice:** The `OrderStatusActions` component renders zero, one, or two buttons depending on `currentStatus`. Do not add a generic status dropdown to any order form or detail view.

**Who decided and when:** Builder (D3 approval in @plan Phase 1), 2026-04-20

**What this closes off:** Nothing significant.

---

### CONSTRAINT-11 — Need-to-Contact frequency measured in days

**Decision:** All purchase frequency calculations use days as the unit. `contact_frequency_days` column stores an integer number of days.

**What it means in practice:** Manual frequency overrides entered by the salesperson are in days. Auto-calculated frequency averages are in days. UI displays "every X days" — not weeks or months.

**Who decided and when:** Builder (D8 approval in @plan Phase 1), 2026-04-20

**What this closes off:** Nothing. Days is the most granular and flexible unit.

---

### CONSTRAINT-12 — Invoice generates from completed, uninvoiced orders only

**Decision:** The Generate Invoice panel shows only orders with `status = 'completed'` AND `invoice_id IS NULL` AND `requested_delivery_date` within the selected billing month.

**What it means in practice:** Pending, scheduled, cancelled, and already-invoiced orders never appear in the invoice generation panel — even if selected. The server action re-validates this before creating the invoice.

**Who decided and when:** Builder (D5 approval in @plan Phase 1), 2026-04-20

**What this closes off:** Invoicing future (scheduled/pending) orders requires a separate flow — not in scope.

---

### CONSTRAINT-13 — Customer hard-delete requires zero order history

**Decision:** `deleteCustomer` rejects whenever the customer has any orders, regardless of status. The `orders.customer_id` FK is `onDelete: restrict` — order history (including completed + invoiced rows tied to invoices) must never be orphaned by a customer delete. To remove a customer with history, set status to `inactive` via the customer form's status toggle.

**What it means in practice:** `lib/actions/customers.ts` counts all rows in `orders` for the customer id; if count > 0 the action returns `{ error: 'Cannot delete a customer with order history. Set them to Inactive instead.' }`. The Delete button in `CustomerForm` surfaces that error inline inside `DeleteCustomerDialog`. The Task 14 plan acceptance wording ("succeeds when only completed/invoiced orders") is superseded by this constraint — that wording conflicted with the data model's FK semantics.

**Who decided and when:** Builder (Option A approval during Task 14), 2026-04-20

**What this closes off:** There is no way to hard-delete a customer that has any order history. If data removal is ever needed (e.g. GDPR-style right-to-erasure), it would require either a DB-level admin operation or a dedicated archival/anonymization flow — neither is in scope.

---

### CONSTRAINT-14 — CQ-01 exemption for JSX-rendering React components

**Decision:** React function components whose body is dominated by a JSX `return` block may extend to **80 lines maximum** (the CQ-01 carve-out already granted to security/validation functions), rather than the default 50-line cap. The exemption applies only when (a) the function is a React component — it takes props and returns JSX — AND (b) the non-JSX logic in its body (hooks, handlers, local helpers) totals ≤ 50 lines. Logic-dense functions (non-component, or components where the procedural body exceeds 50 lines without JSX) remain bound by the 50-line cap.

**What it means in practice:** When a component renderer hits 50 lines, first extract sub-components for any JSX branch that owns its own state or is reused; but do not fragment JSX that is locally cohesive just to hit the 50-line number. The cap rises to 80 lines only when the overflow is JSX, not logic. Non-component functions (server actions, utilities, hooks) stay bound at 50.

**Who decided and when:** Builder (via `@code-review` fix-all for Task 14), 2026-04-20

**What this closes off:** Nothing meaningful. The underlying CQ-01 intent — "a function that does one thing is testable" — is preserved because the logic-dense portion still has to fit in 50 lines. This only acknowledges that declarative JSX is not equivalent to procedural code for the purpose of cognitive complexity budgeting. Consistent with the existing codebase (CustomerList.tsx main at 91 lines and CustomerContactCard.tsx main at 58 lines — both shipped post-M1 code review with no rework).

### CONSTRAINT-15 — PO model v2: drop `pending`, treat `invoiced` as a sub-state of `completed`

**Decision:** The PO state machine has four states: `scheduled` → `completed` → (auto on invoice) `invoiced`, plus `cancelled` as an off-ramp from `scheduled`. The `pending` state is gone. `invoiced` is a sub-state of "delivered" — every place the app counts/lists/aggregates "completed" orders (volume averages, last-sale date, contact-frequency calculation, completed-order count, "Completed" filter tab on the orders table, period-completed count on the dashboard), the SQL filter is `status IN ('completed', 'invoiced')`. The single exception is `getInvoiceableOrders`, which stays strict (`status = 'completed' AND invoice_id IS NULL`) — invoiced rows must never re-enter the invoice generation panel.

**What it means in practice:**
- Manual transitions allowed by `updateOrderStatus`: `scheduled → completed`, `scheduled → cancelled`. Nothing else.
- `OrderStatusActions` renders only "Mark as Complete" + "Cancel Order" (both shown on `scheduled`; nothing on terminal states).
- `OrderStatusBadge` has 4 styles, no `pending` variant.
- Orders filter tabs: `All | Scheduled | Completed | Cancelled`. The "Invoiced" tab is gone; the "Completed" tab matches both completed and invoiced rows.
- Dashboard hero card shows two numbers: `openCount` (live `status='scheduled'` count, period-agnostic) and `completedInPeriodCount` (status IN completed/invoiced AND `requested_delivery_date` in selected period).
- Dashboard "Open Orders" widget shows scheduled orders (renamed from "Pending Orders").
- Auto-complete-on-date-passed is **not** implemented — manual mark-complete only (free-tier no-cron limitation, see decision below).

**Who decided and when:** Builder (Bundle D approval), 2026-04-22

**What this closes off:** Adding back a `pending` ("supplier-confirmed but not delivered") substate without a schema migration. The `0004_drop_pending_status.sql` migration removed the enum value and rewrote any existing pending rows to scheduled.

---

### CONSTRAINT-16 — `requested_delivery_date` nullable + auto-set on Mark Complete

**Decision:** The `orders.requested_delivery_date` column is nullable. New orders may be created without a delivery date (the form field is optional). When `updateOrderStatus(id, 'completed')` is called on an order whose `requested_delivery_date` is NULL, the action atomically sets the date to `CURRENT_DATE` via `sql\`COALESCE(requested_delivery_date, CURRENT_DATE)\`` in the same UPDATE statement. Pre-set dates are not touched.

**What it means in practice:**
- New-order form: "Requested Delivery Date" label says "(optional)"; submitting empty stores NULL
- Tables/detail views show "—" when null
- All sorts on `requested_delivery_date` use `NULLS LAST`
- Period-window queries (Need-to-Contact frequency, completed-in-period count, customer order history windows) naturally exclude NULL-dated rows because `WHERE date >= start` is false for NULL — acceptable behaviour because undated rows shouldn't be in any time window
- `getInvoiceableOrders` requires a date in the billing month — undated completed orders won't appear in invoice generation until the salesperson adds a date via Edit
- Mark-as-Complete on an undated order picks up today's date automatically — no extra prompt; if the actual delivery was earlier, the salesperson can edit the date afterward

**Who decided and when:** Builder (Bundle E3 approval), 2026-04-22

**What this closes off:** Reverting to a NOT NULL constraint on this column would require a backfill strategy for any rows that ended up with NULL. Acceptable trade-off for the data-entry flexibility the salesperson asked for.

---

### CONSTRAINT-17 — Invoice model v3: one per month, all customers, no status, overwrite via modal

**Decision:** The invoice model is restructured at the schema and behaviour level:

1. **One invoice per calendar month** covers every completed PO across every customer for that month. The `customer_id` column on `invoices` is dropped (migration `0007`). Per-customer invoice generation is no longer possible.
2. **No status field.** The `status` column on `invoices` and the `invoice_status` enum are dropped (migration `0007`). There is no draft/paid lifecycle. The "Mark as Paid" action is gone.
3. **Overwrite confirmation.** When `createInvoice` is called for a billing month that already has an invoice and `overwrite: false`, the action returns `{ code: INVOICE_EXISTS_CODE, existingInvoiceNumber }` instead of erroring. The client surfaces an `OverwriteInvoiceDialog`. Confirming re-calls `createInvoice` with `overwrite: true`, which deletes the existing invoice (its orders detach back to `status='completed'`, `invoice_id=null`) and creates a fresh INV-#### with the current eligible POs.
4. **Per-row checkboxes preserved** as a manual-exclusion override (e.g. disputed PO).
5. **Ledger is a flat chronological list** sorted by `billing_month DESC`, then `invoice_number DESC`. No filter pills.
6. **Existing per-customer invoices** in the DB lose their `customer_id` value when migration `0007` runs — historical drill-down is preserved through the invoice → PO → customer chain (orders still hold `customer_id`).

**What it means in practice:**
- Generator panel: just a billing-month picker (no customer dropdown), the eligible-PO checklist, and the Create Invoice button
- Click Create on a month with an existing invoice → modal: "INV-XXXX already covers this month — overwrite?"
- Overwriting generates a new INV-#### number (the deleted invoice's number is retired forever — acceptable for an internal draft-only invoice system; not safe for systems that emit formal sequential invoices to external parties)
- Invoice detail header is just `{invoice_number}` + `{billing_month}`. PO rows table includes a Customer column per row
- `getInvoiceableOrders` no longer accepts a `customerId` parameter

**Who decided and when:** Builder (Bundle H approval), 2026-04-22

**What this closes off:** Per-customer invoice generation. Adding it back requires a schema migration to re-introduce `customer_id` and a backfill strategy. Adding back a draft/paid distinction requires re-adding the enum + column. Both are real architectural work — should not be reverted without a fresh assumptions pass.

---

### CONSTRAINT-18 — PO Multi-Combo wide-row schema (Feature 9)

> **Pricing clause superseded by Feature 10 (2026-07-25):** per-combo unit pricing was added and `price` is now a derived total. The qty-schema, edit-lock, and atomic-completion parts of this constraint still stand. Authority for pricing is now PRD Feature 10.

**Decision:** Each PO row holds quantities for any combination of the 6 fixed (size × type) options (CONSTRAINT-09) via 6 typed integer columns on `orders`: `qty_275_recon`, `qty_275_rebot`, `qty_275_new`, `qty_330_recon`, `qty_330_rebot`, `qty_330_new` (all `INTEGER NOT NULL DEFAULT 0`). Replaces the prior single-combo model (`container_size` + `container_type` + `quantity`). The `price` column is a **derived** total = Σ(qty × per-combo unit price) via 6 nullable `unit_price_*` columns (Feature 10 — supersedes the original "no per-unit pricing" clause). Still no global pricing-settings table and no manual total override. Mark Complete remains atomic at the PO level — all combos in a PO ship together. Edit lock: when a PO's status is `invoiced` or `cancelled`, qty + price changes are rejected by `updateOrder`; other field edits (notes, address, delivery date, backhaul, pickup_only) are still permitted. Salespeople must use the existing revert flow (FB-08) to bring the PO back to `scheduled` before adjusting quantities or price.

**What it means in practice:**
- `db/schema/orders.ts` defines the 6 qty cols. Migration `0008_po_multi_combo.sql` performs the schema change + lossless backfill of existing single-combo rows.
- `container_size` + `container_type` PostgreSQL enum types remain orphaned in `pg_type` after migration `0008` (intentional — they'll be dropped in a later cleanup migration once all TS code stops referencing them).
- All 4 PO list surfaces (orders table, dashboard Open Orders widget, customer Order History rows, invoice detail PO rows) render the consistent `275 | 330` totals + compact `B` backhaul tag pattern.
- Empty cells render as em dash `—` in display contexts (orders table, PO detail grid, etc.).
- Validation: client + server both enforce sum of 6 qty cells > 0 with error message `"At least one quantity is required."`. Per-cell ≥ 0 integers, capped at 100,000.
- Customer Volume Overview formula stays as "avg per PO that included this combo" — `AVG(qty_X) FILTER (WHERE qty_X > 0 AND status IN ('completed', 'invoiced'))`. Multiple combos per PO contribute to multiple combo averages, which is correct under the new model.
- Reusable `<QtyGrid>` component at `components/shared/QtyGrid.tsx` handles both display (read-only number or em dash) and input (controlled numeric inputs) modes for the 2×3 grid; consumed by OrderForm and OrderDetail.
- `lib/actions/orders.validation.ts` sibling file holds Zod schemas + helpers (Platform-Native Rule — `'use server'` files export async only).

**Who decided and when:** Builder (Q1–Q7 confirmations during `@cpo` consultation), 2026-04-24

**What this closes off:** Reverting to single-combo POs would require dropping 6 cols + restoring 3 cols + back-mapping rows where multi-combo data exists (lossy by definition — a PO with 3 non-zero cells can't collapse to a single combo without manual disambiguation). Adding per-unit pricing requires either re-introducing 6 unit-price cols on each PO + a settings table OR a separate price-list model — explicitly rejected during brainstorm; reopening requires fresh assumptions. Adding partial fulfillment / per-combo state machine is a separate architectural change (per-cell status would multiply the state-transition logic 6×) — not in scope.

---

### CONSTRAINT-19 — Production date is separate from the delivery promise (Feature 11)

**Decision:** The build day is its own nullable column, `production_date`, on `orders`. The Production Calendar reads and writes **only** `production_date` (plus `production_sort_index` for intra-day sequence) and must never write `requested_delivery_date` — that column stays the customer-facing promise, editable only in the Orders tab.

**A card's position on the calendar IS its `production_date`.** Nothing is derived at read time. `production_date IS NULL` means one thing only: the order has no production date, so it belongs in the unscheduled callout — irrespective of any delivery date it carries. The two dates are separate entities; a delivery date is guidance for scheduling, not a fact about when something will be built, and production may legitimately fall *after* it when work slips.

The delivery date is used **once**, at order creation, to seed a starting `production_date` of `prevBusinessDay(requested_delivery_date)` so a new PO lands on the calendar without anyone dragging it there. That is a stored value, written once. Adding a delivery date to an existing undated order does **not** place it — that stays a deliberate act. `prevBusinessDay` is **Sundays-only** — no holiday calendar exists or is planned — so Mon and Sun delivery dates both resolve to the prior Saturday, and no production date can fall on a Sunday. **Order *field* editing is still not available from the calendar** — quantities, prices, customer, address and the delivery promise are all Orders-tab-only. The popup writes exactly three things: the `same_day_delivery` flag, the `backhaul` flag, and the PO's status.

> **Revised 2026-07-27 (Feature 12, Tasks 64–66).** This clause previously read "the card popup is read-only apart from the `same_day_delivery` toggle." That is no longer true. The calendar is now a limited *write* surface, deliberately:
> - **Two pill toggles** in the popup — `backhaul` and `same_day_delivery` — both permitted on `invoiced`/`cancelled` orders, since CONSTRAINT-18's edit lock covers only qty and price.
> - **The full status block** (`OrderStatusActions`, unforked from the Orders tab): Mark as Complete + Cancel Order on `scheduled`, Revert to Scheduled on the other three.
> - **Order creation** via `+ Add order → Add Purchase Order`, which opens the standard `OrderForm` in a right drawer without leaving `/calendar`.
>
> What has *not* changed: the calendar still never writes `requested_delivery_date`.

> **Revised 2026-07-27**, after the first browser review. The original design derived a card's position with `COALESCE(production_date, prevBusinessDay(requested_delivery_date))` at read time, which meant `Remove from calendar` did not remove anything — a card with a delivery date bounced straight back to a derived day. It also left a defaulted card visually indistinguishable from a deliberately placed one. Migration `0011` materialised the derived value into the column so the derivation could be deleted without moving a single card.

> **Revised 2026-08-17 (Task 88).** The business week is now **Mon–Sat**, not Mon–Fri. Saturday is a full production day with its own column: `isBusinessDay` excludes Sunday only, `prevBusinessDay(monday)` returns Saturday, and a Monday delivery date therefore seeds a Saturday `production_date`. Sunday remains excluded and is still rejected on write. The 176px column width is unchanged and columns still never shrink, so a full week no longer fits 1024px — the strip scrolls instead, which was the builder's explicit choice over narrower columns. Historic Friday-dated rows were not migrated; no DB constraint existed to change.

**What it means in practice:**
- Migration `0010` adds `production_date` (`date` NULL), `same_day_delivery` (`boolean NOT NULL DEFAULT false`), `production_sort_index` (`integer` NULL). RLS on `orders` unchanged (CONSTRAINT-05).
- `prevBusinessDay` lives in `lib/dates.ts` alongside `DB_DATE_FORMAT` and is the single source of the business-day rule — no inline date math in components.
- **There is no placement rule to keep in sync any more.** The former requirement — that `effectiveProductionDate` (TypeScript) and `EFFECTIVE_PRODUCTION_DATE` (SQL) stay verified-equal, or a card would be filtered into one column and drawn in another — **no longer applies.** Both were deleted on 2026-07-27. `prevBusinessDay` survives in `lib/dates.ts`, called from exactly one place: `defaultProductionDate` in `lib/actions/orders.internal.ts`, at order creation. Queries and components read `production_date` directly.
- **The calendar range filter is a bare column comparison** (`o.production_date >= from AND <= to`), so `orders_production_date_idx` can serve it. The previous `COALESCE(...)` form was not sargable and forced a sequential scan — logged as **FI-02**, now moot.
- **`getCalendarOrders` returns `production_date`.** There is no `effective_production_date` — the field was dropped with the derivation. `groupRowsByDay` keys cards on `production_date` directly.
- **The no-Sunday invariant is enforced on write, never on read.** The Task 52 server actions reject a Sunday `production_date` (they rejected Saturday too until Task 88); Read paths pass a stored `production_date` through verbatim. Relocating a stored date on read would hide a data bug; throwing on read would take down the whole calendar over one row.
- Once `production_date` is explicitly set, a later change to `requested_delivery_date` does **not** move the card, and nothing flags the divergence.
- The calendar shows every order with `status <> 'cancelled'`; `completed` and `invoiced` render dimmed and non-draggable but keep their sequence slot.
- The unscheduled set is exactly `status <> 'cancelled' AND production_date IS NULL` and drives the top-right callout, its dropdown, and every per-day `+` list. A delivery date does not put an order on the calendar. No active order may be invisible: it is either on a day or in the callout, never neither.
- `Remove from calendar` nulls both production columns and the order **leaves the calendar** for the unscheduled callout, whatever its delivery date. Dragging a card onto the callout does exactly the same thing, and so does tapping the callout while a card is armed on touch (Task 68) — three entry points, one operation.
- **Changing a delivery date never moves a card, and nothing flags the divergence.** It cannot move it: position is stored, not computed. A promise can therefore shift out from under a placed card silently — including to a date earlier than the build day. This is accepted, deliberately: production scheduling is the salesperson's decision, and the calendar is checked daily. A flag for it was built and removed on 2026-07-27; the builder's call was that the indicator is not worth its cost.
- Mutations use server actions + `revalidatePath` like every other write (CONSTRAINT-02) — no optimistic-only client state.
- The `/calendar` screen is exactly one viewport tall and **never scrolls as a page** on any device; only the week strip and individual day columns scroll. Layout priority when space is short is fixed: never scroll the page → keep text legible (80px card floor) → show 4 cards. Card height is `clamp(80px, calc(25vh - 70px), 104px)` and all its inner metrics interpolate off it, so the visible count is a design target the card size serves rather than a consequence of a hardcoded card.
- Columns are a fixed 176px and **never shrink to fit**. Six of them no longer fit iPad landscape's 1024px — the documented primary device (`design-decisions.md` → Audience) — and as of Task 88 that is the accepted trade: the week strip already scrolls horizontally, and the builder chose scrolling over narrower columns.
- `@dnd-kit/core` + `@dnd-kit/sortable` are client-only and fall under **CONSTRAINT-03** alongside `framer-motion` and `recharts`. The addition itself is recorded in **FB-12**.
- **The dashboard production widget reads `production_date` directly**, exactly as the calendar does, over the next two *business* days via `productionWidgetDays`. `nextBusinessDay` is strictly after its argument, so the window seeds with today when today is a business day — which since Task 88 includes Saturday, making the Friday window Fri + Sat rather than Fri + Mon.
- The calendar popup renders `<QtyGrid mode="display">` with `unitPrices` supplied, so it matches PO detail's `qty / $unit` cells (Feature 10). Cards never show prices.
- **A new PO created from a day column takes that day as its `production_date`, whatever delivery date the form carries.** Clicking `+` on a day is a deliberate placement and outranks the creation-time default — `defaultProductionDate` applies only when no override is passed. The no-Sunday invariant is still enforced on write, by the same shared Zod rule the calendar actions use (`lib/actions/dates.validation.ts`), not a second copy.
- **Cancelling from the calendar is one-way.** The calendar filters `status <> 'cancelled'`, so a cancelled card leaves the board and the popup closes. Reverting it is only possible from the Orders tab. Completing is not one-way: the card dims in place, keeps its sequence slot, and can be reverted from the popup.
- **The popup closes on any status change, not only cancel.** `CalendarLayout` holds the selected order's *id* and re-derives the row from props on each render, so a stale snapshot can never be displayed after a write (CONSTRAINT-02 — no optimistic-only state).
- **Every write that can move, hide or restyle a card revalidates `/calendar` and `/dashboard`.** This covers `createOrder`, `updateOrder`, `updateOrderStatus` and `revertOrderToScheduled` — the calendar and the dashboard widget are now second and third consumers of writes that used to belong to the Orders tab alone. None of the status/creation actions did this before Feature 12; `updateOrder` joined in the 2026-07-27 code-review fix pass (an edit can change backhaul, the delivery date, or the quantity mix, all drawn on cards).

**Who decided and when:** Builder (Q1–Q17 clarification pass + design review), 2026-07-26. Position-is-the-column revision: Builder, 2026-07-27, during the first browser review.

**What this closes off:** Making the calendar edit delivery dates directly would collapse the two concepts and silently rewrite customer commitments — reopening requires deciding what happens to production placement when a promise moves. Holiday awareness needs a `holidays` table plus an admin UI and holiday-aware date math everywhere `prevBusinessDay` is used. **Saturday production was the cheap half of this and was taken in Task 88** — it cost one predicate, because the layout was already fixed-width and scrolling. Sunday production is the remaining half and is not symmetrical: it would leave no non-production day at all, so the week-boundary logic in `startOfBusinessWeek` and `businessWeekDays` — which currently relies on Monday being the one unambiguous anchor — would need rethinking rather than widening. A phone layout needs a second, narrow single-day layout rather than a responsive tweak of the six-column grid. Allowing the page itself to scroll would remove the constraint that forces the card-scaling system to exist.

---

### CONSTRAINT-20 — Dev and prod share one Supabase project (no sandbox exists)

> **LIFTED 2026-10-12, with conditions.** A local Supabase CLI stack (Docker) is now the dev database; `.env` points at it (`127.0.0.1:54321` / `:54322`). Boundary verified: a marker row written locally was confirmed absent from prod by the builder. **Conditions that keep it lifted:**
> - `.env` holds **local values only**. No prod string lives anywhere on the dev machine — prod's only home is Vercel. Never recreate a local prod env file (`.env.prod.reference` is gitignored in case one reappears).
> - `db:seed`, `db:wipe` and `db:migrate-local` refuse any non-localhost `DATABASE_URL` (`db/local-guard.ts`). Do not remove the guard.
> - Local schema is built by `npm run db:migrate-local` replaying `db/migrations/`. Do not copy migrations into `supabase/migrations/`. Prod migrations remain manual (Supabase SQL editor).
> - Local has no session pooler and different storage, so **CONSTRAINT-28 is only exercised in prod**.
> - Write-flow QA and seeding are now allowed **against local only**. Setup and rationale: `docs/local-dev-setup.md`.
>
> The original decision below is kept for history.

**Decision:** Confirmed by the builder 2026-07-28: local dev, the deployed production app, the seed/wipe scripts, and the admin auth user all point at the **same** Supabase project and database. There is no dev environment. Until a separate dev project (or local Supabase CLI stack) exists:

- **Never run `npm run db:wipe` or `npm run db:seed`** — they destroy/pollute the user's production data.
- **QA and automation must never execute write flows** (create/edit/cancel/convert/upload). Read-only and unauthenticated verification only. The 2026-07-28 QA run held this line: zero records written.
- Any script or agent instruction that assumes a sandbox is wrong by default.

**Who decided and when:** Builder confirmation, 2026-07-28, mid-QA (halted the logged-in browser phase). Dev-sandbox setup (local Supabase CLI stack recommended) deferred by the builder.

**What this closes off:** Automated QA of write flows, safe seeding, and destructive testing of any kind — until a dev environment exists. Lifting this constraint = creating the separate environment and repointing `.env.local`, the scripts, and `docs/testing-setup.md` at it.

---

### CONSTRAINT-21 — Order delivery addresses are text snapshots; `customer_addresses` is the saved list

**Decision:** Feature 14 (2026-07-28). Three binding rules:

- **`orders.delivery_address` stays a plain text snapshot — never an FK** to `customer_addresses`. Editing or deleting a saved address must never rewrite historical orders. Any future feature that wants "update the address everywhere" is a new product decision, not a refactor.
- **`customer_addresses` is the single source for saved addresses**: `UNIQUE (customer_id, address)` (migration `0013`), MRU via `last_used_at` (bumped on order use; NULL on plain adds), all writes via upsert `ON CONFLICT` — no check-then-insert.
- **`customers.default_delivery_address` is DEPRECATED**: the column remains in the DB but no app code may read or write it. Dropping it is a future migration, only after Feature 14 has proven itself live over time.

**Who decided and when:** Builder approved the design 2026-07-28 (brainstorm → Feature 14 spec); snapshot rule and deprecation were explicit in the approved plan.

**What this closes off:** Address-book edits can never fix a typo on past orders (by design — order history is immutable evidence). The deprecated column blocks reuse of that name until the drop migration lands.

---

### CONSTRAINT-22 — `sms:`/`mailto:` hrefs are built by `lib/contact-links.ts`, never inline

**Decision:** Task 75 (2026-08-09). No component may construct a `sms:`, `mailto:` or `tel:` href from a database column. Every such href comes from `lib/contact-links.ts` (`smsHref` / `mailtoHref`), and the guard on whether to render the link at all is `isPresent` / `isReachable`, never truthiness.

**Why this is a constraint and not a preference:** three separate screens — the calendar card popup, `CustomerContactCard` and `LeadDetail` — each built these hrefs inline from raw column text. The contact columns are hand-typed free text with nothing validating them, so a stored `john@acme.com?cc=someone` opened a mail draft with a silent CC that looked entirely normal on the way out. Two of the three sites were found only because a reviewer was explicitly told to assume another existed. The rule exists so the fourth site is never written.

**Practical impact:** a new screen showing a phone or email adds an import, not a template literal. Both sides of the mailto `@` are percent-encoded; phones are sanitized to digits plus an optional leading `+`, with a trailing extension stripped. Bad stored data lands the user in the messaging app with a visibly wrong recipient rather than blocking the action — deliberate, so the operator can correct it by hand.

**Who decided and when:** Builder, 2026-08-09, on the `@code-review` finding (CQ-07) and its confirmation pass.

**What this closes off:** per-screen href formatting. A screen that wants a prefilled subject or body adds a parameter to the shared builder, where it can be encoded once, rather than composing its own URL.

---

### CONSTRAINT-23 — Viewport heights are `svh`, never `vh` or `h-screen`

**Decision:** 2026-08-09. Any height sized against the viewport uses `svh` — `min-h-svh`, `h-[calc(100svh-…)]`, `max-h-[90svh]`, `25svh` in CSS. `vh` units, `h-screen` and `min-h-screen` are banned in this codebase.

**Why this is a constraint and not a preference:** on iOS Safari and Chrome, `100vh` is the *large* viewport — the height the page would have with the browser chrome hidden. Every authenticated route was sized against it, so on the iPad each screen opened toolbar-height too tall and needed one nudge of scroll before it settled into the no-scroll layout CONSTRAINT-19 requires. The failure is invisible on desktop and unreachable from jsdom: the suite was fully green with every screen broken on the primary device. One `min-h-screen` on a future shell or page reintroduces it silently, because a `100vh` floor anywhere in the ancestor chain keeps the document scrollable no matter what the routes below it do.

**Practical impact:** a new full-height screen writes `min-h-svh`. `overscroll-behavior: none` on `body` (globals.css) is part of the same fix — with nothing to scroll, iOS still rubber-bands the document, which reads as "there is more below" on a screen where there never is. Inner scrollers are unaffected.

**`svh` and not `dvh`, deliberately:** `dvh` tracks the toolbar as it hides and shows, re-laying out the grid mid-gesture. `svh` is a fixed number that never overflows. The accepted cost is toolbar-height of dead space if the bar does collapse.

**Who decided and when:** Builder, 2026-08-09, on the iPad scroll report; fix `d3314d7`, device-verified the same day.

**What this closes off:** `h-screen`/`min-h-screen`, the Tailwind idiom most examples reach for first. Nothing enforces this yet — it is a documented rule, not a lint check.

---

### CONSTRAINT-24 — `'use server'` marks intended public endpoints only; helper modules never carry it

**Decision:** 2026-08-09. A file gets `'use server'` if and only if every async function it exports is meant to be callable from the browser and guards itself with `assertAuthenticated()`. Helper modules — validation, constants, internal query/transaction pieces — never carry the directive, no matter which folder they live in or how obviously "internal" their name and header make them look.

**Why this is a constraint and not a preference:** the directive *is* the publication mechanism. There is no module-private scope inside a `'use server'` file, so a helper colocated there is a second public endpoint, and a comment saying "private, not part of the public actions API" is decoration with no runtime effect. `lib/actions/leads.convert.ts` carried exactly that header, and the directive, and three exports that called `assertAuthenticated()` zero times — against 23/23 guarded exports across every other action module. One of them, `findDuplicateCustomer`, runs `ilike` on its argument: `'%'` returns a customer, and prefix-refining enumerates the list. This repo is public, so endpoint addresses are derivable from source rather than guessable.

**Why it was never live, and why that is not reassurance:** Next only mints an action ID for a `'use server'` export reachable from the client graph. Nothing client-side imported that file, so the build manifest held 25 IDs and none were these three. The protection was a property of the import graph — invisible, unenforced, asserted by no test, and one client-side import from disappearing.

**Practical impact — the check that actually satisfies this is export-level, not file-level:** enumerate every exported async function in every module whose first line is `'use server'`, count `assertAuthenticated()` calls against that number, and reconcile the total against the action-ID count in `.next/server/server-reference-manifest.json`. Comparing the *list of files* against last time passes while a file inside it exports three unguarded functions — that is precisely how the 2026-08-02 audit missed this (see FI-11).

**Current baseline (2026-08-10, after Feature 15 / Tasks 76–81):** **11 directive-bearing modules, 30 exports, 28 guarded** + `signIn`/`signOut` unguarded by design, reconciling exactly against **30 manifest action IDs**.

**Re-verified 2026-08-12 against a real `next@16.3.0` Turbopack build** — first time the manifest half of this reconciliation was actually inspected rather than assumed. `.next/server/server-reference-manifest.json` holds exactly 30 action IDs across 9 route groups, matching the 30 source exports. No internal helper is exposed. **Next 16 did not change the action surface.**

The 11 modules are `lib/actions/`: `auth.ts` (2), `calendar.ts` (4), `customer-addresses.ts` (3), `customers.ts` (3), `invoices.ts` (1), `leads.ts` (5), `orders.ts` (3), `orders.revert.ts` (1), `pickups.ts` (3), `pickups.calendar.ts` (2), `support.ts` (3). Feature 15 added `pickups.ts` and `pickups.calendar.ts` — 5 exports, 5 guards — and its four helper siblings (`pickups.validation.ts`, `pickups.calendar.validation.ts`, and the query/component modules) correctly carry no directive.

**Count the guards by call site, not with `grep -c`.** `leads.ts`, `invoices.ts` and `support.ts` each define their own local `assertAuthenticated` rather than importing `auth.guard`'s, so a raw match count reads one higher than the number of guarded exports in each of those three files. The reconcilable number is *guarded exports*, not *occurrences of the identifier*.

**Rebuilding the manifest needs a clean `.next`.** With `next dev` running, `next build` aborts at "Collecting page data" with `PageNotFoundError: /_document` and leaves the previous, partial manifest in place — a dev server only compiles routes on demand, so that stale file undercounts (21 IDs when this was last checked). Stop the dev server, or build a copy of the tree with its own `.next`, before trusting the number.

**Who decided and when:** Builder, 2026-08-09, on `@security` finding M-01; fix `3b27ed7`, verified against a fresh build.

**What this closes off:** nothing — helpers stay directly importable from their server-side callers, which is all they ever needed. Nothing enforces this automatically; like CONSTRAINT-22 and 23 it is a documented rule, and the realistic way it reopens is someone adding the directive back for consistency with the file's neighbours. The comment now at the top of `leads.convert.ts` exists for that reader.

---

### CONSTRAINT-25 — Pickups are a separate entity; the calendar hosts two independent lists

**Decision:** 2026-08-10. Tote collections live in their own `pickups` table, never as a flag or a status on `orders`. They carry no price, no number, no document and no invoice link, and appear on no revenue or dashboard surface. `orders.pickup_only` is renamed `customer_collects` — it always meant "the customer collects their order", never "we collect empties".

**Why a table and not a discriminator column:** a shared table would make `price` nullable and put a silent obligation on every existing query — invoices, revenue, dashboard widgets, customer history — to filter pickups out. One missed `WHERE` mixes unpriced rows into money. Dev *is* prod here (CONSTRAINT-20), so that failure lands on live data with no sandbox to catch it. A separate table pays an explicit duplication cost on the calendar instead of an implicit correctness risk everywhere else.

**Practical impact on the calendar:** each day column holds two independently-ordered lists — orders above, pickups below. Every drag payload carries a `group` discriminator, droppable ids are composed (`pickups:${dateKey}`), collision detection is pre-filtered by group, and long-press arm mode resolves insertion indices within a group only. A card can never move between groups. Visibility is **one control with three views** — Orders, Pickups, Both — opening on Orders and resetting every visit; nothing in this app persists client state, and one enum is not the reason to start.

**Amended 2026-09-18 (Task 93): visibility is three views on one control, not two independent toggles.** The header originally carried a `PillToggle` per group, whose four combinations included one — **both off** — that every day column rendered a `ColumnListsHidden` message for. That state was permitted by the control, never designed: nobody opens a calendar to see no cards, and a fourth stop would be tapped *through* on every loop of a cycling control. The pair also cost roughly twice the header width, on a bar with none to spare (CONSTRAINT-19). The state is now unrepresentable rather than merely discouraged: `CalendarView` is an enum of three, and `visibilityForView` derives the two booleans the columns read, so `showOrders` and `showPickups` can never both be false. `ColumnListsHidden` and its branch are gone. **Pickups remain unsearchable** — search matches on `po_number`, which pickups do not have, which is why the box says "Search orders" on its face rather than explaining itself after a confusing miss.

**The two unscheduled callouts are not symmetric, and that is the point.** The orders callout is shown in **every** view; the pickups callout only while pickups are drawn. "No active order may be invisible" is an invariant of the orders half — an order with no production date is work someone must act on, so hiding that count behind a view toggle would let a salesperson work all day without learning the backlog exists. Choosing a view says which *cards* to draw; it is not a request to stop being told about outstanding work. Pickups carry no equivalent obligation, and the header has no horizontal room to spare at iPad landscape width (CONSTRAINT-19).

**The two lists split the column height 50/50 by an explicit flex basis, not by `flex-1`.** Both regions carry `COLUMN_LIST_FLEX` (`components/calendar/DayColumnParts.tsx`), and its class contract is pinned by a regression test across all four population combinations. `flex-1` alone means a zero basis, and under `border-box` a flex base cannot fall below the region's own padding — so a `p-8` empty state started 48px ahead of a `p-2` populated list and only the leftover was shared. The two lists then rendered at visibly unequal heights. Any third list, or any padding change on either region, must keep an explicit basis.

**Pickup cards are amber-surfaced with plain dark text.** They do not use the green-275 / blue-330 size-and-type color language, because a pickup has no type dimension and the two card kinds must never be misread for each other at card font size.

**Dates:** a pickup has one date, and it *is* the calendar placement — dragging rewrites it. This is deliberately unlike CONSTRAINT-19, where the delivery promise and the production date are separate and the calendar never touches the promise. Null means unscheduled.

**Who decided and when:** Builder, 2026-08-10, in the pickups brainstorm; planned as Tasks 76–81.

**What this closes off:** tote-balance accounting (delivered minus collected), linking a pickup to the order whose totes are coming back, and actual-vs-requested counts on completion. All three need columns this table does not have; adding them later is a migration, not a refactor. Reopening the shared-table question means auditing every existing order query for a missing filter.

---

### CONSTRAINT-26 — Cross-vertical primitives live in `components/shared/`; verticals never import from each other

**Decision:** 2026-08-10. The moment a component, hook or style constant has a second consumer in a different vertical, it moves to `components/shared/` and **both** verticals import it from there. A vertical folder (`components/orders/`, `components/pickups/`, `components/customers/`, `components/leads/`, `components/support/`, `components/calendar/`) never imports from another vertical folder, and never re-exports a shared primitive on another vertical's behalf.

**Why this is a constraint and not a preference:** the failure is invisible, not loud. `components/pickups/pickupFormSchema.ts` reached `FORM_INPUT_CLASS` through `components/orders/orderFormSchema`, which re-exported it from a third place — two hops through a vertical with no stake in the value. Nothing was broken, and nothing would have been until someone editing the orders form moved that line, at which point the pickups form changes appearance with no diff that names it. The same shape produced the address picker: `AddressSelect` was correct code sitting in the wrong folder, and the cheap way to give pickups a saved-address dropdown was to import it out of `components/orders/`. Ownership by "who built it first" is not ownership.

**The shape a shared primitive takes:** the shared file is parameterised by a form-agnostic bridge (`AddressFieldBridge` for the address picker), and each vertical keeps a thin adapter holding only what genuinely differs — `components/orders/AddressSelect.tsx` and `components/pickups/PickupAddressSelect.tsx` are both adapters over `components/shared/AddressSelect.tsx`. Extracting the union of two call sites into one component with a mode flag is the wrong extraction; extracting the shared body and adapting the edges is the right one.

**Known unreconciled drift — do not describe this as universal.** `components/leads/leadFormSchema.ts` and `components/support/NewTicketFormFields.tsx` each declare their own `FORM_INPUT_CLASS`, and it is a *different* string (`bg-muted rounded-lg border-0 …` vs `rounded-md border border-border bg-card …`) — a third copy that merely happens to match. `components/shared/formFields` is the primitive orders / pickups / customers / `AddressSelect` use, not the one every form uses. Folding leads and support in is a visual change to two live screens and needs its own task.

**Who decided and when:** Builder, 2026-08-10, on the address-picker request; the two-hop re-export was removed in the same pass.

**What this closes off:** nothing functionally. Nothing enforces it automatically — like CONSTRAINT-22, 23 and 24 it is a written rule. The realistic way it reopens is a new vertical copying an import path from an older one; the check is a grep for `components/<vertical>/` imports inside a different vertical.

---

## CONSTRAINT-29: ~~touch and drag disagree by one on same-day downward moves, and that is accepted~~ — **SUPERSEDED by Task 91**

**Status:** Superseded 2026-08-17 — the asymmetry no longer exists. Task 91 removed the `- 1` at `components/calendar/armPlacement.ts:96`, so touch and drag now compute **identical** indices for the same move under one rule: *the armed card takes the tapped card's position; empty space appends to the bottom*. A parity test asserts the two paths agree, so this cannot silently reopen. The decision below was correct on the evidence it had; what changed is that the same `- 1` turned out to also make the most natural same-day gesture — tap the card directly below — a silent no-op, which reclassified it from a tolerable inconsistency to a defect. See `docs/plan.md` → Task 91.

**Retired universally, not just for card targets (revised 2026-08-17, `@qa` NON-BLOCKING-3).** This note originally held only for **card** targets. One asymmetry outlived Task 91: on a drop or tap on a list's *empty space* — a **column** target — touch discounted the moved card from its own column's rendered count (`cardCount - 1`) while drag read `cardCount` verbatim, so the already-last card released below the cards resolved to one past its own index and slipped through the no-op guard, burning a write, a revalidation and a `router.refresh()` that moved nothing. `resolveDropTarget` in `components/calendar/calendarDnd.ts` now makes the identical correction, and the parity suite in `armPlacement.test.ts` was widened from card targets to **both** target kinds. **Touch and drag now agree for every target a card can be released or tapped onto.** No landing position changed — same-day, the server's `[0, siblings]` clamp already absorbed the off-by-one into last place; what changed is that the pointless write is no longer issued.

**Original text preserved below — the history matters.**

**Decision:** ~~2026-08-17, after Task 89. Surfaced by `@code-review`, put to the builder, and explicitly left alone.~~

**The behaviour.** ~~Moving a card *down* within one day column, where the column is `[A, X, B, C]` and `X` is moved onto `C`:~~

- ~~**Touch** (long-press to arm, tap `C`) → `[A, B, X, C]`. `X` lands **above** `C`.~~
- ~~**Drag** (mouse, drop on `C`) → `[A, B, C, X]`. `X` lands **below** `C`, taking `C`'s old slot.~~

~~Upward moves agree; only the downward case diverges. The `- 1` at `components/calendar/armPlacement.ts:96` is the whole of the difference.~~

**Why it exists:** ~~the two specs disagree, and each gesture faithfully implements a different one. `docs/prd.md` Feature 11's touch paragraph says "tap another card to insert at its position (cards below shift down)", which is the touch behaviour. `armPlacement.ts`'s own comment says the card "takes the tapped card's place", which is the drag behaviour. Neither gesture is a bug against the sentence it was written from. It has been this way since Task 68 and went unnoticed until a code-review pass compared them.~~

**Why it is not a Task 89 defect.** ~~Both gestures send a valid *post-removal splice index*, which is exactly the contract `placeAndRenumber` expects, so dense renumbering is correct under either. This is a question of which index the client chooses to send, not of what the server does with it.~~ (This part remains true and is why Task 91 needed no server change.)

**Why drag is the one that cannot move.** ~~`@dnd-kit` renders a live preview of the landing slot while you drag. Changing what drag commits would make the preview show one thing and the write do another — a worse defect than the inconsistency. Touch has no preview, so touch is the only side that *could* change. The builder declined: the gestures are used on different devices, they are never mixed in one session, and the touch path is the builder's daily muscle memory.~~ (Still true, and Task 91 honoured it: touch moved, drag did not.)

**What this closes off:** ~~nothing structural — it is one `- 1` to delete, plus a reworded PRD sentence and one test at `components/calendar/__tests__/armPlacement.test.ts:87`. Revisit if a second user appears (CONSTRAINT-04's single-user premise is what makes "different devices, different habits" acceptable), or if the two gestures ever become available on the same device in the same session.~~ Task 91 did exactly that, for a different reason than "a second user appeared".

**Do not re-raise this as a bug.** ~~It was found, analysed and decided. A future `@code-review` or `@qa` pass that rediscovers the asymmetry should cite this constraint and move on.~~ **Reversed.** The asymmetry is gone; a `@code-review` or `@qa` pass that finds touch and drag disagreeing by one has found a **regression** against Task 91 and should raise it.

---

## CONSTRAINT-28: `DATABASE_URL` is always the Session pooler string

**Decision:** 2026-08-16, after a live production outage during the database-password rotation.

**The three strings.** Supabase's **Connect** dialog offers Direct connection, Transaction pooler and Session pooler. Only the last works for this project:

| Tab | Host / user | Verdict |
|---|---|---|
| Session pooler | `aws-0-[region].pooler.supabase.com:5432`, user `postgres.[project-ref]` | **the only correct one** |
| Transaction pooler | same host, port `6543` | loses/misroutes query responses on this project (FB-20) — hangs every authenticated page |
| Direct connection | `db.[project-ref].supabase.co:5432`, user `postgres` | **structurally impossible from Vercel** |

**Why Direct connection can never work, as opposed to merely being discouraged:** that hostname resolves over **IPv6 only**, and Vercel's runtime is IPv4-only. The failure is `getaddrinfo ENOTFOUND` — DNS, before a TCP connection is opened and long before any credential is checked. No password, pool size or timeout setting changes this. It is not a configuration to tune; it is a wrong address.

**Why this became a constraint rather than a note.** The Direct string is what Supabase's generic "Database → Connection string (URI)" path yields, and `README.md` pointed a fresh setup straight at it until 2026-08-16. The outage it caused was hard to read from the symptoms: the build went green (the variable is read at runtime only), and `/login` kept working throughout — auth runs through Supabase Auth on the publishable key and never touches `DATABASE_URL`. Every authenticated page 500'd while the login page looked healthy, which reads as a page bug, not a connection-string one.

**Two tells that the wrong string is in place:** the host is `db.…supabase.co` instead of `…pooler.supabase.com`, and the username is a bare `postgres` instead of `postgres.[project-ref]`. **Swapping only the hostname does not fix it** — the username differs too.

**Recorded in three places on purpose:** here, `docs/architecture.md` → Database connection, and a three-row table in `README.md` beside the env-var list, because the README is what a fresh setup actually follows.

---

## CONSTRAINT-27: `agentRules: false` stays in `next.config.js`

**Decision:** 2026-08-12, during Task 84. Next.js 16 generates `AGENTS.md` and `CLAUDE.md` into the repo root on **every** `next dev` run and every `next build`, unless `agentRules: false` is set. It stays set.

**Why this is a constraint and not a preference:** the generated `CLAUDE.md` contains only `@AGENTS.md`, i.e. Next intends `AGENTS.md` to hold what `CLAUDE.md` holds — which is precisely why SEC-07 lists `CLAUDE.md` as never-commit. Two consequences follow. First, this project's agent context is owned by the SBDev framework; a file the build tool rewrites on every invocation would silently compete with it and win, because it is regenerated after every edit. Second, `AGENTS.md` was not in `.gitignore`, so the default behaviour dropped an untracked file into the repo root on every build — one `git add -A` from being committed to a public repo.

**Belt and braces, because one config line is a thin defence:** `AGENTS.md` was also added to `.gitignore` (2026-08-12) so that losing this config line during a future upgrade or merge does not immediately become a committed file. **Both must stay.** The `.gitignore` entry is not a reason to drop the config line — an untracked file that regenerates on every build still pollutes `git status` and still overwrites `CLAUDE.md`.

**Verified:** both files deleted, `agentRules: false` set, then a clean `npm run build` and a `next dev` run — neither file returned.

**What this closes off:** nothing, and it is one line to reverse. If Next's agent rules are ever wanted, delete the line **and** add `AGENTS.md` to the SEC-07 review — do not do only the first.

---

## CONSTRAINT-30: Screenshots of the running app are production data

**Decision:** 2026-08-17, after two QA screenshots of the live customer book landed untracked in the root of a public repository.

**Any** screenshot, HAR file, console dump or network log captured from a running session is production data and must be written only to a gitignored artifact path. This is not a preference about tidiness; it is the same rule as "never commit `docs/testing-setup.md`", applied to the file types that rule forgot to name.

**Why it follows from CONSTRAINT-20.** Local dev runs against the production database. There is no sandbox, so there is no such thing as a screenshot of test data — every image of a running screen is an image of the real customer book. A HAR or a network log is worse, because it carries the response bodies rather than a picture of them.

**What actually happened.** SEC-07's sensitive-file list names *documents* — `testing-setup.md`, `session-log.md`, `qa-report.md`, `security-report.md`, `framework-issues.md`, the env files. It does not name images. On 2026-08-17 two `@qa` browser screenshots (`qa-calendar-ipad-landscape.png`, `qa-calendar-pickups.png`) were written to the **repo root**, outside the gitignored `.playwright-mcp/`, where no rule covered them. They show nine real customer records with company names, PO numbers, container specs and delivery dates. This repository is public.

**This paragraph originally listed those nine company names in full, and that was itself a leak** — caught by `@security` on re-verification the same day as H-02. `constraints.md` is a tracked file, so the names reached `origin/main` and were served publicly before being removed. **The rule that follows is the one this document exists to record: describe production data, never quote it.** An incident write-up is not exempt from the constraint it is describing — if anything it is the likeliest place to break it, because quoting the leaked values feels like rigour.

**Resolved by a scoped history rewrite, with an accepted residual (2026-08-17).** A `git filter-repo` pass over the last three commits removed the names from history, followed by a force-push. Only three SHAs changed; `c0016de` and every older commit is untouched, so no commit reference elsewhere in these docs broke. Verified afterwards: zero commits in any ref contain the names, and the live public file no longer serves them.

**The residual, accepted by the builder rather than escalated.** The orphaned pre-rewrite commit remains retrievable from `raw.githubusercontent.com` by its 40-character SHA — GitHub keeps unreachable commits until it garbage-collects, and only GitHub Support can purge them on request. The builder declined to open that ticket. **This is a decision, not an oversight: do not re-raise it as a finding.** What it means in practice: the data is absent from the UI, search, clones and every reachable ref, and is reachable only by requesting the orphaned commit directly.

**Correction (2026-08-17, `@security` L-09).** This paragraph first said the orphan was retrievable "only by someone who already holds the 40-character hash." That was wrong twice over. `raw.githubusercontent.com` resolves a **7-character abbreviation** identically — same response, same bytes — and the commit messages recording this incident **publish that abbreviation in the public log**. The true precondition is therefore "reads the commit history", not "independently obtained a hash". The accepted risk is unchanged, because the exposed data is unchanged and was accepted knowingly; what was wrong was the sentence describing it. **Recording it because this is the third claim in one day — after a code comment, a test, and a documented-but-unbuilt mitigation — that was written confidently and was not true. The residual is accepted. The reasoning offered for accepting it must still be accurate.** Making the repository private would close it outright. That was recorded here as "not available"; **see the correction immediately below — the reason given was wrong, and the constraint is softer than stated.**

**Correction (2026-09-18).** The sentence above said Vercel's free tier "cannot build a private repo owned by a different GitHub account than the deploying one." The repo was made private on 2026-09-18 and the next deploy was indeed blocked — but not for that reason, and the block is fixable for free.

Vercel's actual message: *"The deployment was blocked because the commit author did not have contributing access to the project on Vercel. The Hobby Plan does not support collaboration for private repositories."* The check is on the **commit author's email**, not on who owns the repository. Every commit in this project is authored by one address, and that address is not a verified email on the Vercel account that owns the deployment — so on a private repo, Hobby reads every commit as coming from a collaborator and refuses. While the repo was public the check did not apply, which is why 96 commits deployed without anyone noticing the mismatch.

Two consequences worth holding on to:

- **Going public again does not retry a blocked build.** The push that was refused stays refused; a new deployment has to be triggered, either from the Vercel dashboard or by a fresh commit. On 2026-09-18 an empty commit (`954c4b4`) was used for exactly this.
- **The free fix is one setting, and it has not been done.** Adding the commit-author address as a verified email on the owning Vercel account (Account Settings → Emails) makes Hobby treat those commits as the owner's own, and private stops mattering. Until then, every deploy from a private repo is blocked, and shipping means going public, pushing, and going private again.

The residual described above is therefore a **choice** between an accepted data exposure and a manual step per deploy — not the forced hand this entry originally described. The exposure itself is unchanged and remains accepted; what was wrong was the claim that closing it was impossible. **This is the second time a sentence in this entry has had to be corrected for asserting something that was not checked** (see the `@security` L-09 correction above, on the same paragraph). The pattern the entry exists to record applies to the entry itself.

**Neither file was ever committed** — `@security` caught them as H-01 the same day, and `git log --all` confirms they have never entered history. That is the only reason this is a constraint rather than an incident. One `git add -A`, the most common way anything gets committed here, would have published the customer book permanently: removing it afterwards needs a history rewrite and a force-push that invalidates every clone, and anything already fetched is gone for good.

**What is in place now.** `.gitignore` carries `qa-*.png` and `*.screenshot.png` alongside the existing `.playwright-mcp/` entry, specifically to catch the root-save path that caused this. Those two patterns are a net under the rule, not the rule itself — a screenshot named anything else still lands untracked in a public repo, so the binding requirement is the artifact path, and the ignore entries exist for the case where someone forgets it.

**The framework half of this is not fixed.** `@qa` Phase 2 mandates browser screenshots as evidence and says nothing about where they may be written; that gap is logged as FI-06 strike 2 and can only be fixed in `sbdev-private`, which this machine cannot push. Until it is, the discipline lives here.

**What this closes off:** nothing. Screenshots are still taken and still viewable locally — they live in a folder git refuses to track. The cost is one extra thought per capture, against a failure that is irreversible.

---

## Summary Table

| # | Decision | Practical impact | Decided by | Date |
|---|---|---|---|---|
| 01 | Stack locked | No library substitutions | @plan | 2026-04-20 |
| 02 | Server Actions, no REST API | All mutations via `lib/actions/` | @plan | 2026-04-20 |
| 03 | Framer Motion = 'use client' | All animated files are client components | @plan | 2026-04-20 |
| 04 | Fixed dummy email auth | ADMIN_EMAIL env var, never in source or UI | @plan | 2026-04-20 |
| 05 | RLS on all tables | Every new table needs RLS migration | @plan | 2026-04-20 |
| 06 | Private storage, signed URLs only | No public bucket URLs ever | @plan | 2026-04-20 |
| 07 | $0 hosting constraint | No paid services | Builder | 2026-04-20 |
| 08 | ~~Invoice: Draft + Paid only~~ | **Superseded by 17** | Builder | 2026-04-20 |
| 09 | Container types are fixed enums | No configurable product types | Builder | 2026-04-20 |
| 10 | Status via action buttons | No status dropdown on orders | Builder | 2026-04-20 |
| 11 | Frequency unit = days | `contact_frequency_days` is an integer | Builder | 2026-04-20 |
| 12 | Invoice: completed + uninvoiced only | No pending/scheduled in invoice panel | Builder | 2026-04-20 |
| 13 | Customer hard-delete needs zero orders | Archive via Inactive toggle instead | Builder | 2026-04-20 |
| 14 | CQ-01 exemption for React JSX renderers | Component fn body up to 80 lines if non-JSX logic ≤ 50 | Builder | 2026-04-20 |
| 15 | PO model v2: drop `pending`, fold `invoiced` into `completed` for stats | 4 states; "completed" filter matches both | Builder | 2026-04-22 |
| 16 | Optional delivery date + auto-set on Mark Complete | NULL allowed; COALESCE to CURRENT_DATE on completion | Builder | 2026-04-22 |
| 17 | Invoice v3: one per month, no status, no customer, overwrite via modal | Drops `customer_id` + `status` columns; chronological ledger | Builder | 2026-04-22 |
| 18 | PO multi-combo wide-row schema + atomic completion + edit lock | Drops `container_size`/`container_type`/`quantity`; adds 6 qty cols; total `price` user-entered (no per-unit pricing); invoiced/cancelled blocks qty/price edits | Builder | 2026-04-24 |
| 19 | Production date separate from delivery promise | Adds `production_date`/`same_day_delivery`/`production_sort_index`; calendar never writes `requested_delivery_date`; Sundays-only business-day math, no holidays (Saturday became a production day in Task 88, 2026-8-17); calendar popup writes flags + status (Feature 12, no longer read-only); page never scrolls, card scales to keep 4 visible; `@dnd-kit` added under CONSTRAINT-03 | Builder | 2026-07-26 |
| 20 | Dev and prod share one Supabase project | Never run `db:wipe`/`db:seed`; no automated write-flow testing until a dev environment exists | Builder | 2026-07-28 |
| 21 | Order addresses = text snapshots; `customer_addresses` = saved list | `orders.delivery_address` never becomes an FK; saved-address writes are `ON CONFLICT` upserts against `UNIQUE (customer_id, address)`; `default_delivery_address` deprecated — no app code touches it, drop deferred | Builder | 2026-07-28 |
| 22 | `sms:`/`mailto:` hrefs come from `lib/contact-links.ts` | No component builds a contact href inline; `isPresent`/`isReachable` gate rendering, never truthiness; both sides of the mailto `@` encoded | Builder | 2026-08-09 |
| 23 | Viewport heights are `svh`, never `vh`/`h-screen` | `100vh` is iOS's chrome-hidden viewport, so `vh` opens every screen a toolbar too tall; `min-h-svh` / `h-[calc(100svh-…)]`; `overscroll-behavior: none` on `body`; `svh` not `dvh` to avoid mid-scroll relayout | Builder | 2026-08-09 |
| 24 | `'use server'` marks intended public endpoints only | Helper modules never carry the directive — it is the publication mechanism, and there is no private scope inside such a file; the check is export-level (every exported async fn, guard-counted, reconciled against the build manifest's action IDs), never a file-list diff; baseline **11 modules / 30 exports / 28 guarded / 30 action IDs** as of 2026-08-10, after Feature 15 | Builder | 2026-08-09 |
| 25 | Pickups are a separate table, never a flag on `orders` | No price/number/invoice; absent from all revenue + dashboard surfaces; `pickup_only` renamed `customer_collects`; calendar day columns hold two independently-ordered lists with a `group` discriminator on every drag payload; no cross-group moves; the two lists split column height by an explicit basis (`COLUMN_LIST_FLEX`), never bare `flex-1`; toggles default Orders-on/Pickups-off and reset each visit; amber cards, plain text; `pickup_date` is the placement and drag rewrites it | Builder | 2026-08-10 |
| 26 | Cross-vertical primitives live in `components/shared/` | A second consumer in a different vertical forces the move; no vertical imports from or re-exports on behalf of another; shared file is parameterised by a bridge, each vertical keeps a thin adapter; known drift — leads and support each hold their own, different `FORM_INPUT_CLASS` | Builder | 2026-08-10 |
| 27 | `agentRules: false` stays in `next.config.js` | Next 16 otherwise writes `AGENTS.md` + `CLAUDE.md` into the repo root on every dev run and build; the generated `CLAUDE.md` is just `@AGENTS.md`, so it competes with the SBDev framework for agent context and regenerates after every edit. `AGENTS.md` also added to `.gitignore` as a second line of defence — **both stay**, the ignore entry is not a licence to drop the config line | Builder | 2026-08-12 |
| 28 | `DATABASE_URL` is always the **Session pooler** string | Supabase's Connect dialog offers three and only one works here. **Direct connection** (`db.[ref].supabase.co:5432`, user `postgres`) is IPv6-only and Vercel's runtime is IPv4-only — it fails as `getaddrinfo ENOTFOUND` before auth is ever attempted, and it took prod down on 2026-08-16. **Transaction pooler** (`:6543`) misroutes query responses on this project (FB-20). Correct string: `aws-0-[region].pooler.supabase.com:5432`, user `postgres.[project-ref]`. Swapping only the hostname is not enough — the username differs too. `ENOTFOUND` means wrong string, not wrong password | Builder | 2026-08-16 |
| 29 | ~~Touch and drag disagree by one on same-day **downward** moves — accepted, not a bug~~ | **Superseded by Task 91.** The `- 1` at `armPlacement.ts:96` was deleted, so touch and drag now compute identical indices under one rule — *the armed card takes the tapped card's position; empty space appends to the bottom* — and a parity test guards it. The same `- 1` also made "tap the card directly below" a silent no-op, which is what reclassified it from accepted inconsistency to defect. Drag was still not the side that moved. **Extended to column targets 2026-08-17** (`@qa` NON-BLOCKING-3): drag now discounts the dragged card from its own column's `cardCount` too, so parity holds **universally**, not for card targets only, and the parity suite covers both target kinds | Builder | 2026-08-17 |
| 30 | Screenshots of the running app are production data | Because local dev runs against prod (CONSTRAINT-20), **any** screenshot, HAR, console dump or network log from a running session is production data and must be written only to a gitignored artifact path. SEC-07's list names documents, not images, so two `@qa` screenshots showing nine real customers with PO numbers and dates landed in the root of this **public** repo, uncovered by any rule — never committed, caught as `@security` H-01 the same day, but one `git add -A` from being permanent. `.gitignore` now also carries `qa-*.png` and `*.screenshot.png` as a net under the rule. Framework half unfixed — see FI-06 strike 2 | Builder | 2026-08-17 |
| 31 | CONSTRAINT-07 amended: one metered API, PO extraction only | A single metered LLM API is permitted **solely** to extract fields from purchase-order documents, billed via OpenRouter with ZDR enforced account-wide (A-08) and the per-request `zdr` flag hardcoded `true`; any other use of the key is a new decision. Paid Supabase plan, Redis, external CDN and all other paid infrastructure remain forbidden, and hosting stays Vercel free + Supabase free. **No cost figure is pinned** — A-13's ~$0.0015/PO, ~$8/year at 15/day is cited as the basis, not a limit; dated follow-up to write the measured spend in after the first few days of real use. Unblocks Task 98 | Builder | 2026-10-07 |
| 32 | CONSTRAINT-05's table count is non-numeric by design | The line read "all 8 database tables" while the database held 10 and `architecture.md` said 10 — a security-relevant claim that had gone stale, and would have gone stale again at 12 with Feature 16's `inbound_emails` + `inbound_pos`. A hand-maintained count has already drifted three times. CONSTRAINT-05 now says **"every table in the database, without exception"**, which cannot go stale, and points at `architecture.md`'s per-table list (reconciled to 12 the same day) as the authoritative enumeration. To get a number, count `ENABLE ROW LEVEL SECURITY` across `db/migrations/*.sql` — do not trust prose | Builder | 2026-10-07 |
| 33 | The processed marker is `(UIDVALIDITY, UID)`, persisted as a watermark | **No sender-controlled string ever gates ingestion again.** The marker is two integers the IMAP server assigns; the run persists the highest finished UID and the next run asks for `UID FETCH <watermark+1>:*`, so handled mail is never re-listed. `message_id` is demoted to a **label — not UNIQUE, never branched on**; content dedupe stays with `content_hash`. The post-parse re-check is restored as a second layer. **`readOnly: true` stays** — `\Seen` was rejected as a marker (needs a write connection, not transactional with the DB write) and is held in reserve, not in v1. Time-based selection rejected: IMAP `SINCE` is date-granular, so "since last run" means "since today", and late delivery below a time watermark is a silently missed PO. Replaces the `Message-ID` marker that produced five `@security` findings in five rounds — `imapflow` and `mailparser` normalise that header differently (encoded-words, NBSP folding, duplicate headers), so an unmatchable marker was re-downloaded every run until `MAX_MESSAGES_PER_RUN` starved real POs. Closes the open High at the root and folds in L-15. `lib/ingest/identity.ts` (234 lines) loses its reason to exist. **Decided before Task 99 is written**, because Task 99 builds the watermark (moved there from the trigger task, 2026-10-12); tables are empty, so dropping UNIQUE is free today and a data migration after any row is written | Builder | 2026-10-09 |
| 34 | No silent skips — every email terminates in a visible row | **A wrong reading is acceptable; a missed ingestion with no notification is not.** Governing rule for Feature 16, ranking above extraction accuracy, cost and queue tidiness. The asymmetry is recoverability: a mis-read field is reviewed and corrected before it becomes an order, while a vanished email is invisible on every screen and surfaces days later as a customer chasing an order never entered. Every message must end as an ingested PO or a review row carrying a reason — unreadable format, failed extraction, `refuse`, `no_po_found`, or a storage/DB failure all land in the queue. **"Ignore" is never a terminal state**: any existing drop path (unlisted MIME type, empty candidate set) must write a review row instead. This is also what makes CONSTRAINT-33's watermark safe — advancing past a message is only acceptable because the message is already durably visible | Builder | 2026-10-11 |
| 35 | PDFs and images are read identically — visually, by the model | No local text extraction **for reading** and no "has a text layer?" branch in the extraction path. **Amended 2026-10-12 (FB-40):** a PDF's embedded text layer may be read **solely to verify the model's source quotes** (Task 101) — never sent to the model, never used to populate a field. Images and scanned PDFs have no text layer and their quotes are `unverifiable`, which is not a check failure. **PDFs are rendered to one image per page first**, because the model is sent images; that renderer is a PDF rasteriser, not the image re-encoder carrying M-02's advisories. **Images pass through unmodified** — no resize, re-encode or conversion; the provider scales its own side and `COMPRESSED_IMAGE_MAX_DIMENSION` / `_QUALITY` are cost optimisations, not correctness requirements, which is what keeps `sharp` out of the dependency tree. **`ACCEPTED_MIME_TYPES` becomes an exact list — `application/pdf`, `image/jpeg`, `image/png`, `image/webp` — never a wildcard**: today's `image/*` admits SVG (M-01) and maps `.heic`/`.tiff` (`ingest.constants.ts:150-151`) which the model cannot read. Unsupported formats are review rows per CONSTRAINT-34, asking for a re-send | Builder | 2026-10-11 |
| 36 | The provider is verified for images only, never for native PDF | Verified in the `Test_openrouter` project: `src/pdf_images.py` renders each page via `pypdfium2` and sends base64 PNG data URLs, and extraction read the fields correctly across the sample set. **That test never sent a PDF as a PDF**, so native PDF passthrough through OpenRouter is unproven and must not be assumed — the render step is load-bearing, not a workaround to optimise away later. Anything that drops it needs its own verification against the real provider first | Builder | 2026-10-11 |
