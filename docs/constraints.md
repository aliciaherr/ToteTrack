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

### CONSTRAINT-03 — Component boundary rule (Framer Motion = 'use client')

**Decision:** Any component that imports from `framer-motion` or `recharts` must have `'use client'` at the top of the file. Server components fetch data only — no animation or chart imports.

**What it means in practice:** The pattern is always: server component (fetch data, pass as props) → client component (render with animation). Never import Framer Motion in a file without `'use client'`. Violating this causes runtime errors.

**Who decided and when:** @plan (A-04 resolution), 2026-04-20

**What this closes off:** Nothing — this is a correctness requirement, not an option.

---

### CONSTRAINT-04 — Single-user auth: fixed dummy email pattern

**Decision:** Supabase Auth is configured with one user: email = value of `ADMIN_EMAIL` env var (set to `admin@totetrack.app`), password = salesperson's chosen password. The login UI shows a password field only — email is never visible.

**What it means in practice:** The `signIn` server action always uses `process.env.ADMIN_EMAIL` as the email. Never hardcode `admin@totetrack.app` in source code. Never show, mention, or expose the email in the UI. `ADMIN_EMAIL` must be set in `.env.local` and Vercel environment variables.

**Who decided and when:** @plan (A-02 resolution), 2026-04-20

**What this closes off:** Adding multiple users without a significant auth architecture change. This is single-user by design.

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
