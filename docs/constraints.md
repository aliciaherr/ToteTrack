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

**Decision:** Row Level Security is enabled on all 8 database tables. RLS is never disabled, bypassed, or relaxed.

**What it means in practice:** Every `db/migrations/` file that creates a new table must also include the RLS enable + policy statements. Do not use the Supabase service role key to bypass RLS — use it only when there is no authenticated session context (e.g., server-side admin operations during setup).

**Who decided and when:** @cto (via @plan), 2026-04-20

**What this closes off:** Nothing meaningful. RLS is additive.

---

### CONSTRAINT-06 — Supabase Storage for files, private buckets only

**Decision:** All uploaded files (PO documents, support attachments) are stored in private Supabase Storage buckets and served exclusively via server-generated signed URLs (1-hour expiry).

**What it means in practice:** Never make a bucket public. Never return a raw storage path as a download URL. Every file download must go through `getPODocumentSignedUrl` or equivalent — which requires an active auth session.

**Who decided and when:** @cto (via @plan), 2026-04-20

**What this closes off:** Files cannot be shared via link without the app. Storage bucket changes require updating all upload/download code.

---

### CONSTRAINT-07 — $0 hosting — Vercel free + Supabase free tiers only

**Decision:** The app must run entirely on Vercel free tier + Supabase free tier. No paid services.

**What it means in practice:** Do not introduce any paid infrastructure (paid Supabase plan, Redis, external CDN, third-party services). If a feature requires paid infrastructure, it is out of scope until explicitly approved by the builder.

**Who decided and when:** Builder (kickoff), 2026-04-20

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

The delivery date is used **once**, at order creation, to seed a starting `production_date` of `prevBusinessDay(requested_delivery_date)` so a new PO lands on the calendar without anyone dragging it there. That is a stored value, written once. Adding a delivery date to an existing undated order does **not** place it — that stays a deliberate act. `prevBusinessDay` is **weekends-only** — no holiday calendar exists or is planned — so Mon, Sat and Sun delivery dates all resolve to the prior Friday, and no production date can fall on a weekend. **Order *field* editing is still not available from the calendar** — quantities, prices, customer, address and the delivery promise are all Orders-tab-only. The popup writes exactly three things: the `same_day_delivery` flag, the `backhaul` flag, and the PO's status.

> **Revised 2026-07-27 (Feature 12, Tasks 64–66).** This clause previously read "the card popup is read-only apart from the `same_day_delivery` toggle." That is no longer true. The calendar is now a limited *write* surface, deliberately:
> - **Two pill toggles** in the popup — `backhaul` and `same_day_delivery` — both permitted on `invoiced`/`cancelled` orders, since CONSTRAINT-18's edit lock covers only qty and price.
> - **The full status block** (`OrderStatusActions`, unforked from the Orders tab): Mark as Complete + Cancel Order on `scheduled`, Revert to Scheduled on the other three.
> - **Order creation** via `+ Add order → Add Purchase Order`, which opens the standard `OrderForm` in a right drawer without leaving `/calendar`.
>
> What has *not* changed: the calendar still never writes `requested_delivery_date`.

> **Revised 2026-07-27**, after the first browser review. The original design derived a card's position with `COALESCE(production_date, prevBusinessDay(requested_delivery_date))` at read time, which meant `Remove from calendar` did not remove anything — a card with a delivery date bounced straight back to a derived day. It also left a defaulted card visually indistinguishable from a deliberately placed one. Migration `0011` materialised the derived value into the column so the derivation could be deleted without moving a single card.

**What it means in practice:**
- Migration `0010` adds `production_date` (`date` NULL), `same_day_delivery` (`boolean NOT NULL DEFAULT false`), `production_sort_index` (`integer` NULL). RLS on `orders` unchanged (CONSTRAINT-05).
- `prevBusinessDay` lives in `lib/dates.ts` alongside `DB_DATE_FORMAT` and is the single source of the weekday rule — no inline date math in components.
- **There is no placement rule to keep in sync any more.** The former requirement — that `effectiveProductionDate` (TypeScript) and `EFFECTIVE_PRODUCTION_DATE` (SQL) stay verified-equal, or a card would be filtered into one column and drawn in another — **no longer applies.** Both were deleted on 2026-07-27. `prevBusinessDay` survives in `lib/dates.ts`, called from exactly one place: `defaultProductionDate` in `lib/actions/orders.internal.ts`, at order creation. Queries and components read `production_date` directly.
- **The calendar range filter is a bare column comparison** (`o.production_date >= from AND <= to`), so `orders_production_date_idx` can serve it. The previous `COALESCE(...)` form was not sargable and forced a sequential scan — logged as **FI-02**, now moot.
- **`getCalendarOrders` returns `production_date`.** There is no `effective_production_date` — the field was dropped with the derivation. `groupRowsByDay` keys cards on `production_date` directly.
- **The no-weekend invariant is enforced on write, never on read.** The Task 52 server actions reject a Saturday/Sunday `production_date`; Read paths pass a stored `production_date` through verbatim. Relocating a stored date on read would hide a data bug; throwing on read would take down the whole calendar over one row.
- Once `production_date` is explicitly set, a later change to `requested_delivery_date` does **not** move the card, and nothing flags the divergence.
- The calendar shows every order with `status <> 'cancelled'`; `completed` and `invoiced` render dimmed and non-draggable but keep their sequence slot.
- The unscheduled set is exactly `status <> 'cancelled' AND production_date IS NULL` and drives the top-right callout, its dropdown, and every per-day `+` list. A delivery date does not put an order on the calendar. No active order may be invisible: it is either on a day or in the callout, never neither.
- `Remove from calendar` nulls both production columns and the order **leaves the calendar** for the unscheduled callout, whatever its delivery date. Dragging a card onto the callout does exactly the same thing, and so does tapping the callout while a card is armed on touch (Task 68) — three entry points, one operation.
- **Changing a delivery date never moves a card, and nothing flags the divergence.** It cannot move it: position is stored, not computed. A promise can therefore shift out from under a placed card silently — including to a date earlier than the build day. This is accepted, deliberately: production scheduling is the salesperson's decision, and the calendar is checked daily. A flag for it was built and removed on 2026-07-27; the builder's call was that the indicator is not worth its cost.
- Mutations use server actions + `revalidatePath` like every other write (CONSTRAINT-02) — no optimistic-only client state.
- The `/calendar` screen is exactly one viewport tall and **never scrolls as a page** on any device; only the week strip and individual day columns scroll. Layout priority when space is short is fixed: never scroll the page → keep text legible (80px card floor) → show 4 cards. Card height is `clamp(80px, calc(25vh - 70px), 104px)` and all its inner metrics interpolate off it, so the visible count is a design target the card size serves rather than a consequence of a hardcoded card.
- Columns are 176px so a full Mon–Fri fits within iPad landscape's 1024px — the documented primary device (`design-decisions.md` → Audience).
- `@dnd-kit/core` + `@dnd-kit/sortable` are client-only and fall under **CONSTRAINT-03** alongside `framer-motion` and `recharts`. The addition itself is recorded in **FB-12**.
- **The dashboard production widget reads `production_date` directly**, exactly as the calendar does, over the next two *business* days via `productionWidgetDays`. `nextBusinessDay` is strictly after its argument, so the window seeds with today when today is a weekday.
- The calendar popup renders `<QtyGrid mode="display">` with `unitPrices` supplied, so it matches PO detail's `qty / $unit` cells (Feature 10). Cards never show prices.
- **A new PO created from a day column takes that day as its `production_date`, whatever delivery date the form carries.** Clicking `+` on a day is a deliberate placement and outranks the creation-time default — `defaultProductionDate` applies only when no override is passed. The no-weekend invariant is still enforced on write, by the same shared Zod rule the calendar actions use (`lib/actions/dates.validation.ts`), not a second copy.
- **Cancelling from the calendar is one-way.** The calendar filters `status <> 'cancelled'`, so a cancelled card leaves the board and the popup closes. Reverting it is only possible from the Orders tab. Completing is not one-way: the card dims in place, keeps its sequence slot, and can be reverted from the popup.
- **The popup closes on any status change, not only cancel.** `CalendarLayout` holds the selected order's *id* and re-derives the row from props on each render, so a stale snapshot can never be displayed after a write (CONSTRAINT-02 — no optimistic-only state).
- **Every write that can move, hide or restyle a card revalidates `/calendar` and `/dashboard`.** This covers `createOrder`, `updateOrder`, `updateOrderStatus` and `revertOrderToScheduled` — the calendar and the dashboard widget are now second and third consumers of writes that used to belong to the Orders tab alone. None of the status/creation actions did this before Feature 12; `updateOrder` joined in the 2026-07-27 code-review fix pass (an edit can change backhaul, the delivery date, or the quantity mix, all drawn on cards).

**Who decided and when:** Builder (Q1–Q17 clarification pass + design review), 2026-07-26. Position-is-the-column revision: Builder, 2026-07-27, during the first browser review.

**What this closes off:** Making the calendar edit delivery dates directly would collapse the two concepts and silently rewrite customer commitments — reopening requires deciding what happens to production placement when a promise moves. Holiday awareness needs a `holidays` table plus an admin UI and holiday-aware date math everywhere `prevBusinessDay` is used. Weekend production needs 6–7 columns and invalidates the no-weekend invariant. A phone layout needs a second, narrow single-day layout rather than a responsive tweak of the 5-column grid. Allowing the page itself to scroll would remove the constraint that forces the card-scaling system to exist.

---

### CONSTRAINT-20 — Dev and prod share one Supabase project (no sandbox exists)

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
| 19 | Production date separate from delivery promise | Adds `production_date`/`same_day_delivery`/`production_sort_index`; calendar never writes `requested_delivery_date`; weekends-only business-day math, no holidays; calendar popup read-only; page never scrolls, card scales to keep 4 visible; `@dnd-kit` added under CONSTRAINT-03 | Builder | 2026-07-26 |
| 20 | Dev and prod share one Supabase project | Never run `db:wipe`/`db:seed`; no automated write-flow testing until a dev environment exists | Builder | 2026-07-28 |
| 21 | Order addresses = text snapshots; `customer_addresses` = saved list | `orders.delivery_address` never becomes an FK; saved-address writes are `ON CONFLICT` upserts against `UNIQUE (customer_id, address)`; `default_delivery_address` deprecated — no app code touches it, drop deferred | Builder | 2026-07-28 |
