# Plan: ToteTrack

**Date:** 2026-04-20
**Status:** Approved — Phase 3 complete
**Approved by:** Builder (2026-04-20)
**Total tasks:** 90 (single file — well over threshold; a `docs/plan-index.md` split is overdue)

> Every task is one-shot-ready. A developer must be able to execute it without asking clarifying questions.
> Tasks with `**Specialist:**` fields require reading that skill before implementation — mandatory, not optional.
> Skill reads: `skills/ui-totetrack.md` before any UI work. `skills/db.md` before any DB work.

---

## Task 1: Project scaffold + install dependencies

**Files:**
- `package.json` — create
- `next.config.ts` — create
- `tailwind.config.ts` — create
- `tsconfig.json` — create
- `.env.example` — modify (verify all 5 vars present: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_APP_URL, ADMIN_EMAIL)

**Functions to implement:** None (config only)

**Acceptance criteria:**
- [x] `npm run dev` starts without errors on Next.js 14+ App Router
- [x] Dependencies installed: next, react, react-dom, @supabase/ssr, @supabase/supabase-js, drizzle-orm, drizzle-kit, postgres, tailwindcss, framer-motion, recharts, react-hook-form, @hookform/resolvers, zod, date-fns, lucide-react; shadcn/ui initialized via CLI with neutral base
- [x] TypeScript strict mode enabled in `tsconfig.json`
- [x] Tailwind configured: Inter font loaded via `next/font`, CSS variables for Industrial Slate — Primary `#007A8A`, Secondary `#475569`, Tertiary `#5C799B`, Neutral `#64748B`, card bg `#FFFFFF`, app bg `#F0F4F8`
- [x] [SEC-01] `.env.local` in `.gitignore`, `.env.example` has placeholder values only

**Tests required:** None (scaffolding)

**Depends on:** —

---

## Task 2: Database schema — Drizzle schema files + enums

**Files:**
- `db/schema/enums.ts` — create
- `db/schema/customers.ts` — create
- `db/schema/orders.ts` — create
- `db/schema/leads.ts` — create
- `db/schema/invoices.ts` — create
- `db/schema/support.ts` — create
- `db/schema/index.ts` — create (re-exports all)
- `db/index.ts` — create (Drizzle client init)
- `drizzle.config.ts` — create

**Functions to implement:** All 8 table definitions as Drizzle `pgTable`, all 9 enums as `pgEnum`

**Acceptance criteria:**
- [x] Enums: `po_status` (scheduled|pending|completed|cancelled|invoiced), `container_size` (275|330), `container_type` (rebottled|reconditioned|brand_new), `customer_status` (active|inactive), `lead_status` (hot|warm|cold|converted), `invoice_status` (draft|paid), `support_category` (bug|feature_request|question|other), `support_priority` (low|standard|high|critical), `ticket_status` (open|in_progress|resolved|closed)
- [x] Tables: customers, customer_contacts, orders, leads, lead_notes, invoices, support_tickets, support_attachments — full spec in `docs/data-model.md`
- [x] Every table has `id` (uuid, primaryKey, defaultRandom()), `created_at` (timestamptz, defaultNow()) — except `lead_notes` which has no `updated_at`
- [x] Foreign keys: customer_contacts→customers (cascade), orders→customers (restrict), orders→invoices (set null), leads→customers via converted_customer_id (set null), lead_notes→leads (cascade), support_attachments→support_tickets (cascade)
- [x] Unique constraints: `orders.po_number`, `invoices.invoice_number`
- [x] [SEC-01] `DATABASE_URL` read from environment variable only in `db/index.ts`
- [x] [CQ-01] No schema file exceeds 50 lines

**Tests required:**
- `db/schema` → `all 8 tables export without error from index.ts`
- `db/schema` → `foreign key relationships match the data model spec (docs/data-model.md)`

**Depends on:** Task 1
**Specialist:** @db

---

## Task 3: Supabase migrations + RLS policies + storage buckets

**Files:**
- `db/migrations/0001_initial_schema.sql` — create (generated via `drizzle-kit generate`)
- `db/migrations/0002_rls_policies.sql` — create (manual)
- `db/migrations/0003_storage_buckets.sql` — create (manual)

**Functions to implement:** None (SQL only)

**Acceptance criteria:**
- [x] `drizzle-kit generate` produces valid migration from schema without errors
- [x] RLS enabled on all 8 tables: `ALTER TABLE [table] ENABLE ROW LEVEL SECURITY`
- [x] RLS policy on each table: `CREATE POLICY "authenticated_access" ON [table] FOR ALL TO authenticated USING (true) WITH CHECK (true)`
- [x] Storage bucket `po-documents` created, private (not public)
- [x] Storage bucket `support-attachments` created, private (not public)
- [x] Storage RLS: authenticated users can INSERT and SELECT in both buckets
- [x] Unauthenticated query to any table returns 0 rows (RLS filters silently)
- [x] [SEC-01] No hardcoded project IDs or credentials in any migration file

**Tests required:**
- `migrations` → `apply cleanly on a fresh Supabase project with no errors`
- `RLS` → `unauthenticated Supabase client query returns empty result set`

**Depends on:** Task 2
**Specialist:** @db

---

## Task 4: Supabase client setup + middleware

**Files:**
- `lib/supabase/client.ts` — create
- `lib/supabase/server.ts` — create
- `middleware.ts` — create

**Functions to implement:**
- `createClient(): SupabaseClient` in `client.ts` — `createBrowserClient` from `@supabase/ssr`
- `createClient(): SupabaseClient` in `server.ts` — `createServerClient` from `@supabase/ssr` with `next/headers` cookies
- `middleware.ts` — calls `supabase.auth.getUser()` to refresh session on every request

**Acceptance criteria:**
- [x] `client.ts` uses `createBrowserClient` — safe for `'use client'` components; uses only `NEXT_PUBLIC_` vars
- [x] `server.ts` uses `createServerClient` with `cookies()` from `next/headers`
- [x] `middleware.ts` matcher excludes `_next/static`, `_next/image`, `favicon.ico`
- [x] [SEC-01] `SUPABASE_SERVICE_ROLE_KEY` only in `server.ts`, never in `client.ts` or any client component
- [x] [EH-01] `server.ts` throws with context if called without server context (no cookies available)

**Tests required:**
- `lib/supabase/client` → `createClient returns a SupabaseClient without throwing`
- `lib/supabase/server` → `createClient reads cookies without throwing in server context`

**Depends on:** Task 1

---

## Task 5: Auth — login page + session guard + server actions

**Files:**
- `app/(auth)/login/page.tsx` — create (server component)
- `components/auth/LoginForm.tsx` — create (`'use client'`)
- `lib/actions/auth.ts` — create
- `app/(app)/layout.tsx` — create (server component — session guard)

**Functions to implement:**
- `signIn(password: string): Promise<{ error: string | null }>`
- `signOut(): Promise<void>`
- `LoginForm()` — password input, submit, inline error display

**Acceptance criteria:**
- [x] `/login` renders: ToteTrack wordmark, single "Password" input (type=password), "Sign In" button — no email or username field visible
- [x] `signIn` calls `supabase.auth.signInWithPassword({ email: process.env.ADMIN_EMAIL, password })` — email never in UI or hardcoded in source
- [x] [SEC-01] `ADMIN_EMAIL` read from env var, not hardcoded
- [x] Wrong password → "Incorrect password. Please try again." inline, field NOT cleared
- [x] Empty submit → "Please enter your password." (client-side, no network call)
- [x] Network/unexpected error → "Unable to connect. Check your internet connection."
- [x] Success → redirect to `/dashboard` (server-side)
- [x] `app/(app)/layout.tsx`: unauthenticated request → redirect to `/login`
- [x] Authenticated user at `/login` → redirect to `/dashboard`
- [x] [EH-01] Unexpected Supabase errors logged with context; user sees connection error (not raw error)
- [x] [CQ-01] `LoginForm` < 50 lines

**Tests required:**
- `signIn action` → `correct password returns { error: null }`
- `signIn action` → `wrong password returns { error: "Incorrect password..." }`
- `LoginForm` → `empty submit shows validation error without network call`
- `app/(app)/layout` → `unauthenticated request redirects to /login`

**Depends on:** Task 4
**Specialist:** @ui-totetrack

---

## Task 6: App shell + nav drawer

**Files:**
- `app/(app)/layout.tsx` — modify (add AppShell wrapper)
- `components/shell/AppShell.tsx` — create (`'use client'`)
- `components/shell/TopBar.tsx` — create (`'use client'`)
- `components/shell/NavDrawer.tsx` — create (`'use client'`)

**Functions to implement:**
- `AppShell({ children })` — manages drawer state, renders TopBar + NavDrawer
- `TopBar({ onMenuClick })` — hamburger (≥44px), logo, search placeholder, bell, avatar
- `NavDrawer({ isOpen, onClose })` — Framer Motion slide-over, 6 nav items

**Acceptance criteria:**
- [x] Hamburger button: ≥44px touch target (min-w-[44px] min-h-[44px])
- [x] NavDrawer: `x: -280 → 0`, 200ms ease-out (Framer Motion `AnimatePresence`)
- [x] NavDrawer backdrop: simultaneous opacity 0 → 0.4 fade, 200ms ease-out
- [x] NavDrawer close: `x: 0 → -280` 150ms ease-in + backdrop fade to 0
- [x] Drawer closes on: nav item tap, backdrop click, Escape key
- [x] Hidden resting state: `AnimatePresence` with unmount (not just invisible)
- [x] Nav items: Dashboard (`/dashboard`), Customers (`/customers`), Orders (`/orders`), Leads (`/leads`), Invoices (`/invoices`), Support (`/support`) — each with lucide-react icon
- [x] Active item: `border-l-2 border-[#007A8A]` + font-medium — determined by `usePathname()`
- [x] `useReducedMotion()`: instant open/close, `AnimatePresence` still manages mount/unmount
- [x] [CQ-02] `NavDrawer.tsx` < 200 lines

**Tests required:**
- `NavDrawer` → `renders all 6 nav items with correct href values`
- `NavDrawer` → `onClose fires on backdrop click`
- `NavDrawer` → `onClose fires on Escape keydown`
- `NavDrawer` → `active item has teal left border for current pathname`

**Depends on:** Task 5
**Specialist:** @ui-totetrack

---

## Task 7: Dashboard layout + hero cards + stats query

**Files:**
- `app/(app)/dashboard/page.tsx` — create (server component)
- `components/dashboard/DashboardView.tsx` — create (`'use client'`)
- `components/dashboard/HeroCards.tsx` — create (`'use client'`)
- `db/queries/dashboard.ts` — create

**Functions to implement:**
- `getDashboardStats(period: 'monthly' | 'yearly'): Promise<DashboardStats>`
- `HeroCards({ stats: DashboardStats })`
- `DashboardView({ initialStats, ... })` — manages period toggle, triggers re-fetch on toggle

**Acceptance criteria:**
- [x] Page title "Command Overview", subtitle "Real-time logistics matrix."
- [x] Monthly/Yearly pill toggle (default Monthly), top-right of dashboard
- [x] Monthly: `totalInvoiced` = sum of invoices for current calendar month
- [x] Yearly: `totalInvoiced` = sum of invoices for current calendar year
- [x] Delta badge: `((current - prior) / prior) * 100`; green (positive), red-orange (negative); "—" when `priorPeriodInvoiced = 0` (no divide-by-zero)
- [x] Right card: pending count (large) + scheduled count (smaller), always current (not period-filtered)
- [x] [EH-01] `getDashboardStats` throws with context on DB failure

**Tests required:**
- [x] `getDashboardStats` → `monthly: returns sum for current calendar month only`
- [x] `getDashboardStats` → `yearly: returns sum for current calendar year only`
- [x] `getDashboardStats` → `delta = 0 (not NaN) when priorPeriodInvoiced = 0` (implemented as `deltaPercent = null`, rendered as "—")

**Depends on:** Task 6, Task 2
**Specialist:** @db (query), @ui-totetrack (UI)

**Status:** [x] Done (2026-04-22) — URL-driven period toggle via `?period=`; pill uses Framer Motion `layoutId` for the active-tab slide (matches Task 28 precedent). 16 new tests (324 → 340).

---

## Task 8: Need-to-Contact widget + SQL query

**Files:**
- `components/dashboard/NeedToContactWidget.tsx` — create (`'use client'`)
- `db/queries/dashboard.ts` — modify

**Functions to implement:**
- `getNeedToContactList(limit?: number): Promise<NeedToContactRow[]>` (default limit: 5)

**Query logic:** Auto-freq = AVG of consecutive completed order date intervals per customer. Effective = `COALESCE(manual_override, auto_freq)`. Include: active customers with (manual override OR ≥2 completed orders) AND overdueDays > 0. Sort: `overdueDays DESC`.

**Acceptance criteria:**
- [x] Widget shows up to 5 rows; empty state: "No customers need contact right now."
- [x] Row: teal avatar circle (initials: first letter of word 1 + first letter of word 2), company name, "X days overdue" badge (red-orange)
- [x] "View all" link → `/customers?sort=need_to_contact`
- [x] Customers with < 2 completed orders and no override: excluded (auto-freq requires ≥ 2 orders, and without a manual override the effective frequency is NULL — filtered by `COALESCE(...) IS NOT NULL`)
- [x] Inactive customers: excluded (`c.status = 'active'` filter)
- [x] Click row → `/customers?id=[customerId]`
- [x] [EH-01] Query throws with context on DB failure; returns `[]` (not error) when no customers qualify

**Tests required:**
- [x] `getNeedToContactList` → `excludes customers with < 2 orders and no manual override` (verified via SQL shape assertion — COALESCE filter + active-status clause)
- [x] `getNeedToContactList` → `manual override takes precedence over auto-calculated` (SQL uses `COALESCE(c.contact_frequency_days::numeric, af.avg_freq_days)`)
- [x] `getNeedToContactList` → `sorted by overdueDays DESC`
- [x] `getNeedToContactList` → `returns [] when no customers qualify`

**Depends on:** Task 7
**Specialist:** @db (query), @ui-totetrack (widget)

**Status:** [x] Done (2026-04-22) — `NeedToContactWidget` + `getNeedToContactList` (in `db/queries/dashboard.ts`), wired via the server component's `Promise.all` fetch. 13 new tests (340 → 353).

---

## Task 9: Pending Orders + Leads Follow-Up dashboard widgets

**Files:**
- `components/dashboard/PendingOrdersWidget.tsx` — create (`'use client'`)
- `components/dashboard/LeadsFollowUpWidget.tsx` — create (`'use client'`)
- `db/queries/dashboard.ts` — modify

**Functions to implement:**
- `getPendingOrdersForDashboard(limit?: number): Promise<PendingOrderRow[]>` (default: 5)
- `getLeadsFollowUp(limit?: number): Promise<LeadFollowUpRow[]>` (default: 5)

**Acceptance criteria:**
- [x] Pending Orders: backhaul=true pinned first (BACKHAUL badge, teal), then by `requested_delivery_date ASC`
- [x] Pending Orders row: PO number, customer name, req delivery date, BACKHAUL badge
- [x] Pending Orders empty state: "No pending orders."; "View all" → `/orders?status=pending`
- [x] Leads: `next_follow_up_date ≤ today`, sorted `ASC` (most overdue first)
- [x] Leads row: name, company, "X days overdue" badge (special-cased as "Due today" when overdue_days = 0, amber tone)
- [x] Leads empty state: "No leads to follow up on."; "View all" → `/leads`
- [x] Click row → correct detail view (`/orders?id=` and `/leads?id=`)

**Tests required:**
- [x] `getPendingOrdersForDashboard` → `backhaul orders before non-backhaul`
- [x] `getLeadsFollowUp` → `only returns leads with next_follow_up_date ≤ today`
- [x] `getLeadsFollowUp` → `sorted by next_follow_up_date ASC`

**Depends on:** Task 8
**Specialist:** @db (queries), @ui-totetrack (widgets)

**Status:** [x] Done (2026-04-22) — `PendingOrdersWidget` + `LeadsFollowUpWidget` + `getPendingOrdersForDashboard` + `getLeadsFollowUp`. Raw SQL moved to `db/queries/dashboard.sql.ts` when `dashboard.ts` crossed the 300-line CQ-02 cap (following the `customers.sql.ts` precedent). 19 new tests (353 → 372).

---

## Task 10: Invoice trend chart (Recharts, 4 modes)

**Files:**
- `components/dashboard/InvoiceChart.tsx` — create (`'use client'`)
- `db/queries/dashboard.ts` — modify

**Functions to implement:**
- `getInvoiceTrendData(): Promise<{ billingMonth: Date; totalAmount: number }[]>`
- `InvoiceChart({ data })` — Recharts BarChart with 4-mode tab selector

**Acceptance criteria:**
- [x] 4-mode selector: 2×2 tab grid — "Per Period | Cumulative" (columns) × "Monthly | Annual" (rows) (implemented as two orthogonal pill toggles, which matches the 2×2 intent with better touch-target ergonomics)
- [x] Per-Period Monthly: rolling last 12 calendar months, Y-axis = $ invoiced that month
- [x] Per-Period Annual: all years with data, Y-axis = $ invoiced that year
- [x] Cumulative Monthly: running total, 12 months, each bar ≥ previous
- [x] Cumulative Annual: running total per year
- [x] Bar animation on mode switch: `animationDuration={300}` via Recharts prop
- [x] Hover tooltip: period label + formatted $ amount
- [x] No data state: "No invoice data yet." centered in chart area (triggers on `data.length === 0`, independent of mode — monthly transforms always yield 12 points even on empty data)
- [x] `useReducedMotion()` → set `animationDuration={0}`
- [x] [CQ-02] `InvoiceChart.tsx` < 200 lines (174 lines; pure transforms extracted to `lib/invoice-chart-transforms.ts`)

**Tests required:**
- [x] `getInvoiceTrendData` → `returns all invoices sorted by billing_month ASC` (and grouped by billing_month)
- [x] `InvoiceChart` → `per-period monthly: max 12 data points rendered`
- [x] `InvoiceChart` → `cumulative: each value ≥ prior value in array`
- [x] `InvoiceChart` → `renders no-data state when data array is empty`

**Depends on:** Task 9
**Specialist:** @ui-totetrack

**Status:** [x] Done (2026-04-22) — pure transforms in `lib/invoice-chart-transforms.ts` (13 unit tests). `InvoiceChart.tsx` hosts the Recharts `<BarChart>` + two orthogonal pill toggles; toggles hide when `data.length === 0` to avoid UI noise and label collision with DashboardView's period toggle. Closes Milestone 2 code scope. 21 new tests (372 → 393).

---

## Task 11: Customer list panel + search + sort

**Files:**
- `app/(app)/customers/page.tsx` — create (server component)
- `components/customers/CustomerLayout.tsx` — create (`'use client'`)
- `components/customers/CustomerList.tsx` — create (`'use client'`)
- `db/queries/customers.ts` — create

**Functions to implement:**
- `getCustomers(filters?: { status?, search?, sort? }): Promise<CustomerListRow[]>`
- `CustomerList({ customers, selectedId, onSelect })`

**Acceptance criteria:**
- [x] Defaults: Active filter, Alphabetical sort
- [x] Active/Inactive toggle: switches list without page reload
- [x] Search: case-insensitive contains on `company_name`
- [x] Sort — Alphabetical: `company_name ASC`; Order Count: completed count DESC; Need-to-Contact: overdueDays DESC (non-overdue at bottom)
- [x] "CONTACT NEEDED" badge (red-orange) on overdue rows
- [~] "+ New Customer" top right → CustomerForm in right panel — button + placeholder panel rendered; CustomerForm itself is Task 14, wiring closes there
- [x] Click row → `/customers?id=[uuid]`, right panel loads
- [x] Empty (no customers): "No customers yet. Add your first customer."
- [x] Empty (search): "No customers match that search."

**Tests required:**
- [x] `getCustomers` → `status 'inactive' returns only inactive`
- [x] `getCustomers` → `search 'acme' returns only names containing 'acme' (case-insensitive)`
- [x] `getCustomers` → `sort order_count: highest first`

**Depends on:** Task 6
**Specialist:** @db (query), @ui-totetrack (UI)

**Status:** [x] Done (2026-04-20) — see `docs/session-log.md` entry for decisions and partial-acceptance note on "+ New Customer".

---

## Task 12: Customer detail panel + order history tabs

**Files:**
- `components/customers/CustomerDetail.tsx` — create (`'use client'`)
- `db/queries/customers.ts` — modify

**Functions to implement:**
- `getCustomerDetail(customerId: string): Promise<CustomerDetail>`
- `getCustomerOrders(customerId: string, window: '1M'|'3M'|'6M'|'1Y'|'YTD'): Promise<OrderRow[]>`
- `CustomerDetail({ customerId: string | null })`

**Acceptance criteria:**
- [x] No customer → "Select a customer to view details."
- [~] Header: company name, "Edit" button, "+ New Order" → `/orders?new=1&customerId=[id]` — Edit button is a placeholder that opens a "coming in Task 14" form panel (same shape as the Task 11 "+ New Customer" placeholder); `+ New Order` link href is correct.
- [x] Primary contact card: name, role, email, phone; "Last order X days ago — Contact Recommended" only when overdue
- [x] >1 contact: collapsible "More contacts" (Framer Motion height expand, 200ms ease-in-out, chevron rotates 0→180°)
- [x] Frequency: "Auto (X days avg)" or "Every X days (manual)"
- [x] Tabs: 1M | 3M | 6M | 1Y | YTD — sliding underline (150ms ease-in-out), content crossfades; windows: 30/90/180/365 days / Jan 1 to today
- [x] Order history table: PO#, date, qty, size, type, status badge, price; sorted `requested_delivery_date DESC`
- [x] [EH-01] `getCustomerDetail` throws `"Customer not found: [id]"` if not found

**Tests required:**
- [x] `getCustomerOrders` → `1M: only orders in last 30 days`
- [x] `getCustomerOrders` → `YTD: only orders from Jan 1 of current year`
- [x] `CustomerDetail` → `renders empty state when customerId is null`

**Depends on:** Task 11
**Specialist:** @db (queries), @ui-totetrack (UI)

**Status:** [x] Done (2026-04-20) — see `docs/session-log.md` entry for decisions and partial-acceptance note on the Edit button (wiring lands in Task 14).

---

## Task 13: Volume overview component + query

**Files:**
- `components/customers/VolumeOverview.tsx` — create (`'use client'`)
- `db/queries/customers.ts` — modify

**Functions to implement:**
- `getCustomerVolumeOverview(customerId: string): Promise<VolumeOverview>`

```ts
type VolumeOverview = {
  gal275: { rebottled: number; reconditioned: number; brandNew: number; totalAvg: number }
  gal330: { rebottled: number; reconditioned: number; brandNew: number; totalAvg: number }
}
```

**Acceptance criteria:**
- [x] AVG(quantity) per (size, type) pair across all completed orders for this customer
- [x] Two sections: "275 Gallon" + "330 Gallon", each with 3 rows (Rebottled, Reconditioned, Brand New)
- [x] Progress bar width: `(type_avg / size_totalAvg) * 100%`
- [x] Zero data: progress bar = 0px, value = "0 totes avg" (not NaN or error)
- [x] [EH-01] Explicit divide-by-zero guard: `totalAvg = 0` → all progress bars = 0

**Tests required:**
- [x] `getCustomerVolumeOverview` → `returns zeroes for customer with no completed orders`
- [x] `getCustomerVolumeOverview` → `correctly averages across 3 completed orders of same type`
- [x] `VolumeOverview` → `renders exactly 6 progress bars`

**Depends on:** Task 12
**Specialist:** @db (query), @ui-totetrack (UI)

**Status:** [x] Done (2026-04-20) — see `docs/session-log.md` entry for decisions including the builder-approved wire-through into CustomerDetail and the `customers.volume.ts` extraction that kept `customers.ts` under the CQ-02 service cap.

---

## Task 14: Customer form (create / edit / delete) + server actions

**Files:**
- `components/customers/CustomerForm.tsx` — create (`'use client'`)
- `lib/actions/customers.ts` — create

**Functions to implement:**
- `createCustomer(data: CreateCustomerInput): Promise<{ id: string } | { error: string }>`
- `updateCustomer(id: string, data): Promise<{ success: boolean } | { error: string }>`
- `deleteCustomer(id: string): Promise<{ success: boolean } | { error: string }>`
- `CustomerForm({ customerId?: string, onSuccess: () => void })`

**Acceptance criteria:**
- [x] Modal: scale 0.97→1 + fade in, 180ms ease-out
- [x] Company name empty → "Company name is required." (client-side before network)
- [x] No email AND no phone → "At least one email or phone is required."
- [x] "Add another contact" button, max 5 total contacts
- [x] Edit mode: pre-fills existing data
- [x] Delete (edit mode only): confirmation modal — shake on confirm button (300ms), must click "Yes, Delete" explicitly
- [~] `deleteCustomer` rejects if customer has scheduled/pending orders — **superseded by CONSTRAINT-13 (builder-approved during Task 14):** rejects whenever the customer has any orders; error message points to the Inactive toggle. The original "succeeds when only completed/invoiced" criterion conflicted with the FK `onDelete: restrict` semantics in the data model.
- [x] On success: success toast ("Customer created." / "Customer updated."), `router.refresh()`, form closes — toast wired in Task 29 (2026-04-21).
- [x] [SEC-01] Zod validation server-side in action (client validation is UX only)
- [x] [EH-01] All error paths return `{ error: string }` — no silent catches
- [x] [CQ-01] `createCustomer` split into `insertCustomerRecord` + `insertContacts` helpers

**Tests required:**
- [x] `createCustomer action` → `creates customer + primary contact, returns { id }`
- [x] `createCustomer action` → `rejects empty companyName`
- [x] `createCustomer action` → `rejects contact with no email and no phone`
- [x] `deleteCustomer action` → `error when customer has order history` (amended per CONSTRAINT-13)
- [x] `deleteCustomer action` → `succeeds when the customer has zero orders` (amended per CONSTRAINT-13)

**Depends on:** Task 12
**Specialist:** @db (actions), @ui-totetrack (form)

**Status:** [x] Done (2026-04-20) — see `docs/session-log.md` for the Option A / CONSTRAINT-13 decision and the Task 29 toast deferral note. Security Trigger fired (user data CRUD) — `@security` must run before `/clear`.

---

## Task 15: Order table + status filter tabs

**Files:**
- `app/(app)/orders/page.tsx` — create (server component)
- `components/orders/OrderLayout.tsx` — create (`'use client'`)
- `components/orders/OrderTable.tsx` — create (`'use client'`)
- `db/queries/orders.ts` — create

**Functions to implement:**
- `getOrders(filters?: { status?: po_status | 'all' }): Promise<OrderTableRow[]>`
- `OrderTable({ orders, selectedId, onSelect })`

**Acceptance criteria:**
- [x] Filter tabs: All | Scheduled | Pending | Completed | Cancelled | Invoiced — active tab teal
- [x] Columns: PO#, Customer (avatar initial + name), Qty/Size, Type badge, Status badge, Req. Date, Price
- [x] Type badge: Rebottled = blue-tinted bg, Reconditioned = teal-tinted bg, Brand New = dark/inverted
- [x] BACKHAUL badge (teal) where `backhaul = true` — rendered inline with Req. Date (logistics attribute, not order-state)
- [x] Default sort: scheduled/pending first (req date ASC), then completed/cancelled/invoiced (req date DESC)
- [x] Pagination: 20/page; "Showing X–Y of Z orders" footer
- [~] "+ New Order" → OrderForm; click row → `/orders?id=[uuid]` — button + click navigation wired; OrderForm is a placeholder panel until Task 17; OrderDetail is a placeholder panel until Task 16 (row still highlights on select)
- [x] Empty state: "No orders yet." (and "No orders match this filter." when status filter is active)

**Tests required:**
- [x] `getOrders` → `status 'pending' returns only pending`
- [x] `getOrders` → `'all' returns all statuses`
- [x] `OrderTable` → `pagination controls appear when > 20 rows`

**Depends on:** Task 6
**Specialist:** @db (query), @ui-totetrack (UI)

**Status:** [x] Done (2026-04-20) — see `docs/session-log.md` entry for the two-panel-layout decision, the raw-SQL + two-parallel-query pagination strategy, and the partial-acceptance notes on "+ New Order" / row detail (those land in Tasks 17 and 16 respectively).

---

## Task 16: Order detail panel

**Files:**
- `components/orders/OrderDetail.tsx` — create (`'use client'`)
- `db/queries/orders.ts` — modify (add `getOrderDetail`)

**Functions to implement:**
- `getOrderDetail(orderId: string): Promise<OrderDetail>`
- `OrderDetail({ orderId: string | null })`

**Acceptance criteria:**
- [x] No order → "Select an order to view details."
- [x] All fields: PO#, customer (linked to `/customers?id=[id]`), status badge, size, type, quantity, price, pickup-only, delivery address (hidden when pickup_only=true), req delivery date, backhaul, notes
- [x] OrderStatusActions component rendered below status — Task 18 closed the real component (2026-04-20); drop-in seam wired.
- [~] PODocumentUpload component rendered below status section — placeholder slot remains **permanent** (Task 19 / Task 33 both cut on 2026-04-22; see Task 19 note above). No real component will ship in v1.
- [x] [EH-01] `getOrderDetail` throws `"Order not found: [id]"` if not found

**Tests required:**
- [x] `getOrderDetail` → `returns all fields including customer name`
- [x] `OrderDetail` → `delivery address hidden when pickup_only = true`
- [x] `OrderDetail` → `renders empty state when orderId is null`

**Depends on:** Task 15
**Specialist:** @ui-totetrack

**Status:** [x] Done (2026-04-20) — see `docs/session-log.md` entry for decisions and the `[~]` partial-acceptance notes on the Task 18 / Task 19 placeholder slots.

---

## Task 17: Order form (create / edit) + server actions

**Files:**
- `components/orders/OrderForm.tsx` — create (`'use client'`)
- `lib/actions/orders.ts` — create

**Functions to implement:**
- `createOrder(data: CreateOrderInput): Promise<{ id: string } | { error: string }>`
- `updateOrder(id: string, data: UpdateOrderInput): Promise<{ success: boolean } | { error: string }>`

**CreateOrderInput:** poNumber (unique, required), customerId (uuid), containerSize (275|330), containerType, quantity (int ≥1), price (>0), pickupOnly (bool), deliveryAddress (required if !pickupOnly), requestedDeliveryDate, backhaul (bool), initialStatus (scheduled|pending, default scheduled), notes

**Acceptance criteria:**
- [x] If `?customerId=[id]` in URL: customer pre-selected, locked (read-only)
- [x] Delivery address: hidden when pickupOnly=true, required when pickupOnly=false
- [x] Duplicate PO number → `{ error: "PO number already exists." }`
- [x] Quantity < 1 → "Quantity must be at least 1."
- [x] Price ≤ 0 → "Price must be greater than $0."
- [x] `updateOrder` Zod schema strips `status` field — status only via `updateOrderStatus`
- [x] On success: toast ("Order created." / "Order updated."), `router.refresh()`, form closes — toast wired in Task 29 (2026-04-21).
- [x] [SEC-01] Zod validation server-side
- [x] [EH-01] All errors return `{ error: string }`

**Tests required:**
- [x] `createOrder action` → `creates order, returns { id }`
- [x] `createOrder action` → `rejects duplicate po_number`
- [x] `createOrder action` → `rejects missing delivery_address when pickup_only = false`
- [x] `updateOrder action` → `strips status field from input (Zod)`

**Depends on:** Task 16
**Specialist:** @db (actions), @ui-totetrack (form)

**Status:** [x] Done (2026-04-20) — see `docs/session-log.md` entry for decisions (minimal customer-selector query, URL-driven new-order initial mode, unique-violation → duplicate PO# mapping). Security Trigger fired — user-data CRUD — `@security` must run before `/clear`. Success toast ("Order created." / "Order updated.") wired in Task 29 (2026-04-21).

---

## Task 18: Order status transitions

**Files:**
- `components/orders/OrderStatusActions.tsx` — create (`'use client'`)
- `lib/actions/orders.ts` — modify (add `updateOrderStatus`)

**Functions to implement:**
- `updateOrderStatus(orderId: string, newStatus: 'pending'|'completed'|'cancelled'): Promise<{success:boolean}|{error:string}>`
- `OrderStatusActions({ orderId, currentStatus, onStatusChange })`

**Valid transitions:** scheduled→pending, pending→completed, pending→cancelled. All others rejected server-side.

**Acceptance criteria:**
- [x] `scheduled` → "Mark as Pending" button (teal)
- [x] `pending` → "Mark as Complete" (teal) + "Cancel Order" (red-orange)
- [x] `completed` | `cancelled` | `invoiced` → no buttons (status badge only)
- [x] "Cancel Order" → confirmation modal (scale 0.97→1 fade, 180ms); shake on confirm button (300ms) — requires explicit "Yes, Cancel" click
- [x] `updateOrderStatus`: validates transition server-side before write; `'invoiced'` rejected by Zod
- [x] On success: `router.refresh()`, success toast ("Order marked as pending." / "Order marked as complete." / "Order cancelled.") — toast wired in Task 29 (2026-04-21).
- [x] [EH-01] Invalid transition → `{ error: "Invalid status transition from [current] to [new]." }`

**Tests required:**
- [x] `updateOrderStatus` → `scheduled → pending: succeeds`
- [x] `updateOrderStatus` → `pending → completed: succeeds`
- [x] `updateOrderStatus` → `invoiced as newStatus: Zod validation error`
- [x] `updateOrderStatus` → `completed → pending: rejected (invalid transition)`
- [x] `OrderStatusActions` → `no buttons for terminal states`

**Depends on:** Task 17
**Specialist:** @ui-totetrack (modal + animation)

**Status:** [x] Done (2026-04-20) — see `docs/session-log.md` entry for decisions (transition lookup table, two-step read-then-write, `CancelOrderDialog` extracted per `DeleteCustomerDialog` precedent). Security Trigger fired — user-data mutation — `@security` must run before `/clear`. Success toasts ("Order marked as pending." / "Order marked as complete." / "Order cancelled.") wired in Task 29 (2026-04-21).

---

## Task 19: PO document upload (Supabase Storage) [~] Superseded 2026-07-27

> **Cut — never built.** `components/orders/PODocumentUpload.tsx` is still a placeholder and `docs/architecture.md` records Tasks 19/33 as cut. Marked during `@end-session`: left unchecked, it made the plan's "first incomplete task" resolve here instead of to real work.

**Status:** ~~DEFERRED~~ — permanently out of scope (builder decision 2026-04-22).

**Why:** Originally replaced by Task 33 (Claude vision extraction). Task 33 was subsequently cut because it requires a paid Anthropic API, which conflicts with CONSTRAINT-07 ($0 hosting — Vercel free + Supabase free tiers only). Upload-without-extraction provides no real value on its own (the salesperson would still re-type every field from the PDF), so both Task 19 and Task 33 are out of scope.

**Residual state:** The storage bucket (`po-documents`) and `orders.document_url` column already exist in the DB (Task 3) and stay in place — they're cheap and a future feature may use them. The `PODocumentUpload` placeholder slot in `OrderDetail.tsx` (Task 16 `[~]`) is now a **permanent labeled placeholder** — it will not be replaced by a real component in the v1 scope.

---

## Task 33: PO document extraction + form pre-fill (Claude vision) [~] Superseded 2026-07-27

> **Cut alongside Task 19** — it replaced Task 19 and was cut with it. See `docs/architecture.md`.

**Status:** [~] Superseded — cut from v1 scope (builder decision 2026-04-22).

**Why cut:** Anthropic Claude API is a paid service, which directly conflicts with CONSTRAINT-07 ($0 hosting — no paid services). Relaxing CONSTRAINT-07 for a ~$15–20/year spend was considered but declined. The feature also depended on an unvalidated assumption (Claude vision extraction accuracy on real PO documents) that would have required an `@assumptions` spike before `@plan` could finalise the spec.

**Residual state:** The detail-panel placeholder slot in `OrderDetail.tsx` (Task 16) is now **permanent** — no real PO document handling ships in v1. If this feature is ever revived, it would require: (1) a CONSTRAINT-07 amendment allowing the paid API, (2) an `@assumptions` pass with 3–5 real PO samples to validate extraction accuracy, and (3) a fresh `@plan` task with updated acceptance.

> ~~Replaces Task 19. Builds the full upload-to-pre-fill flow so the document actually eliminates manual re-entry.~~

**Files:**
- `lib/actions/orders.ts` — modify (add `extractPODocument`, `uploadPODocument`, `getPODocumentSignedUrl`)
- `components/orders/PODocumentUpload.tsx` — create (`'use client'`) — detail panel slot (view/replace existing doc only)
- `components/orders/OrderForm.tsx` — modify (add upload-and-extract entry point on new order flow)

**Functions to implement:**
- `extractPODocument(file: File): Promise<{ fields: Partial<CreateOrderInput> } | { error: string }>` — calls Claude vision API, returns structured field values
- `uploadPODocument(orderId: string, file: File): Promise<{ storagePath: string } | { error: string }>`
- `getPODocumentSignedUrl(storagePath: string): Promise<string>`

**Acceptance criteria:**
- [ ] Accepted: PDF, PNG, JPG — max 10MB
- [ ] Wrong type → "Only PDF, PNG, and JPG files are accepted."
- [ ] > 10MB → "File too large. Maximum 10MB allowed."
- [ ] Upload on new order form triggers extraction; returned fields pre-fill the form
- [ ] Salesperson reviews and can edit any pre-filled field before saving
- [ ] Extraction failure (unparseable doc) → form remains blank, user-facing error shown inline
- [ ] Path: `po-documents/[orderId]/[filename]`; `orders.document_url` updated after save
- [ ] Existing doc in detail panel shown as filename link — click fetches signed URL (1hr), opens new tab
- [ ] [SEC-01] Only signed URLs — never raw storage path as download link
- [ ] [EH-01] Upload/extraction error returns `{ error: string }` — no silent failure

**Tests required:**
- `extractPODocument` → `returns structured fields for a valid document`
- `extractPODocument` → `rejects > 10MB`
- `extractPODocument` → `rejects non-PDF/PNG/JPG`
- `uploadPODocument` → `stores file, updates orders.document_url`
- `getPODocumentSignedUrl` → `returns signed URL (not raw storage path)`

**Depends on:** Task 17, Task 27 (order form complete)
**Specialist:** @db (storage action), @ui-totetrack (form integration)

---

## Task 20: Lead list panel

**Files:**
- `app/(app)/leads/page.tsx` — create (server component)
- `components/leads/LeadLayout.tsx` — create (`'use client'`)
- `components/leads/LeadList.tsx` — create (`'use client'`)
- `db/queries/leads.ts` — create

**Functions to implement:**
- `getLeads(filters?: { status?: 'hot'|'warm'|'cold'|'all'; search?: string }): Promise<LeadListRow[]>`
- `LeadList({ leads, selectedId, onSelect })`

**Acceptance criteria:**
- [x] Filter tabs: All | Hot | Warm | Cold — 'converted' never shown in any filter
- [x] Hot = red-orange, Warm = amber, Cold = slate
- [x] Sort: `next_follow_up_date ASC`, nulls last
- [x] "+ New Lead" button present; click row → `/leads?id=[uuid]`
- [x] Search: case-insensitive contains on name or company
- [x] Empty state: "No leads yet. Add your first lead."

**Tests required:**
- [x] `getLeads` → `status 'hot' returns only hot leads`
- [x] `getLeads` → `never returns converted leads in any filter`
- [x] `getLeads` → `sorted next_follow_up_date ASC, nulls last`

**Depends on:** Task 6
**Specialist:** @db (query), @ui-totetrack (UI)

**Status:** [x] Done (2026-04-20) — "+ New Lead" button present but wires to LeadForm (Task 22); right panel is empty-state placeholder until Task 21. 9 new tests, 132 total passing.

---

## Task 21: Lead detail panel + notes

**Files:**
- `components/leads/LeadDetail.tsx` — create (`'use client'`)
- `db/queries/leads.ts` — modify
- `lib/actions/leads.ts` — create (addLeadNote, setNextAction)

**Functions to implement:**
- `getLeadDetail(leadId: string): Promise<LeadDetail>`
- `getLeadNotes(leadId: string): Promise<LeadNote[]>` — sorted `created_at ASC`
- `addLeadNote(leadId: string, content: string): Promise<{ id: string } | { error: string }>`
- `setNextAction(leadId: string, data: { date: Date; time: string; actionType: string }): Promise<{ success: boolean } | { error: string }>`

**Acceptance criteria:**
- [x] No lead → "Select a lead to view details."
- [x] Header: name, title, company; "Edit" button; "Convert" button (disabled placeholder — Task 22)
- [x] Engagement section: Last Contact date (from updated_at), Lead Source, Status badge
- [x] Next Action panel: date picker, time input, Action Type dropdown (Call|Email|Visit|Other), "Save Reminder"
- [x] Notes: scrollable append-only list; "[Mon DD, YYYY HH:MM]" timestamp format; "Save Note" button
- [x] Empty note → "Note cannot be empty." (client-side AND server-side via Zod .trim().min(1))
- [x] Notes are NOT editable after save (no edit/delete icons)
- [x] Empty notes: "No notes yet."

**Tests required:**
- [x] `getLeadNotes` → `sorted by created_at ASC`
- [x] `addLeadNote action` → `creates note with current UTC timestamp`
- [x] `setNextAction action` → `updates next_follow_up_date and next_action_type`

**Depends on:** Task 20
**Specialist:** @db (queries/actions), @ui-totetrack (UI)

**Status:** [x] Done (2026-04-20) — "Convert" button disabled placeholder until Task 22. 18 new tests (6 query + 12 action), 150 total passing. Security Trigger: FIRED — addLeadNote and setNextAction mutate user data.

---

## Task 22: Lead form (create / edit) + conversion flow

**Files:**
- `components/leads/LeadForm.tsx` — create (`'use client'`)
- `lib/actions/leads.ts` — modify (createLead, updateLead, convertLeadToCustomer)

**Functions to implement:**
- `createLead(data: CreateLeadInput): Promise<{ id: string } | { error: string }>`
- `updateLead(id: string, data): Promise<{ success: boolean } | { error: string }>`
- `convertLeadToCustomer(leadId: string): Promise<{ customerId: string } | { error: string }>`

**Acceptance criteria:**
- [x] Name required → "Name is required."
- [x] No email AND no phone → "At least one contact method is required."
- [x] Status default = 'warm'
- [x] "Convert to Customer" → confirmation: "Convert [name] to a customer? This will create a new customer record and archive this lead."
- [x] Confirm → `convertLeadToCustomer` (atomic) → redirect `/customers?id=[newId]`
- [x] Same company already exists → soft warning toast (not block): "A customer named [X] already exists. Continue anyway?"
- [x] [EH-01] `convertLeadToCustomer` is atomic: if customer insert fails, lead status unchanged
- [x] [SEC-01] Zod validation server-side

**Tests required:**
- [x] `createLead action` → `creates lead, returns { id }`
- [x] `convertLeadToCustomer action` → `creates customer + sets lead status = 'converted' in one transaction`
- [x] `convertLeadToCustomer action` → `if customer insert fails, lead status remains unchanged`

**Depends on:** Task 21
**Specialist:** @db (actions, transaction), @ui-totetrack (form, modal)

**Status:** [x] Done (2026-04-20) — see `docs/session-log.md` for decisions (leads.convert.ts extraction, warning-vs-toast approach, atomicity confirmation, no delete flow). Security Trigger fired — user-data CRUD — `@security` must run before `/clear`. Success toast ("Lead created." / "Lead updated.") wired in Task 29 (2026-04-21).

---

## Task 23: Generate invoice panel + invoiceable orders query

**Files:**
- `app/(app)/invoices/page.tsx` — create (server component)
- `components/invoices/InvoiceLayout.tsx` — create (`'use client'`)
- `components/invoices/GenerateInvoice.tsx` — create (`'use client'`)
- `db/queries/invoices.ts` — create

**Functions to implement:**
- `getInvoiceableOrders(billingMonth: Date, customerId?: string): Promise<InvoiceableOrder[]>`

**Query:** `status = 'completed'` AND `invoice_id IS NULL` AND `requested_delivery_date` within calendar month of `billingMonth`. Filter by `customerId` if provided.

**Acceptance criteria:**
- [x] Billing month picker (month+year), default current month
- [x] Customer dropdown: "All Customers" (default) + active customers
- [x] Table auto-populates on selection; all rows pre-checked
- [x] Uncheck rows → "Draft Total: $X,XXX.XX" updates real-time (client-side)
- [x] "Create Invoice" disabled when 0 rows checked
- [x] Columns: ☐ | PO# | Customer | Qty + Size + Type | Price
- [x] No eligible orders → "No completed orders for this period." (no button)
- [x] [EH-01] `getInvoiceableOrders` throws with context on DB error; returns `[]` when no matches

**Tests required:**
- `getInvoiceableOrders` → `only completed, uninvoiced orders in selected month`
- `getInvoiceableOrders` → `customerId filter limits to that customer`
- `getInvoiceableOrders` → `returns [] (not error) when no matches`
- `GenerateInvoice` → `draft total recalculates on row uncheck`

**Depends on:** Task 6
**Specialist:** @db (query), @ui-totetrack (UI)

---

## Task 24: Invoice creation server action

**Files:**
- `lib/actions/invoices.ts` — create

**Functions to implement:**
- `createInvoice(data: CreateInvoiceInput): Promise<{ id: string; invoiceNumber: string } | { error: string }>`
- `markInvoicePaid(invoiceId: string): Promise<{ success: boolean } | { error: string }>`

**CreateInvoiceInput:** billingMonth (Date), customerId? (uuid|null), orderIds (string[], min length 1)

**Creation logic (atomic DB transaction):**
1. Validate all orderIds: status='completed' AND invoice_id IS NULL
2. Sum total_amount
3. Auto-generate invoice_number (INV-0001 format, global sequence)
4. Insert invoice (status='draft')
5. Update all selected orders: status='invoiced', invoice_id=newId

**Acceptance criteria:**
- [x] Entire operation atomic — any step failure rolls back all changes
- [x] Server re-validates orderIds (client state not trusted)
- [x] Any order already invoiced → `{ error: "Order [PO#] is already invoiced." }`, full rollback
- [x] invoice_number auto-generated, sequential, never reused
- [x] `markInvoicePaid`: only on draft → `{ error: "Invoice is already marked paid." }` if already paid
- [x] [SEC-01] orderIds validated as UUIDs server-side
- [x] [EH-01] Transaction failure returns `{ error: string }` — no partial state

**Tests required:**
- `createInvoice action` → `creates invoice + sets all orders to 'invoiced' atomically`
- `createInvoice action` → `full rollback if any order already invoiced`
- `createInvoice action` → `invoice_number increments correctly (INV-0001, INV-0002)`
- `markInvoicePaid action` → `rejects already-paid invoice`

**Depends on:** Task 23
**Specialist:** @db (transaction)

---

## Task 25: Invoice ledger + detail view

**Files:**
- `components/invoices/InvoiceLedger.tsx` — create (`'use client'`)
- `db/queries/invoices.ts` — modify (add `getInvoices`, `getInvoiceDetail`)

**Functions to implement:**
- `getInvoices(filter?: 'all'|'draft'|'paid'): Promise<InvoiceLedgerRow[]>`
- `getInvoiceDetail(invoiceId: string): Promise<InvoiceDetail>`

**Acceptance criteria:**
- [x] Filter pills: All | Draft | Paid; sort `billing_month DESC`
- [x] Columns: Invoice # | Period (Month YYYY) | Customer (or "All Customers") | Amount | Status badge
- [x] Draft = gray, Paid = teal
- [x] Click row → detail view (read-only): PO rows, total, status, "Mark as Paid" (draft only)
- [x] Empty state: "No invoices generated yet."
- [x] [EH-01] `getInvoiceDetail` throws `"Invoice not found: [id]"`

**Tests required:**
- `getInvoices` → `filter 'draft' returns only drafts`
- `getInvoices` → `sorted billing_month DESC`
- `getInvoiceDetail` → `returns invoice + all associated PO rows`

**Depends on:** Task 24
**Specialist:** @db (queries), @ui-totetrack (UI)

---

## Task 26: Support ticket form + attachment upload

**Files:**
- `app/(app)/support/page.tsx` — create (server component)
- `components/support/SupportLayout.tsx` — create (`'use client'`)
- `components/support/NewTicketForm.tsx` — create (`'use client'`)
- `lib/actions/support.ts` — create

**Functions to implement:**
- `createTicket(data: CreateTicketInput): Promise<{ id: string } | { error: string }>`
- `uploadTicketAttachment(ticketId: string, file: File): Promise<{ path: string } | { error: string }>`

**CreateTicketInput (Zod):** title (min 1), category, priority, description (min 1)

**Acceptance criteria:**
- [x] Fields: Issue Title, Category dropdown, Priority dropdown, Detailed Description, Attachments zone
- [x] Attachments: PNG/JPG/PDF, max 5MB/file, max 3 files
- [x] Wrong type → "Only PNG, JPG, and PDF files are accepted."
- [x] > 5MB → "File too large. Maximum 5MB per file."
- [x] > 3 files → "Maximum 3 attachments per ticket."
- [x] Submit: createTicket (status='open') → uploadTicketAttachment per file → insert attachment records
- [x] Ticket+attachment failure: ticket stands; inline notice: "Ticket submitted, but [N] attachment(s) failed to upload."
- [x] Success: "Issue submitted." toast, form resets — toast wired in Task 29 (2026-04-21). Partial-failure path additionally fires an error toast with the "Ticket submitted, but N attachment(s) failed to upload." message; inline `role="status"` notice retained as defense-in-depth per session-handoff.
- [x] [SEC-01] Zod server-side validation
- [x] [EH-01] Attachment failure does not silently succeed

**Tests required:**
- [x] `createTicket action` → `creates ticket with status = 'open'`
- [x] `uploadTicketAttachment action` → `rejects > 5MB`
- [x] `uploadTicketAttachment action` → `stores in support-attachments/[ticketId]/[filename]`

**Depends on:** Task 6
**Specialist:** @db (action), @ui-totetrack (form)

**Status:** [x] Done (2026-04-21) — see `docs/session-log.md` entry for decisions (useAttachments + useTicketSubmit extraction for CONSTRAINT-14 compliance, filename sanitization + UUID-prefix storage path pattern, server-side file size/MIME/quota re-validation, partial-failure inline surface). Security Trigger fired — user data CRUD + file uploads — `@security` must run before `/clear`.

---

## Task 27: Support ticket list + detail view

**Files:**
- `components/support/TicketList.tsx` — create (`'use client'`)
- `components/support/TicketDetail.tsx` — create (`'use client'`)
- `db/queries/support.ts` — create

**Functions to implement:**
- `getTickets(): Promise<TicketListRow[]>`
- `getTicketDetail(ticketId: string): Promise<TicketDetail>`

**Acceptance criteria:**
- [x] Rows: title, category badge, priority badge, status pill
- [x] Priority: Critical=red, High=red-orange, Standard=neutral, Low=slate
- [x] Status: Open=blue, In Progress=amber, Resolved=green, Closed=gray
- [x] Sort: `created_at DESC`
- [x] Click row → detail (read-only): title, category, priority, description, status, developer_notes (blank if null), attachments
- [x] Attachments: filename links → fresh signed URL (1hr), opens new tab
- [x] Empty state: "No issues submitted yet."
- [x] [EH-01] `getTicketDetail` throws `"Ticket not found: [id]"`

**Tests required:**
- [x] `getTickets` → `sorted by created_at DESC`
- [x] `getTicketDetail` → `returns ticket + all attachment records`

**Depends on:** Task 26
**Specialist:** @db (queries), @ui-totetrack (UI)

**Status:** [x] Done (2026-04-21) — see `docs/session-log.md` entry for decisions (attachment-id signed-URL contract, popup-blocker-safe download flow, `TicketAttachments.tsx` extraction for CQ-02, URL-driven right-panel dispatch). New action `getSupportAttachmentSignedUrl` added to `lib/actions/support.ts`. Security Trigger fired (new auth surface reading file data) — `@security` must run before `/clear`. Feature slice (Tasks 26–27) complete — `@code-review` fires after `@security` returns CLEAR.

---

## Task 28: Framer Motion animation layer

**Files:**
- `components/shell/PageTransition.tsx` — create (`'use client'`)
- `lib/animations.ts` — create
- All existing `'use client'` components — modify (apply variants)

**Functions to implement:**
- `PageTransition({ children })` — page enter animation
- `lib/animations.ts` — pure exported constants (no logic, no imports from React)

**Variants in `lib/animations.ts`:**
```ts
export const pageVariants        // fade + y: 4→0, 200ms ease-out
export const modalVariants       // scale: 0.97→1 + opacity, 180ms ease-out / 130ms ease-in
export const cancelVariants      // opacity→0 + y: 0→2, 150ms ease-in
export const staggerContainer   // staggerChildren: 0.03
export const staggerItem        // opacity 0→1, 150ms ease-out
export const collapsibleVariants // height animate via motion.div
```

**Acceptance criteria:**
- [x] Page transitions: PageTransition wraps each screen's content — enter: fade + 4px upward slide, 200ms ease-out
- [x] Tab switching (1M/3M etc., Monthly/Yearly, Per-Period/Cumulative): `motion.div` with `layoutId` for underline (150ms ease-in-out); content crossfades
- [x] List stagger: CustomerList, OrderTable, LeadList, TicketList — items 1–8 at 30ms stagger; items >8 appear together
- [x] Collapsibles: `AnimatePresence` + `motion.div` height expand/collapse, 200ms ease-in-out; chevron rotates 0→180° via `motion.span`
- [x] Status badge color changes: CSS `transition: background-color 200ms ease-in-out` (not Framer Motion)
- [x] Chart animation: `animationDuration={300}` on Recharts — closed when Task 10 landed (2026-04-22); also covers the Monthly/Yearly tab switch on DashboardView (pill `layoutId`, Task 7) and the Per-Period/Cumulative tab pair on InvoiceChart (Task 10).
- [x] `useReducedMotion()` in ALL animated components → instant variants when true
- [x] [CQ-01] `lib/animations.ts` is pure constants — no functions, no logic

**Tests required:**
- [x] `lib/animations` → `all 6 exports are plain objects`
- [x] `PageTransition` → `renders children without error`
- [x] `PageTransition` → `applies instant variants when useReducedMotion is true`

**Depends on:** Task 27 (all screens built)
**Specialist:** @ui-totetrack

**Status:** [x] Done (2026-04-21) — see `docs/session-log.md` entry for decisions (pill-background layoutId for filter tabs instead of underline — applied to OrderStatusTabs, LeadList status tabs, InvoiceLedger filter tabs; OrderHistory underline pattern preserved; 15 files modified for central-variants refactor; 8 new tests). Dashboard-specific acceptance items (`Monthly/Yearly`, `Per-Period/Cumulative`, chart animation) carried forward to Task 9/10 when the dashboard is built.

---

## Task 29: Toast notifications + global error handling

**Files:**
- `components/shell/ToastProvider.tsx` — create (`'use client'`)
- `lib/hooks/useToast.ts` — create
- `app/(app)/layout.tsx` — modify (add `<ToastProvider>`)

**Functions to implement:**
- `useToast(): { toast: (message: string, variant: 'success'|'error'|'info') => void }`
- `ToastProvider({ children })` — toast queue, render stack

**Acceptance criteria:**
- [x] Success: slide in from top-right (x: 100%→0), 250ms ease-out; auto-dismiss 3s, 200ms fade-out
- [x] Error: same animation, red-orange bg; auto-dismiss 5s
- [x] Max 3 toasts visible; oldest dismissed when 4th arrives
- [x] `useReducedMotion()`: instant appear/disappear, still auto-dismisses
- [x] All server action success paths call `toast('...', 'success')` immediately after success
- [x] [EH-01] Error toasts include enough context — "Failed to save customer. Please try again." not just "Error."

**Tests required:**
- [x] `useToast` → `toast() adds entry to visible queue`
- [x] `ToastProvider` → `auto-dismisses after correct timeout per variant`
- [x] `ToastProvider` → `caps at 3 visible toasts`

**Depends on:** Task 6
**Specialist:** @ui-totetrack

**Status:** [x] Done (2026-04-21) — see `docs/session-log.md` for decisions (animation-module split between `lib/animations.ts` pure variants and `lib/toast-animation.ts` branching helper; named `ToastProviderMissingError` instead of silent no-op; timer cleanup on provider unmount; NewTicketForm partial-failure inline notice retained as defense-in-depth alongside error toast). 13 new tests (311 → 324). Security Trigger does NOT fire (presentational layer, no auth/payments/user data CRUD). Feature slice complete — `@code-review` fires next.

---

## Task 30: Keep-alive cron + README documentation

**Files:**
- `README.md` — modify (replace skeleton with complete setup instructions)
- `.env.example` — modify (add `ADMIN_EMAIL=` with comment)

**Functions to implement:** None (documentation)

**README sections to write:**
1. Install + run: `npm install`, `npm run dev`, `npm run build && npm start`
2. Supabase setup: `drizzle-kit push`, create Auth user via Supabase dashboard
3. Vercel deployment: list all 5 env vars to set
4. **Keep-alive cron (required):** cron-job.org setup — URL: `[NEXT_PUBLIC_SUPABASE_URL]/rest/v1/customers?select=id&limit=1`, Header: `apikey: [NEXT_PUBLIC_SUPABASE_ANON_KEY]`, Schedule: every 5 days — reason: Supabase free pauses after 7 days inactivity
5. If Supabase is paused: link to `supabase.com/dashboard`, unpause steps (~30s)

**Acceptance criteria:**
- [x] `.env.example` adds `ADMIN_EMAIL=` with comment: `# Internal only — never shown in UI`
- [x] README cron section has copy-paste-ready URL + header patterns (placeholders, not real values)
- [x] Auth user creation step is exact: Supabase Dashboard path, exact field values, warning not to change the email
- [x] [SEC-01] No real values in README or `.env.example` — all `[PLACEHOLDER]` format

**Tests required:** None (documentation)

**Depends on:** Task 1

**Status:** [x] Done (2026-04-22) — see `docs/session-log.md` for decisions (documented all three migrations via SQL-Editor paste flow instead of the spec's `drizzle-kit push` — manual 0002_rls_policies + 0003_storage_buckets aren't tracked by drizzle-kit; listed 6 env vars instead of spec's 5 — `DATABASE_URL` is required by `db/index.ts` and `drizzle.config.ts`; cron-job.org schedule suggested as `0 12 */5 * *`). No `@code-review` needed — documentation-only, verified against codebase reality.

---

## Task 34: Remove top bar; ship pill hamburger on authenticated routes ✅ Done (verified on disk 2026-07-27)

> Shipped long ago; the acceptance boxes were never ticked. Verified during `@end-session`: `components/shell/PillHamburger.tsx` exists and `components/shell/TopBar.tsx` is deleted.

> Added 2026-04-23 via `@create-plan`. Source: `docs/prd.md` Cross-cutting: App Shell Chrome (D10).

**Files:**
- `components/shell/TopBar.tsx` — **delete** (component removed per PRD acceptance)
- `components/shell/PillHamburger.tsx` — create (`'use client'`)
- `components/shell/AppShell.tsx` — modify (remove TopBar render; mount PillHamburger; drawer state unchanged)
- `components/shell/__tests__/PillHamburger.test.tsx` — create
- `components/shell/__tests__/AppShell.test.tsx` — modify (replace TopBar assertions with PillHamburger assertions; regression-guard the 6 nav items + Sign Out)
- `docs/design-decisions.md` — modify (add 2nd row to the "Deliberate Deviations from Mockup" table; update Global Shell section to reflect chrome-less + pill hamburger)

**Functions / components to implement:**
- `PillHamburger({ onClick })` — renders a 44×44px white pill (rounded-full, shadow-sm matching Card elevation) containing a hamburger icon. `position: fixed`, `top-6 left-6` (24px from edges). Tap fires `onClick` (mounts to AppShell's drawer-open handler). Static component — no motion.

**Acceptance criteria:**
- [ ] `components/shell/TopBar.tsx` deleted; zero remaining imports across `src`, `components`, `app`, `lib`
- [ ] `AppShell.tsx` mounts `PillHamburger` in place of the prior `TopBar`; drawer open/close/backdrop/Esc behaviors identical to pre-change
- [ ] `PillHamburger` renders top-left of viewport on every authenticated screen (Dashboard, Customers, Orders, Leads, Invoices, Support) — verified via Playwright/DevTools MCP across the six routes
- [ ] `position: fixed` — pill stays visible on scroll
- [ ] Touch target ≥44×44px; hamburger icon centered
- [ ] White background with subtle shadow matching Card elevation (reuse shadcn Card shadow token or equivalent)
- [ ] Login (`/login`) unchanged — no hamburger, no PillHamburger import in login route
- [ ] No global search, no logo, no notification bell, no avatar rendered on any authenticated screen
- [ ] Nav drawer internals unchanged — 6 nav items + Sign Out button (regression-guarded in AppShell tests)
- [ ] No page-title row added on Customers/Leads/Invoices/Support — orientation relies on drawer active-state + content self-titling (per PRD Cross-cutting: App Shell Chrome > Page Orientation)
- [ ] `PillHamburger` has `aria-label="Open navigation"`; keyboard-activatable (Enter/Space)
- [ ] [CQ-01] `PillHamburger` function body ≤ 50 lines (or ≤ 80 under CONSTRAINT-14 if JSX-dominant)
- [ ] [CQ-02] `AppShell.tsx` stays under 300 lines; no dead imports after TopBar removal

**Tests required:**
- `PillHamburger` → `renders with correct size, shape, and fixed positioning classes`
- `PillHamburger` → `has aria-label="Open navigation"`
- `PillHamburger` → `fires onClick on tap`
- `PillHamburger` → `fires onClick on Enter/Space keypress`
- `AppShell` → `mounts PillHamburger (not TopBar)`
- `AppShell` → `tapping PillHamburger opens NavDrawer`
- `AppShell` → `NavDrawer retains 6 nav items + Sign Out button (regression guard)`

**Depends on:** None
**Specialist:** @ui-totetrack

**Status:** [x] Done (2026-04-23) — see `docs/session-log.md` for decisions (added Sign Out to NavDrawer to close a pre-existing UI gap — `signOut` server action existed but had no caller; pill at `fixed top-6 left-6 w-11 h-11 bg-card shadow-md` z-40; `<main>` `pt-14` → `pt-16` to clear pill bottom edge; `<form action={signOut}>` over `onClick` for native server-action form integration). 12 new tests (375 → 387). TypeScript + browser verification clean. No Security Trigger — presentational chrome, no user-data CRUD.

---

## Task 35: Dashboard Quick-Add FAB + `?new=1` handling on Customers/Leads

> Added 2026-04-23 via `@create-plan`. Source: `docs/prd.md` Feature 8: Quick-Add FAB (D11).

**Files:**
- `components/dashboard/QuickAddFab.tsx` — create (`'use client'`)
- `components/dashboard/__tests__/QuickAddFab.test.tsx` — create
- `components/dashboard/DashboardView.tsx` — modify (mount `QuickAddFab` as child)
- `components/shell/drawer-state.ts` — create (React Context + `useAppShellDrawerState` hook). @dev may pick an alternative shared-state pattern; this is the default
- `components/shell/AppShell.tsx` — modify (provide drawer-state context to children)
- `components/customers/CustomerLayout.tsx` — modify (read `?new=1` on mount → open New Customer form; clear `?id` if both present)
- `components/leads/LeadLayout.tsx` — modify (same for Leads)
- `components/customers/__tests__/CustomerLayout.test.tsx` — modify (`?new=1` tests)
- `components/leads/__tests__/LeadLayout.test.tsx` — modify (`?new=1` tests)
- `components/orders/__tests__/OrderLayout.test.tsx` — modify (regression test: `?new=1` without `customerId` still opens OrderForm)
- `lib/animations.ts` — modify (add speed-dial expand/collapse variants)
- `docs/design-decisions.md` — modify (append Quick-Add FAB rows to the Animation Specs table)

> **Orders note:** `/orders?new=1` already works (per PRD Feature 3 line 124 / Task 17). Verify handler tolerates absence of `customerId` — likely no code change; add the regression test only.

**Functions / components to implement:**
- `QuickAddFab()` — client component
  - 52×52px teal "+" button fixed bottom-right (24px margin)
  - Tap → rotate 45° to "×"; three options fan upward with 30ms stagger, 150ms scale 0.8→1 + upward translate per option (variants in `lib/animations.ts`)
  - Options top-to-bottom: **Add Purchase Order** → `/orders?new=1`, **Add Customer** → `/customers?new=1`, **Add Lead** → `/leads?new=1` (via `next/navigation` `router.push`)
  - Each option: 44×44px circular icon button + label pill to its left
  - Dismiss: tap "×", tap outside option column, or Esc → 130ms reverse animation
  - Returns null when `useAppShellDrawerState().isOpen` is true
  - `useReducedMotion()` → instant show/hide
- `useAppShellDrawerState()` hook — subscribes to drawer open/close state from the AppShell context provider

**Acceptance criteria:**
- [ ] FAB renders ONLY on `/dashboard` — verified via Playwright/DevTools MCP across all authenticated routes + `/login`
- [ ] Collapsed state: 52×52px, teal primary (`#007A8A`), "+" icon, `position: fixed`, bottom-right 24px margin
- [ ] Expanded state: "+" rotates 45° (to "×"); 3 options fan upward with 30ms stagger, 150ms scale 0.8→1 + upward translate per option
- [ ] Option order top-to-bottom: Purchase Order, Customer, Lead
- [ ] Each option: 44×44px circular icon + label pill ("Add Purchase Order" / "Add Customer" / "Add Lead"); combined tap area ≥44px
- [ ] Tap option → navigates to destination URL; destination opens its New X form on mount when `?new=1` is present
- [ ] `/customers?new=1` opens the CustomerForm (no customer pre-selected). If `?id=[uuid]` is also present, `?new=1` takes precedence and `?id` is cleared from URL on mount
- [ ] `/leads?new=1` opens the LeadForm — same precedence behavior
- [ ] `/orders?new=1` (no `customerId`) opens OrderForm with no pre-selected customer — regression-guarded in test
- [ ] Tap "×" or tap outside option column → 130ms reverse collapse
- [ ] Tap-outside dismisses without activating the tapped element
- [ ] Esc key dismisses
- [ ] FAB hides (returns null) when NavDrawer is open
- [ ] Keyboard: Tab focuses FAB → Enter/Space opens → Tab or Arrow Down/Up cycles options → Enter activates → focus trap while open → focus returns to FAB on close
- [ ] ARIA: FAB has `aria-expanded`, `aria-haspopup="menu"`; options exposed with `role="menu"` + `role="menuitem"` each (exact ARIA pattern at impl discretion)
- [ ] `useReducedMotion()` respected — instant show/hide
- [ ] [CQ-01] `QuickAddFab` function body ≤ 50 lines, or ≤ 80 if JSX-dominant per CONSTRAINT-14 (OptionButton sub-component extraction expected)
- [ ] [CQ-02] No new file crosses the 300-line cap
- [ ] [SEC-01] No secrets; navigation-only surface with no user input

**Tests required:**
- `QuickAddFab` → `renders collapsed "+" button in bottom-right with fixed positioning`
- `QuickAddFab` → `tap toggles to expanded state with 3 options`
- `QuickAddFab` → `options render in order: Purchase Order, Customer, Lead`
- `QuickAddFab` → `tap option navigates to expected URL` (parameterized × 3)
- `QuickAddFab` → `tap outside collapses without activating element behind`
- `QuickAddFab` → `Esc key collapses`
- `QuickAddFab` → `returns null when drawer state is open`
- `QuickAddFab` → `respects useReducedMotion (instant show/hide)`
- `CustomerLayout` → `opens New Customer form on mount when ?new=1 is present`
- `CustomerLayout` → `clears ?id when ?new=1 is also present (precedence)`
- `LeadLayout` → `opens New Lead form on mount when ?new=1 is present`
- `LeadLayout` → `clears ?id when ?new=1 is also present (precedence)`
- `OrderLayout` → `opens New Order form on mount when ?new=1 without customerId (regression)`

**Depends on:** Task 34 (both tasks modify `AppShell.tsx`; sequencing Task 34 → Task 35 avoids merge conflict; Task 35 also adds drawer-state context to AppShell, which assumes Task 34's refactor is already in place)
**Specialist:** @ui-totetrack

**Status:** [x] Done (2026-04-23) — see `docs/session-log.md` for decisions (drawer state shared via `components/shell/drawer-state.tsx` Context + `useAppShellDrawerState` hook; `?new=1` precedence over `?id` resolved server-side in customers/leads page parsers; tap-outside via mousedown capture + `preventDefault` to suppress activation behind; `useDismissOnOutsideOrEsc` extracted as a sibling hook to keep QuickAddFab under CONSTRAINT-14's 80-line cap; `LucideIcon` typed for FAB option icons; design-decisions.md Animation Specs extended with 3 speed-dial rows). 18 new tests (387 → 405). Browser-verified end-to-end on `/dashboard` + `/customers?new=1` + `/leads?new=1` + drawer-open hides FAB. No Security Trigger — presentational + URL routing only. **Feature complete (Task 34 + 35) — `@code-review` next.**

---

## Task 36: Schema migration — replace legacy PO columns with 6 quantity columns

> Added 2026-04-24 via `@create-plan`. Source: `docs/prd.md` Feature 9 (D15).

**Files:**
- `db/schema/orders.ts` — modify
- `db/schema/enums.ts` — modify (drop `container_size`, `container_type` enums **only if** no other table references them; otherwise leave intact)
- `db/migrations/0008_po_multi_combo.sql` — create
- `db/migrations/meta/_journal.json` — modify (Drizzle migrations metadata)
- `db/migrations/__tests__/0008.test.ts` — create

**Functions to implement:**
- Migration SQL (in order):
  1. `ALTER TABLE orders ADD COLUMN qty_275_recon INTEGER NOT NULL DEFAULT 0` (× 6 columns: `qty_275_recon`, `qty_275_rebot`, `qty_275_new`, `qty_330_recon`, `qty_330_rebot`, `qty_330_new`)
  2. Backfill: `UPDATE orders SET qty_<size>_<type> = quantity WHERE container_size = '<size>' AND container_type = '<type>'` for each of the 6 (size, type) pairs
  3. `ALTER TABLE orders DROP COLUMN container_size, DROP COLUMN container_type, DROP COLUMN quantity`
- Drizzle schema additions: 6 typed integer columns matching SQL, all `.notNull().default(0)`

**Acceptance criteria:**
- [ ] Migration adds 6 qty columns — all `INTEGER NOT NULL DEFAULT 0`
- [ ] Backfill runs **before** drop — every existing order row has exactly one non-zero qty cell matching its prior `container_size` + `container_type` + `quantity`
- [ ] Legacy columns (`container_size`, `container_type`, `quantity`) dropped after backfill
- [ ] Drizzle schema updated; `drizzle-kit` reports clean state vs migration
- [ ] RLS policies on `orders` unchanged and still enforced (CONSTRAINT-05)
- [ ] No data loss — row count + price totals before vs after migration are identical

**Tests required:**
- `db/migrations/__tests__/0008.test.ts` → `backfill correctness with seeded mixed-combo data` → `expect each combo to land in correct column`
- `db/migrations/__tests__/0008.test.ts` → `row count + price total invariants` → `expect pre-migration count === post-migration count and SUM(price) unchanged`

**Depends on:** None
**Specialist:** @db

**Status:** [x] Done (2026-04-24) — see `docs/session-log.md`. Migration `0008_po_multi_combo.sql` created (6 ADD COLUMN + 6 backfill UPDATE + 3 DROP COLUMN, statement-breakpoint convention, container_size/container_type enum types intentionally retained as orphans pending Tasks 37–43 cleanup); `db/schema/orders.ts` rewritten (3 cols out, 6 cols in, no other field changes); 3/3 new migration content-validation tests pass. **Deviations from spec (see Founder Brief in session log):** (1) `_journal.json` not updated — already out of sync with migrations 0002–0007, would have made the gap weirder; (2) test pattern is SQL content-validation, not integration test — project has no DB integration test infra, real backfill verification deferred to dev DB application after full feature ships. **Build is now broken** (TypeScript fails because Tasks 37–43 still reference dropped columns) — expected per option C; production stays on commit `4df1886` until Feature 9 fully ships.

---

## Task 37: Refactor read queries for new schema (orders, dashboard, volume overview)

> Added 2026-04-24 via `@create-plan`. Source: `docs/prd.md` Feature 9 (D15).

**Files:**
- `db/queries/orders.ts` — modify (`getOrders`, `getOrderDetail`)
- `db/queries/dashboard.ts` — modify (Open Orders widget data; any aggregations referencing old size/type/qty)
- `db/queries/customers.ts` — modify (`getVolumeOverview`)
- `db/queries/__tests__/orders.test.ts` — modify
- `db/queries/__tests__/dashboard.test.ts` — modify
- `db/queries/__tests__/customers.test.ts` — modify

**Functions to implement:**
- `getOrders(...)` — return shape includes the 6 qty columns + price; remove all references to `container_size` / `container_type` / `quantity`
- `getOrderDetail(id)` — same column shape addition
- `getVolumeOverview(customerId)` — for each of 6 combos, compute `AVG(qty_<size>_<type>) FILTER (WHERE qty_<size>_<type> > 0 AND status IN ('completed', 'invoiced'))` per CONSTRAINT-15 stats rule
- Open Orders widget query — return 6 qty columns for downstream display formatting

**Acceptance criteria:**
- [ ] All three query files compile and return new column shape
- [ ] `getVolumeOverview` formula: per-combo avg only across POs that included that combo (not diluted by zero-cell POs)
- [ ] Stats include `status IN ('completed', 'invoiced')` per CONSTRAINT-15 (invoiced is sub-state of completed for stats)
- [ ] No reference to `container_size`, `container_type`, or `quantity` anywhere in queries
- [ ] Type imports in any client component that consumes these queries (via `import type`) compile per Platform-Native Rule (architecture.md — client components value-import nothing from `db/queries/*`)

**Tests required:**
- `db/queries/__tests__/orders.test.ts` → `getOrders returns 6 qty columns` → `expect new shape`
- `db/queries/__tests__/customers.test.ts` → `getVolumeOverview with mixed-combo POs` → `expect avg only across POs with that combo non-zero`
- `db/queries/__tests__/customers.test.ts` → `getVolumeOverview excludes scheduled/cancelled` → `expect status filter applied`
- `db/queries/__tests__/dashboard.test.ts` → `Open Orders widget data has new shape` → `expect 6 qty cols`

**Depends on:** Task 36
**Specialist:** @db

**Status:** [x] Done (2026-04-24) — see `docs/session-log.md`. Refactored `db/queries/orders.ts` (`getOrders` + `getOrderDetail` return 6 qty cols, no legacy size/type/qty); `db/queries/customers.ts` (`CustomerOrderRow` shape + `VolumeAveragesRow` single-row aggregate consumer); `db/queries/customers.sql.ts` (`customerVolumeAveragesQuery` becomes 6× `AVG(qty_X) FILTER (WHERE qty_X > 0)`; `customerOrdersQuery` returns 6 qty cols + backhaul); `db/queries/customers.volume.ts` (`assembleVolumeOverview` takes single row, parses string averages with NULL → 0 fallback); `db/queries/dashboard.sql.ts` (Open Orders widget query returns 6 qty cols per Q7); `db/queries/dashboard.ts` (`OpenOrderRow` shape). **Scope expansion (Founder Brief in session log):** `db/queries/invoices.ts` was missing from the original Task 37 spec but also references the dropped columns — included to keep the read layer internally consistent (`InvoiceableOrder` + `InvoicePoRow` shapes + queries updated; `InvoicePoRow` gains `backhaul` for Task 43's downstream B-tag). 71/71 query tests pass (orders 11, customers 23, dashboard 22, invoices 15).

---

## Task 38: Refactor `createOrder` + `updateOrder` server actions — new input shape, sum-validation, edit lock

> Added 2026-04-24 via `@create-plan`. Source: `docs/prd.md` Feature 9 (D15).

**Files:**
- `lib/actions/orders.ts` — modify (currently at 300-line cap; if needed, extract validation helpers to a sibling `lib/actions/orders.validation.ts` per existing precedent like `orders.revert.ts` / `orders.constants.ts`)
- `lib/actions/__tests__/orders.test.ts` — modify

**Functions to implement:**
- `createOrder(input)` — input shape now: `{ customer_id, qty_275_recon, qty_275_rebot, qty_275_new, qty_330_recon, qty_330_rebot, qty_330_new, price, ... existing fields }`. Zod validation: each qty ≥ 0; sum > 0; price > 0
- `updateOrder(id, input)` — same input shape; **before update**: fetch current status; if `status IN ('invoiced', 'cancelled')` and input contains any qty or price change, reject with `{ error: 'PO is locked. Revert to scheduled before editing quantities or price.' }`. Other field edits (notes, address, etc.) on terminal states allowed per existing rules.
- All-zero validation message: `"At least one quantity is required."`

**Acceptance criteria:**
- [ ] `createOrder` accepts new input shape, rejects all-zero with clear error
- [ ] `updateOrder` accepts new shape; rejects qty/price changes on `invoiced` and `cancelled` POs with explicit error message
- [ ] `updateOrder` permits qty/price changes on `scheduled` and `completed` POs
- [ ] Server-side Zod validation applied (CONSTRAINT-02 — server actions can't trust client validation)
- [ ] No reference to legacy fields anywhere in actions
- [ ] `lib/actions/orders.ts` stays at or below the 300-line cap (sibling extraction per Platform-Native Rule precedent if needed)
- [ ] SEC-01: input UUIDs validated as UUID format (existing pattern)
- [ ] EH-01: failures fail loud with context per error-handling rule

**Tests required:**
- `lib/actions/__tests__/orders.test.ts` → `createOrder happy path with mixed combos` → `expect insert with new shape`
- `lib/actions/__tests__/orders.test.ts` → `createOrder all-zero rejected` → `expect error 'At least one quantity is required.'`
- `lib/actions/__tests__/orders.test.ts` → `updateOrder on invoiced PO with qty change` → `expect lock error`
- `lib/actions/__tests__/orders.test.ts` → `updateOrder on invoiced PO with notes-only change` → `expect success` (lock applies to qty/price only)
- `lib/actions/__tests__/orders.test.ts` → `updateOrder on completed PO with qty change` → `expect success`
- `lib/actions/__tests__/orders.test.ts` → `updateOrder on cancelled PO with qty change` → `expect lock error`

**Depends on:** Task 36, Task 37
**Specialist:** @db

**Status:** [x] Done (2026-04-24) — see `docs/session-log.md`. Refactored `lib/actions/orders.ts` (282 lines, under 300-line cap) + extracted Zod schemas / regex constants / validation helpers / type aliases to new `lib/actions/orders.validation.ts` (142 lines) per Platform-Native Rule sibling pattern (precedent: `customers.constants.ts`, `leads.constants.ts`). `createOrder` / `updateOrder` accept new 6-qty input shape; sum > 0 enforced server-side via Zod `.superRefine` (`requireAtLeastOneQty`) returning `"At least one quantity is required."`; `updateOrder` adds pre-update SELECT of (status + 6 qty + price) snapshot, compares against input via `detectQtyOrPriceChange`, rejects with `PO_LOCKED_MESSAGE` when status ∈ `('invoiced', 'cancelled')` AND any qty/price differs (notes/address/etc. on locked POs still permitted). `updateOrderStatus` unchanged (CONSTRAINT-16 COALESCE preserved). 32/32 action tests pass (added: multi-combo create, negative-qty rejection, edit-lock × 4, order-not-found). No Security Trigger fired — no auth/payment/PII changes; only operational data shape + validation tightening (SEC-01 UUID + SEC-02 Zod input validation preserved).

---

## Task 39: Reusable 2×3 size×type grid component (display + input variants)

> Added 2026-04-24 via `@create-plan`. Source: `docs/prd.md` Feature 9 (D15).

**Files:**
- `components/shared/QtyGrid.tsx` — create (`'use client'`)
- `components/shared/__tests__/QtyGrid.test.tsx` — create
- `components/customers/VolumeOverview.tsx` — modify (refactor to consume `QtyGrid` in display-with-progress-bar mode, OR keep its existing component if grid concerns differ enough — implementer's call to avoid forcing a misfit abstraction)
- `components/customers/__tests__/VolumeOverview.test.tsx` — modify (regression coverage)

**Functions to implement:**
- `QtyGrid({ mode, values, onChange?, showEmptyAsDash? })` — renders 2×3 grid (rows: 275 gal / 330 gal; columns: Reconditioned / Rebottled / Brand New). In `display` mode: numbers or `—` per `showEmptyAsDash`. In `input` mode: numeric inputs, ≥ 0 integers only.

**Acceptance criteria:**
- [ ] Grid renders 2 rows × 3 columns with correct labels (sizes as row headers, types as column headers)
- [ ] Display mode: cells show qty integer or `—` when 0 (per Q4 decision)
- [ ] Input mode: numeric inputs accept ≥ 0 integers only; non-integer / negative input rejected client-side
- [ ] `'use client'` directive present (CONSTRAINT-03)
- [ ] iPad-landscape friendly: each input ≥ 44px touch target (project touch-target standard)
- [ ] Customer Volume Overview continues to render correctly post-refactor (no visual regression — covered by regression test)
- [ ] Component file ≤ 200 lines (project component cap), or ≤ 80 lines for the JSX-rendering component per CONSTRAINT-14

**Tests required:**
- `components/shared/__tests__/QtyGrid.test.tsx` → `display mode renders values correctly` → `expect 6 cells with correct values`
- `components/shared/__tests__/QtyGrid.test.tsx` → `display mode shows — for zero cells` → `expect dash on empty`
- `components/shared/__tests__/QtyGrid.test.tsx` → `input mode triggers onChange with new value` → `expect handler called with updated cell`
- `components/shared/__tests__/QtyGrid.test.tsx` → `input mode rejects negative input` → `expect input clamped to 0`
- `components/customers/__tests__/VolumeOverview.test.tsx` → `regression: existing render still passes` → `expect no visual regression`

**Depends on:** None (pure UI component; can be built in parallel with Tasks 36–38)
**Specialist:** @ui-totetrack

**Status:** [x] Done (2026-04-24) — see `docs/session-log.md`. Created `components/shared/QtyGrid.tsx` (196 lines, under 200-line cap) with `display` + `input` modes, `QtyGridValues` interface matching the 6 orders-table column names, `ZERO_QTY_VALUES` constant export. Display mode uses em dash for zero cells (default, configurable via `showEmptyAsDash`); input mode uses controlled numeric inputs with empty-placeholder for zero, client-side clamp (≥0, ≤100k, integer floor). All cells ≥44px touch target via `h-11 min-h-[44px]`. **Implementer's call (Founder Brief in session log):** did NOT refactor `VolumeOverview` to consume `QtyGrid` — its progress-bar layout is structurally different from raw-qty grid; forcing a shared abstraction would be a misfit per Task 39 spec's escape hatch. Visual consistency between OrderDetail's grid (Task 41) and Customer Volume Overview is in spirit only — both decompose the 6 (size × type) combos but with mode-appropriate presentation. 17/17 tests pass (14 QtyGrid + 3 VolumeOverview regression — confirms zero impact on existing customer detail screen).

---

## Task 40: Order form — integrate 2×3 input grid + total price + client validation

> Added 2026-04-24 via `@create-plan`. Source: `docs/prd.md` Feature 9 (D15).

**Files:**
- `components/orders/OrderForm.tsx` — modify
- `components/orders/__tests__/OrderForm.test.tsx` — modify

**Functions to implement:**
- Form schema (Zod): replace `container_size` + `container_type` + `quantity` fields with 6 qty fields; sum > 0 validator; price > 0 validator (existing)
- Form layout: replace single size/type/qty inputs with `<QtyGrid mode="input" />`; total price stays as single input below the grid
- Submit handler: pass new shape to `createOrder` / `updateOrder` server action

**Acceptance criteria:**
- [ ] Form renders 2×3 input grid + total price input + existing fields (PO#, customer, dates, address, pickup, backhaul, notes)
- [ ] Inline error: `"At least one quantity is required."` shown when sum = 0 on submit
- [ ] Submit calls server action with new input shape
- [ ] Edit mode pre-fills 6 qty cells from existing PO
- [ ] `'use client'` directive present (existing); no Framer Motion / Recharts cross-boundary (CONSTRAINT-03)
- [ ] Touch targets ≥ 44px throughout (project standard)
- [ ] CQ-14: component file ≤ 80 lines if non-JSX logic ≤ 50; else split sub-components

**Tests required:**
- `components/orders/__tests__/OrderForm.test.tsx` → `renders new grid + price` → `expect grid present`
- `components/orders/__tests__/OrderForm.test.tsx` → `submit with mixed combos` → `expect createOrder called with new shape`
- `components/orders/__tests__/OrderForm.test.tsx` → `submit with all-zero` → `expect inline error, no action call`
- `components/orders/__tests__/OrderForm.test.tsx` → `edit mode pre-fills 6 qty cells from existing PO` → `expect inputs populated`

**Depends on:** Task 38, Task 39
**Specialist:** @ui-totetrack

**Status:** [x] Done (2026-04-24) — see `docs/session-log.md`. Updated `components/orders/orderFormSchema.ts` (`OrderFormValues` shape + `EMPTY_FORM_VALUES` + `detailToFormValues` + `formValuesToCreateInput`/`formValuesToUpdateInput` use the 6 qty number fields; new `totalQuantity` helper exported; dropped `ContainerSize`/`ContainerType` exports). Rewrote `components/orders/OrderContainerFields.tsx` (106 lines) — replaces single size/type/qty selects with `<QtyGrid mode="input" />` bridged via watch/setValue, plus relabeled price input as "Total Price (USD)". `components/orders/OrderFormFields.tsx` + `components/orders/OrderForm.tsx` thread `setValue` and a new `qtyError` state through to OCF. Client-side at-least-one-quantity validation via `totalQuantity()` check in OrderForm.onSubmit; error rendered inline below grid. **Founder Brief in session log:** the qty error couldn't reliably use react-hook-form's `setError` because the qty fields are bridged through setValue/watch (not standard `register` since QtyGrid is controlled) — RHF's setError on programmatically-managed fields didn't trigger subscriber re-renders in the OrderContainerFields path. Switched to a plain `useState<string | null>` in OrderForm threaded down via prop. 9/9 OrderForm tests pass + 14/14 QtyGrid + 3/3 VolumeOverview regression. 26 total tests in this surface area.

---

## Task 41: Order detail — 2×3 display grid + total price prominence ✅ Done 2026-04-24

> Added 2026-04-24 via `@create-plan`. Source: `docs/prd.md` Feature 9 (D15).

**Files:**
- `components/orders/OrderDetail.tsx` — modify
- `components/orders/__tests__/OrderDetail.test.tsx` — modify

**Functions to implement:**
- Replace single size/type/qty display with `<QtyGrid mode="display" showEmptyAsDash />`
- Total price displayed prominently (visual hierarchy per `docs/design-decisions.md` — large/bold dark numbers per Stitch mockup display-numbers spec)
- Existing fields (delivery date, pickup-only, address, backhaul, notes) unchanged
- Action buttons unchanged (Mark Complete, Cancel, Revert, Edit) — Edit button visually disabled when status is `invoiced` or `cancelled` (Task 38 edit lock semantics)

**Acceptance criteria:**
- [ ] Detail panel renders 2×3 mix grid with actual quantities, `—` for empty cells
- [ ] Total price visually prominent (matches Stitch mockup display-numbers treatment per design-decisions.md)
- [ ] Edit button visually disabled (or "Revert to Edit" hint) when PO is `invoiced` or `cancelled`
- [ ] Backhaul shown as compact `B` tag (consistency with new pattern; `BackhaulTag` from Task 42)
- [ ] Component file ≤ 200 lines (or 80 for JSX-renderer per CONSTRAINT-14)
- [ ] `'use client'` directive present

**Tests required:**
- `components/orders/__tests__/OrderDetail.test.tsx` → `renders grid with mixed-combo PO` → `expect correct values`
- `components/orders/__tests__/OrderDetail.test.tsx` → `renders — for empty cells` → `expect dashes`
- `components/orders/__tests__/OrderDetail.test.tsx` → `Edit button disabled on invoiced` → `expect disabled state`
- `components/orders/__tests__/OrderDetail.test.tsx` → `Edit button enabled on completed` → `expect enabled state`

**Depends on:** Task 37, Task 39, Task 42 (uses `BackhaulTag`)
**Specialist:** @ui-totetrack

**Status:** [x]

---

## Task 42: Order table — column restructure + shared `BackhaulTag` component ✅ Done 2026-04-24

> Added 2026-04-24 via `@create-plan`. Source: `docs/prd.md` Feature 9 (D15).

**Files:**
- `components/orders/OrderTable.tsx` — modify
- `components/orders/__tests__/OrderTable.test.tsx` — modify
- `components/shared/BackhaulTag.tsx` — create (compact `B` tag, used across PO list surfaces per Q7)
- `components/shared/__tests__/BackhaulTag.test.tsx` — create

**Functions to implement:**
- `BackhaulTag()` — renders compact teal `B` badge. Conditional render at the call site (only when `backhaul = true`)
- Order table columns: PO# | Customer (avatar + name) | 275 (`qty_275_recon + qty_275_rebot + qty_275_new` per row, render `—` if 0) | 330 (same for 330) | Status | Req Date (`—` if null per CONSTRAINT-16) | Price | `B` tag (after Price column when backhaul=true)
- Default sort unchanged: `requested_delivery_date DESC NULLS LAST` (per Q5)

**Acceptance criteria:**
- [ ] Table renders new columns in correct order, no Type or Qty/Size columns
- [ ] 275 / 330 totals computed per row; render as integer or `—`
- [ ] `B` tag rendered after Price column on rows with `backhaul = true` only
- [ ] Existing filter tabs (All | Scheduled | Completed | Cancelled) unchanged
- [ ] Pagination row preserved
- [ ] Touch target ≥ 44px on row taps (existing)
- [ ] iPad-landscape (1024px+) layout: columns fit without horizontal scroll
- [ ] Component file ≤ 200 lines (or 80 for JSX-renderer per CONSTRAINT-14); extract row component if needed

**Tests required:**
- `components/orders/__tests__/OrderTable.test.tsx` → `renders new columns in correct order` → `expect column headers`
- `components/orders/__tests__/OrderTable.test.tsx` → `275/330 totals correct for mixed PO` → `expect summed values`
- `components/orders/__tests__/OrderTable.test.tsx` → `renders — for zero size` → `expect dash`
- `components/orders/__tests__/OrderTable.test.tsx` → `B tag rendered when backhaul=true` → `expect tag present`
- `components/orders/__tests__/OrderTable.test.tsx` → `no B tag when backhaul=false` → `expect no tag`
- `components/shared/__tests__/BackhaulTag.test.tsx` → `renders B` → `expect tag content`

**Depends on:** Task 37
**Specialist:** @ui-totetrack

**Status:** [x]

---

## Task 43: Downstream PO list surfaces — Open Orders widget + Customer Order History + Invoice detail PO rows ✅ Done 2026-04-24

> Added 2026-04-24 via `@create-plan`. Source: `docs/prd.md` Feature 9 (D15).

**Files:**
- `components/dashboard/OpenOrdersWidget.tsx` — modify
- `components/customers/CustomerDetail.tsx` — modify (or sub-component for Order History rows — implementer's call based on file size)
- `components/invoices/InvoiceLayout.tsx` — modify (or wherever invoice detail PO rows render — confirm at implementation time)
- `components/dashboard/__tests__/OpenOrdersWidget.test.tsx` — modify
- `components/customers/__tests__/CustomerDetail.test.tsx` — modify (or new sub-component test file)
- `components/invoices/__tests__/InvoiceLayout.test.tsx` — modify (or new sub-component test file)

**Functions to implement:**
- All three surfaces render PO rows with the same `275 | 330` totals + `B` tag pattern as the orders table (Q7 consistency)
- Reuse `BackhaulTag` from Task 42

**Acceptance criteria:**
- [ ] Dashboard Open Orders widget rows show `275: X | 330: Y` + `B` tag (when applicable)
- [ ] Customer detail Order History rows show same pattern
- [ ] Invoice detail PO rows show same pattern
- [ ] Empty totals render as `—` everywhere
- [ ] All component-level rules preserved (touch targets, file size caps, `'use client'` directive)

**Tests required:**
- `components/dashboard/__tests__/OpenOrdersWidget.test.tsx` → `renders 275/330 totals + B tag` → `expect new shape`
- `components/customers/__tests__/CustomerDetail.test.tsx` → `Order History rows render 275/330 totals + B tag` → `expect new shape`
- `components/invoices/__tests__/InvoiceLayout.test.tsx` → `invoice detail PO rows render 275/330 totals + B tag` → `expect new shape`

**Depends on:** Task 37, Task 42
**Specialist:** @ui-totetrack

**Status:** [x]

---

## Task 44: Schema — add 6 per-combo unit-price columns ✅ Done 2026-07-25

> Added 2026-07-25 via `@create-plan`. Source: `docs/prd.md` Feature 10.
> Live DB was hand-migrated + backfilled 2026-07-25; this task brings Drizzle schema + migration file + data-model into parity (closes drift).

**Files:**
- `db/schema/orders.ts` — modify
- `db/migrations/0009_po_unit_prices.sql` — create
- `docs/data-model.md` — modify

**Functions to implement:**
- Add `unit_price_275_recon`, `unit_price_275_rebot`, `unit_price_275_new`, `unit_price_330_recon`, `unit_price_330_rebot`, `unit_price_330_new` — `numeric(10,2)`, nullable, no default
- Migration mirrors the run SQL: `ADD COLUMN IF NOT EXISTS` (x6) + guarded single-combo backfill (`price` → matching combo's unit price, `price` recomputed to qty × unit; multi-combo/zero-qty rows skipped)

**Acceptance criteria:**
- [x] Drizzle `orders` schema declares all 6 nullable `numeric(10,2)` unit-price columns
- [x] `0009_po_unit_prices.sql` is idempotent (safe to re-run; backfill only touches rows with all 6 unit prices NULL)
- [x] `docs/data-model.md` reflects the 6 columns and the derived-total semantics (SEC-01: no secrets in migration)

**Tests required:**
- `db/migrations/__tests__/0009.test.ts` → `content-test: adds 6 nullable unit_price columns` → `expect column names present`
- `db/migrations/__tests__/0009.test.ts` → `backfill guarded on all-NULL unit prices` → `expect WHERE clause blocks double-apply`

**Depends on:** None
**Specialist:** @db

**Status:** [x]

---

## Task 45: Server data contract — validation, actions, detail read ✅ Done 2026-07-25

> Added 2026-07-25 via `@create-plan`. Source: `docs/prd.md` Feature 10.

**Files:**
- `lib/actions/orders.validation.ts` — modify
- `lib/actions/orders.ts` — modify
- order detail query + `OrderDetailType` (wherever the detail row is read/typed) — modify

**Functions to implement:**
- `orders.validation.ts`: add 6 unit-price fields (`numeric(10,2)` domain, nullable); refinement — `qty > 0 ⟹ unit price present and > 0`; `qty = 0 ⟹ unit price must be NULL`
- `normalizeCreate` / `normalizeUpdate`: write the 6 unit prices; compute and store `price = Σ(qty_cell × unit_price_cell)` as `.toFixed(2)` — ignore any client-sent total
- `detectQtyOrPriceChange(...)`: extend to include unit-price changes so the `invoiced`/`cancelled` edit lock covers them
- Detail read: select the 6 unit-price columns; `OrderDetailType` exposes them

**Acceptance criteria:**
- [x] Server derives `price` from qty × unit; a client-supplied total is never trusted
- [x] qty > 0 with blank/≤0 unit price rejected server-side with a clear message (EH-01: loud, contextful error)
- [x] qty = 0 persists unit price as NULL
- [x] Editing an `invoiced`/`cancelled` PO with a changed unit price is blocked with the existing lock message

**Tests required:**
- `lib/actions/__tests__/orders.test.ts` → `derives total from qty × unit across multiple combos` → `expect stored price = Σ`
- `lib/actions/__tests__/orders.test.ts` → `qty > 0 with no unit price → validation error` → `expect failure`
- `lib/actions/__tests__/orders.test.ts` → `qty = 0 stores NULL unit price` → `expect null`
- `lib/actions/__tests__/orders.test.ts` → `unit-price change on invoiced PO is locked` → `expect PO_LOCKED_MESSAGE`

**Depends on:** Task 44
**Specialist:** @db

**Status:** [x]

---

## Task 46: `QtyGrid` — unit-price input cell + `qty / $unit` display cell ✅ Done 2026-07-25

> Added 2026-07-25 via `@create-plan`. Source: `docs/prd.md` Feature 10.

**Files:**
- `components/shared/QtyGrid.tsx` — modify (and its value/type defs)

**Functions to implement:**
- `InputCell`: add a `$` unit-price input beside the qty input (decimals, ≥ 0, step 0.01)
- `DisplayCell`: render `qty / $unit` (e.g. `60 / $105`) when qty > 0; `—` when 0/blank
- Extend `QtyGridValues` (or add a parallel unit-price value type) + `onChange` payload to carry unit prices

**Acceptance criteria:**
- [x] Display mode shows `qty / $unit` for filled cells and `—` for empty (matches Feature 10 detail spec)
- [x] Input mode renders a qty + unit-price pair per cell and emits both on change
- [x] Component stays within file-size cap; existing display/input consumers unaffected where unit prices absent (extracted `QtyGridCells.tsx`; unit prices opt-in via `onUnitPriceChange`)

**Tests required:**
- `components/shared/__tests__/QtyGrid.test.tsx` → `display cell shows qty / $unit when filled` → `expect formatted string`
- `components/shared/__tests__/QtyGrid.test.tsx` → `display cell shows dash when empty` → `expect —`
- `components/shared/__tests__/QtyGrid.test.tsx` → `input cell emits qty and unit price` → `expect onChange payload`

**Depends on:** Task 44
**Specialist:** @ui-totetrack

**Status:** [x]

---

## Task 47: Order form — wire unit-price inputs + read-only live total ✅ Done 2026-07-25

> Added 2026-07-25 via `@create-plan`. Source: `docs/prd.md` Feature 10.

**Files:**
- `components/orders/orderFormSchema.ts` — modify
- `components/orders/OrderContainerFields.tsx` — modify
- `components/orders/OrderForm.tsx` — modify

**Functions to implement:**
- `orderFormSchema.ts`: add unit prices to `OrderFormValues`, `detailToFormValues` (edit prefill), and `formValuesToCreateInput` / `formValuesToUpdateInput`
- `OrderContainerFields.tsx`: bridge the 6 unit-price fields to the grid; replace the editable Total Price input with a **read-only** display that live-recomputes Σ(qty × unit)
- `OrderForm.tsx`: submit maps the new fields; no client-sent total

**Acceptance criteria:**
- [x] Each combo cell has a unit-price input; Total Price is read-only and updates live as qty/unit change
- [x] Edit mode prefills existing unit prices
- [x] Client validation blocks qty > 0 with blank unit price before submit (mirrors server rule)

**Tests required:**
- `components/orders/__tests__/OrderForm.test.tsx` → `entering qty + unit price updates read-only total` → `expect Σ`
- `components/orders/__tests__/OrderForm.test.tsx` → `edit prefills unit prices` → `expect populated inputs`

**Depends on:** Task 45, Task 46
**Specialist:** @ui-totetrack

**Status:** [x]

---

## Task 48: Order detail — render `qty / $unit` grid ✅ Done 2026-07-25

> Added 2026-07-25 via `@create-plan`. Source: `docs/prd.md` Feature 10.

**Files:**
- `components/orders/OrderDetailParts.tsx` — modify

**Functions to implement:**
- `QuantitiesBlock`: pass the 6 unit prices into `QtyGrid` display mode so cells show `qty / $unit`
- `TotalPriceBlock`: unchanged (still reads `detail.price`)

**Acceptance criteria:**
- [x] Detail quantities grid shows `qty / $unit` for filled cells, `—` for empty
- [x] Total price continues to read the derived `price`

**Tests required:**
- `components/orders/__tests__/OrderDetail.test.tsx` → `detail cell shows qty / $unit` → `expect formatted string`
- `components/orders/__tests__/OrderDetail.test.tsx` → `empty detail cell shows dash` → `expect —`

**Depends on:** Task 45, Task 46
**Specialist:** @ui-totetrack

**Status:** [x]

---

## Task 49: Schema — add production_date, same_day_delivery, production_sort_index ✅ Done 2026-07-26

> Added 2026-07-26 via `@create-plan`. Source: `docs/prd.md` Feature 11 (D16 / CONSTRAINT-19).
> **Pre-check note:** `manifest.md` does not exist in this project and never has. The `@create-plan` pre-check was explicitly waived by the Builder on 2026-07-26. `**Specialist:**` fields below follow the convention already in use across Tasks 1–48 rather than a manifest lookup.

**Files:**
- `db/migrations/0010_production_calendar.sql` — create
- `db/migrations/__tests__/0010.test.ts` — create
- `db/schema/orders.ts` — modify

**Functions to implement:**
- Migration SQL, in order:
  1. `ALTER TABLE orders ADD COLUMN production_date DATE`
  2. `ALTER TABLE orders ADD COLUMN same_day_delivery BOOLEAN NOT NULL DEFAULT false`
  3. `ALTER TABLE orders ADD COLUMN production_sort_index INTEGER`
  4. `CREATE INDEX orders_production_date_idx ON orders (production_date)`
- Drizzle additions in `db/schema/orders.ts`: `production_date: date('production_date')`, `same_day_delivery: boolean('same_day_delivery').notNull().default(false)`, `production_sort_index: integer('production_sort_index')`, plus the index alongside `orders_requested_delivery_date_idx`

**Acceptance criteria:**
- [x] All 3 columns added; `production_date` and `production_sort_index` nullable, `same_day_delivery` NOT NULL DEFAULT false
- [x] No backfill — every existing row gets NULL / NULL / false, which is the correct starting state
- [x] Index created on `production_date` (calendar queries filter by date range)
- [x] RLS policies on `orders` untouched and still enforced (CONSTRAINT-05)
- [x] No existing column altered or dropped — purely additive and reversible
- [x] Drizzle schema mirrors the SQL exactly; `tsc --noEmit` passes
- [x] Statements use the `--> statement-breakpoint` convention with a leading comment block explaining intent

**Tests required:**
- `db/migrations/__tests__/0010.test.ts` → `adds three production columns with correct nullability` → `expect ADD COLUMN statements and constraints to match`
- `db/migrations/__tests__/0010.test.ts` → `is purely additive` → `expect no DROP COLUMN or ALTER COLUMN in the file`

**Depends on:** None
**Specialist:** @db

**Status:** [x] Done 2026-07-26 — migration written with `IF NOT EXISTS` idempotency guards (0009 precedent, hand-applied migrations). **Not yet applied to any DB.**

---

## Task 50: Business-day date helpers in `lib/dates.ts` ✅ Done 2026-07-26

> Added 2026-07-26 via `@create-plan`. Source: `docs/prd.md` Feature 11 (D16 / CONSTRAINT-19).

**Files:**
- `lib/dates.ts` — modify
- `lib/__tests__/dates.test.ts` — create

**Functions to implement:**
- `prevBusinessDay(date: Date): Date` — the last Mon–Fri strictly before `date`. Sat, Sun and Mon all return the prior Friday. Weekends only; no holiday awareness (CONSTRAINT-19).
- `isBusinessDay(date: Date): boolean` — true for Mon–Fri.
- `nextBusinessDay(date: Date): Date` — the next Mon–Fri strictly after `date`. Used by the dashboard widget's "next 2 business days".
- `startOfBusinessWeek(date: Date): Date` — the Monday of `date`'s week; on Sat/Sun returns the **following** Monday, so `Current week` lands on the next Mon–Fri.
- `businessWeekDays(monday: Date): Date[]` — the 5 weekday Dates from a given Monday.
- `effectiveProductionDate(productionDate: string | null, requestedDeliveryDate: string | null): string | null` — the COALESCE rule as a pure function; returns a `DB_DATE_FORMAT` string, or null when both inputs are null.

**Acceptance criteria:**
- [x] `prevBusinessDay` maps Mon → prior Fri, Sat → Fri, Sun → Fri, Tue–Fri → previous day
- [x] No returned date from any helper ever falls on a Saturday or Sunday — holds for every *derived* date. `effectiveProductionDate` passes a stored `production_date` through verbatim by design; the no-weekend invariant is enforced at the write boundary (Task 52), not on read.
- [x] `startOfBusinessWeek` on a weekend returns the *following* Monday, not the preceding one
- [x] `effectiveProductionDate` returns `production_date` when set, else `prevBusinessDay(requested_delivery_date)`, else null
- [x] All helpers are pure — no `Date.now()`, no timezone conversion; callers pass the reference date in
- [x] `DB_DATE_FORMAT` remains the single wire format for any string returned
- [x] Month and year boundaries handled (e.g. Mon 1 Jun → Fri 29 May)

**Tests required:**
- `lib/__tests__/dates.test.ts` → `prevBusinessDay maps Mon/Sat/Sun to prior Friday` → `expect Fri for all three inputs`
- `lib/__tests__/dates.test.ts` → `prevBusinessDay crosses a month boundary` → `expect Fri 29 May for Mon 1 Jun`
- `lib/__tests__/dates.test.ts` → `startOfBusinessWeek on a weekend returns next Monday` → `expect following Mon`
- `lib/__tests__/dates.test.ts` → `effectiveProductionDate falls back and returns null when both null` → `expect production_date, then prevBusinessDay, then null`

**Depends on:** None

**Status:** [x] Done 2026-07-26 — 21 tests. Also added `InvalidDateError` to `lib/errors.ts` (EH-05). Task 52 must reject weekend `production_date` writes; the read helper does not.

---

## Task 51: Calendar read queries ✅ Done 2026-07-26

> Added 2026-07-26 via `@create-plan`. Source: `docs/prd.md` Feature 11 (D16 / CONSTRAINT-19).

**Files:**
- `db/queries/calendar.ts` — create
- `db/queries/calendar.constants.ts` — create
- `db/queries/__tests__/calendar.test.ts` — create

**Functions to implement:**
- `getCalendarOrders(input: { from: string; to: string }): Promise<CalendarOrderRow[]>` — every order with `status <> 'cancelled'` whose COALESCE(production_date, prior-business-day-of-requested_delivery_date) falls in `[from, to]`. Joins `customers` for `customer_name`. Returns the 6 qty columns, the 6 `unit_price_*` columns, `price`, `backhaul`, `same_day_delivery`, `status`, `production_date`, `requested_delivery_date`, `production_sort_index`.
- `getUnscheduledOrders(): Promise<CalendarOrderRow[]>` — `status <> 'cancelled' AND production_date IS NULL AND requested_delivery_date IS NULL`, ordered by `po_number`.
- `CalendarOrderRow` — exported type only; client components must `import type` from here (Platform-Native Rule).
- `db/queries/calendar.constants.ts` — `UNSCHEDULED_DROPDOWN_VISIBLE = 4`, `CALENDAR_WEEKS_BUFFER = 4`. Client-safe values live here, never in `calendar.ts`.

**Acceptance criteria:**
- [x] The COALESCE + prior-business-day rule is computed **in SQL** and matches `effectiveProductionDate` exactly — **but the index claim in this criterion is wrong.** `COALESCE(...)` in a WHERE predicate is not sargable, so `orders_production_date_idx` cannot serve the range filter; Postgres will seq-scan. Unmeasurable at ~130 rows. Fix if it ever matters: an IMMUTABLE functional index on the same expression.
- [x] `cancelled` orders excluded from both queries
- [x] `completed` and `invoiced` orders ARE included by `getCalendarOrders` (guarded by a test asserting no `status =`/`status IN` predicate exists)
- [x] Orders with both dates NULL excluded from `getCalendarOrders` and returned by `getUnscheduledOrders`
- [x] Weekend `requested_delivery_date` values resolve to the prior Friday, never a Sat/Sun bucket
- [x] Results ordered by effective date, then `production_sort_index` NULLS LAST, then `po_number`
- [x] Parameterised SQL only — test asserts the range values never appear inline in the compiled SQL text
- [x] `calendar.constants.ts` imports nothing from `db/index.ts` (client-safe) — test reads the file and asserts zero `import`/`require`

**Tests required:**
- `db/queries/__tests__/calendar.test.ts` → `builds range query with COALESCE + prior-business-day fallback` → `expect SQL to contain the fallback expression and bound params`
- `db/queries/__tests__/calendar.test.ts` → `excludes cancelled orders from both queries` → `expect status <> 'cancelled' predicate in each`
- `db/queries/__tests__/calendar.test.ts` → `unscheduled query requires both dates null` → `expect both IS NULL predicates`

**Depends on:** Task 49, Task 50
**Specialist:** @db

**Status:** [x] Done 2026-07-26 — 18 tests. `parseDbDate` promoted to an export in `lib/dates.ts`. **SQL-shape coverage only — never executed against Postgres.** Apply migration `0010` and load `/calendar` before trusting it.

---

## Task 52: Calendar server actions ✅ Done 2026-07-27

> Added 2026-07-26 via `@create-plan`. Source: `docs/prd.md` Feature 11 (D16 / CONSTRAINT-19).

**Files:**
- `lib/actions/calendar.ts` — create
- `lib/actions/calendar.validation.ts` — create
- `lib/actions/__tests__/calendar.test.ts` — create

**Functions to implement:**
- `setProductionPlacement(id: string, input: { productionDate: string; sortIndex: number }): Promise<{ success: true } | { error: string }>` — writes `production_date` + `production_sort_index` in one statement. **Must never write `requested_delivery_date`** (CONSTRAINT-19).
- `clearProductionPlacement(id: string): Promise<{ success: true } | { error: string }>` — sets both production columns to NULL. Backs both `Remove from calendar` and the drag-onto-callout gesture.
- `toggleSameDayDelivery(id: string, next: boolean): Promise<{ success: true } | { error: string }>`
- `lib/actions/calendar.validation.ts` — Zod schemas + `SORT_INDEX_MAX`. `'use server'` files export async only, so every constant and schema lives in this sibling (Platform-Native Rule).

**Acceptance criteria:**
- [x] Every action calls `assertAuthenticated()` first and returns the auth error unchanged
- [x] Every action validates `id` with `UUID_RE` before any DB access
- [x] `productionDate` validated against `ISO_DATE_RE` **and** rejected when it falls on a Saturday or Sunday — the no-weekend invariant is enforced server-side, not merely by the absence of weekend columns
- [x] `cancelled` orders rejected with a clear message; `completed`/`invoiced` also rejected for placement changes, since those cards are not draggable
- [x] No action writes `requested_delivery_date` on any code path
- [x] All three call `revalidatePath('/calendar')` and `revalidatePath('/dashboard')` on success (CONSTRAINT-02 — no optimistic-only state)
- [x] Failures log with context via `console.error` and return `GENERIC_FAILURE_MESSAGE` — never swallowed
- [x] `lib/actions/calendar.ts` exports async functions only

**Tests required:**
- `lib/actions/__tests__/calendar.test.ts` → `setProductionPlacement writes production_date and sort index` → `expect payload to contain both and NOT requested_delivery_date`
- `lib/actions/__tests__/calendar.test.ts` → `setProductionPlacement rejects a Saturday date` → `expect error`
- `lib/actions/__tests__/calendar.test.ts` → `setProductionPlacement rejects a cancelled order` → `expect error`
- `lib/actions/__tests__/calendar.test.ts` → `clearProductionPlacement nulls both columns` → `expect both set to null`
- `lib/actions/__tests__/calendar.test.ts` → `toggleSameDayDelivery persists the boolean` → `expect update payload`
- `lib/actions/__tests__/calendar.test.ts` → `unauthenticated calls are rejected before any DB access` → `expect auth error, db not called`

**Depends on:** Task 49, Task 50
**Specialist:** @db

**Status:** [x] Done 2026-07-26 — 17 tests (545 suite-wide). Weekend rejection lives in the Zod schema, so it also catches shape-valid-but-impossible dates like `2026-02-31`. `toggleSameDayDelivery` deliberately stays available on `completed`/`invoiced` (the flag is delivery logistics, not a placement) — `clearProductionPlacement` does not, since it *is* a placement change.

---

## Task 53: Nav entry + `/calendar` route ✅ Done 2026-07-27

> Added 2026-07-26 via `@create-plan`. Source: `docs/prd.md` Feature 11 (D16 / CONSTRAINT-19).

**Files:**
- `components/shell/NavDrawer.tsx` — modify
- `app/(app)/calendar/page.tsx` — create
- `components/shell/__tests__/NavDrawer.test.tsx` — modify

**Functions to implement:**
- Add `{ label: 'Calendar', href: '/calendar', icon: CalendarDays }` to `NAV_ITEMS`, between Orders and Leads (7 items total)
- `CalendarPage({ searchParams }: { searchParams: { week?: string } })` — async server component. Parses an optional `?week=YYYY-MM-DD` (validated with `ISO_DATE_RE`, ignored when malformed), computes the fetch range as `CALENDAR_WEEKS_BUFFER` weeks either side, fetches `getCalendarOrders` + `getUnscheduledOrders` in `Promise.all`, returns `<PageTransition><CalendarLayout … /></PageTransition>`

**Acceptance criteria:**
- [x] Nav drawer shows 7 items with Calendar between Orders and Leads
- [x] Active state highlights on `/calendar` via the existing `pathname === href || pathname.startsWith(href + '/')` rule
- [x] Page is a server component — no `'use client'`, no `@dnd-kit` or `framer-motion` import (CONSTRAINT-03)
- [x] Auth guard and `dynamic = 'force-dynamic'` inherited from `app/(app)/layout.tsx`; the page does not redeclare them — confirmed by `next build` listing `/calendar` as `ƒ (Dynamic)`
- [x] Malformed `?week=` is ignored and the page falls back to the current business week rather than erroring
- [x] Data fetched server-side and passed as props — no client-side fetching

**Tests required:**
- `components/shell/__tests__/NavDrawer.test.tsx` → `renders the Calendar nav item between Orders and Leads` → `expect 7 items in order`
- `components/shell/__tests__/NavDrawer.test.tsx` → `marks Calendar active on /calendar` → `expect active styling`

**Depends on:** Task 51
**Specialist:** @ui-totetrack

**Status:** [x] Done 2026-07-26 — 20 tests (563 suite-wide), `next build` clean.
> **Spec contradiction — this task's `Depends on: Task 51` is wrong.** The body specifies `<CalendarLayout>`, which **Task 55** creates. Logged as **FI-03**. Builder-approved resolution: the page renders a `CalendarPlaceholder` (a ~15-line local component in `page.tsx`, marked at both its definition and its call site). **Task 55 must delete it and substitute `<CalendarLayout rows={rows} unscheduled={unscheduled} weekStart={weekStart} />`.**
> **Second deviation:** `?week=` parsing and range-building were extracted to `lib/calendar-range.ts` (`parseCalendarWeek`, `buildCalendarRange`) rather than left inline as specified. No route component in this project is unit-tested; the established convention for page-level parsing is a `lib/` sibling with its own test file (`lib/parse-initial-mode.ts`). The malformed-`?week=` criterion is untestable without it.

---

## Task 54: `ProductionCard` component ✅ Done 2026-07-27

> Added 2026-07-26 via `@create-plan`. Source: `docs/prd.md` Feature 11 (D16 / CONSTRAINT-19).

**Files:**
- `components/calendar/ProductionCard.tsx` — create
- `components/calendar/productionCardFormat.ts` — create
- `components/calendar/__tests__/ProductionCard.test.tsx` — create

**Functions to implement:**
- `formatProductionMix(values: QtyGridValues): { text: string; hiddenCount: number }` — builds `12×275 REC, 8×330 REB` from at most 4 non-zero combos, reporting how many were hidden. Codes: recon → `REC`, rebot → `REB`, new → `NEW`. Imports `SIZE_COLS` / `TYPE_ROWS` / `cellKey` from `components/shared/qtyGridValues` — these moved there in Feature 10 and are **no longer exported from `QtyGrid`**.
- `ProductionCard({ row, isDragging }: ProductionCardProps)` — `'use client'`. Renders PO number with right-aligned `B` / `SD` tags, customer name, mix, and delivery date or `—`.
- `SameDayTag()` — two-character `SD` pill, `rounded-md`, `bg-amber-100 text-amber-800`, `h-5`, mirroring `BackhaulTag`'s weight and size.

**Acceptance criteria:**
- [x] Card height driven by `--card-h`, identical for every card regardless of content — **`--card-h` did not exist in any CSS file and was created this task** in `app/globals.css`
- [x] Customer name always reserves exactly 2 lines and truncates past that; mix always reserves exactly 2 lines — `line-clamp-2` on a fixed-height slot
- [x] `--card-h: clamp(80px, calc(25vh - 70px), 104px)`; padding, the 4 row heights and their font sizes interpolate off it so the rows always sum to `--card-h` — **fractions were not specified and are the implementer's choice**; they sum to exactly 1.00 and are commented in `globals.css`. See the status note below
- [x] 5th and 6th combos collapse to `+N more`; a 6-combo order shows 4 combos and `+2 more`
- [x] Null `requested_delivery_date` renders `—`, matching every other PO list surface
- [x] Delivery date formatted with `format(parseISO(d), 'MMM d')` → `Jul 31`
- [x] `completed` / `invoiced` rows render dimmed and expose no drag affordance
- [x] Prices never appear on the card — asserted directly against the rendered DOM
- [x] `BackhaulTag` reused unchanged, not reimplemented
- [x] Component file under 200 lines (CQ) — formatting logic lives in `productionCardFormat.ts`

**Tests required:**
- `components/calendar/__tests__/ProductionCard.test.tsx` → `renders up to 4 combos then +N more` → `expect "+2 more" for a 6-combo order`
- `components/calendar/__tests__/ProductionCard.test.tsx` → `renders em dash when delivery date is null` → `expect —`
- `components/calendar/__tests__/ProductionCard.test.tsx` → `renders B and SD tags together` → `expect both present`
- `components/calendar/__tests__/ProductionCard.test.tsx` → `built cards are dimmed and not draggable` → `expect no drag handle attrs`

**Depends on:** Task 50
**Specialist:** @ui-totetrack

**Status:** [x] Done 2026-07-26 — 16 tests (579 suite-wide), `next build` clean.
> **`--card-h` was created, not consumed.** A repo-wide grep found zero hits for `card-h` or `clamp(` outside `.md` files — the token existed only as prose in `prd.md:592` and `constraints.md:279`. Defined in `app/globals.css` `:root` (not in this task's file list) so Task 55's `DayColumn` can size its scroll area against the same token.
> **The per-row fractions are unspecified and were chosen by the implementer:** padding 2×0.05, po 0.21, name 0.25, mix 0.25, date 0.19 — sum exactly 1.00, with 2-line rows using `line-height = row / 2`. At the 80px floor this yields ~8px text on the mix line, **denser than the PRD's stated "~10px" target**. Six text lines (1 + 2 + 2 + 1) cannot fit 80px at 10px each, so either the fractions or the two-lines-each requirement must give. **`@designer` decision — resolve before Task 55 locks column geometry around these numbers.**
> **Not visually verified.** `ProductionCard` has no importer yet; jsdom does not lay out `clamp()` or `line-clamp`, so the 2-line clamp, the interpolation and the 4-card fit are all unproven. Task 55 is the first real test.

---

## Task 55: `CalendarLayout` + `DayColumn` — viewport-locked week strip ✅ Done 2026-07-27

> Added 2026-07-26 via `@create-plan`. Source: `docs/prd.md` Feature 11 (D16 / CONSTRAINT-19).

**Files:**
- `components/calendar/CalendarLayout.tsx` — create
- `components/calendar/DayColumn.tsx` — create
- `components/calendar/WeekStrip.tsx` — create
- `components/calendar/__tests__/CalendarLayout.test.tsx` — create

**Functions to implement:**
- `CalendarLayout({ rows, unscheduled, weekStart }: CalendarLayoutProps)` — `'use client'`. Owns scroll position and the `Current week` action. Header band reuses the Orders idiom (`pl-20 pr-4 pt-4 pb-3 border-b border-border`); body sits on `bg-app-bg`.
- `WeekStrip({ weeks, todayKey })` — renders week groups, each with a range label and a 2px Fri│Mon divider between groups.
- `DayColumn({ date, rows, isToday, onAdd })` — reuses the `OpenOrdersWidget` skeleton exactly: `rounded-xl bg-card border border-border`, `px-4 py-2.5 border-b border-border bg-muted/50` header, footer with a `text-sm font-medium text-primary hover:underline` action.
- `groupRowsByDay(rows: CalendarOrderRow[]): Map<string, CalendarOrderRow[]>` — pure; move to a sibling if `CalendarLayout` approaches the line cap.

**Acceptance criteria:**
- [x] Root is `h-[calc(100vh-0.75rem)]` with `overflow-hidden` — **markup written; the four viewports were NOT observed** ⚠
- [x] Column width 176px so 5 columns + gaps + the 80px pill gutter + 16px fit within 1024px — `w-44` = 11rem = 176px; `80 + 880 + 32 + 16 = 1008` ≤ 1024, verified arithmetically
- [x] Column height derives from the viewport through a flex chain with `min-h-0`, never a hardcoded pixel height
- [x] 4 whole cards visible without scrolling at every viewport height down to 600px — **NOT observed** ⚠
- [x] Below 600px viewport height the card holds its 80px floor and the column scrolls instead — **NOT observed** ⚠
- [x] Both the horizontal strip and each column render a visible scrollbar — `.calendar-scroll` added to `globals.css` with both standard and `::-webkit-scrollbar` forms; **NOT observed** ⚠
- [x] Opens scrolled to the current business week; on Sat/Sun that is the *following* Mon–Fri — tested
- [x] `Current week` returns to that week; respects `useReducedMotion()` by jumping instead of smooth-scrolling — tested both branches
- [x] Day header shows weekday and date only — no order count
- [x] Today's column header filled `bg-primary` with `text-primary-foreground` — tested, exactly one column filled
- [x] Past days render identically to future days — no date-relative styling exists in `DayColumn`
- [x] Empty day shows `Nothing scheduled.` in the existing empty-state style — tested
- [x] `+ Add order` sits in the column footer, hidden on hover-capable fine-pointer devices only and permanently visible otherwise (`@media (hover: hover) and (pointer: fine)`) — CSS written; **media query NOT observed** ⚠
- [x] Every interactive element ≥44px (iPad touch standard) — `min-h-[44px]` on both; **NOT observed** ⚠
- [x] Each component file under 200 lines (CQ) — 151 / 109 / 100 / 110

**Tests required:**
- `components/calendar/__tests__/CalendarLayout.test.tsx` → `renders five weekday columns per week` → `expect Mon–Fri only, no Sat/Sun`
- `components/calendar/__tests__/CalendarLayout.test.tsx` → `opens on the current business week` → `expect current Monday's group in view`
- `components/calendar/__tests__/CalendarLayout.test.tsx` → `weekend visit targets the following Monday` → `expect next Mon–Fri`
- `components/calendar/__tests__/CalendarLayout.test.tsx` → `empty day renders the empty state` → `expect "Nothing scheduled."`

**Depends on:** Task 54
**Specialist:** @ui-totetrack

**Status:** [x] Done 2026-07-26 — 22 tests (601 suite-wide), `next build` clean, `CalendarPlaceholder` deleted as Task 53 required.
> **⚠ Six criteria above are marked `[x]` on static reasoning, not observation.** jsdom evaluates no layout — no `clamp()`, `calc()`, `min-h-0`, `line-clamp`, `overflow` or media queries. The viewport-lock, the 4-card fit, the 80px floor behaviour, the visible scrollbars, the hover-gated `+ Add order` and the 44px touch targets have **never been seen rendering**. Browser verification was attempted and abandoned: `/calendar` is behind the `app/(app)/layout.tsx` auth guard and the implementer will not sign in as the builder. **The builder must open `/calendar` and check those six by hand before Task 56.**
> **Three `globals.css` additions, none in this task's file list:** `.calendar-scroll` (no scrollbar styling existed anywhere in the repo) and the `@media (hover: hover) and (pointer: fine)` block for `.day-column-action` (Tailwind cannot express the gate with a built-in variant).
> **`groupRowsByDay` + `buildWeekGroups` went straight to `components/calendar/calendarWeeks.ts`** rather than starting in `CalendarLayout` — the layout hit the line cap on its own content.
> **`unscheduled` renders as a plain `N unscheduled` count**, since the callout is Task 57. Task 57 replaces that span. `+ Add order` renders but resolves to a documented no-op (`handleAddOrder`) for the same reason.

---

## Task 56: `@dnd-kit` wiring — drag between days, reorder, edge auto-scroll ✅ Done 2026-07-27

> Added 2026-07-26 via `@create-plan`. Source: `docs/prd.md` Feature 11 (D16 / CONSTRAINT-19).

**Files:**
- `package.json` — modify (`@dnd-kit/core`, `@dnd-kit/sortable`)
- `components/calendar/CalendarDndContext.tsx` — create
- `components/calendar/DayColumn.tsx` — modify (droppable + sortable context)
- `components/calendar/ProductionCard.tsx` — modify (sortable node)
- `components/calendar/__tests__/CalendarDnd.test.tsx` — create

**Functions to implement:**
- `CalendarDndContext({ children, onPlace })` — `'use client'`. Configures `PointerSensor` (6px distance activation, so a tap still opens the popup), `TouchSensor` (≈250ms long-press with tolerance, so a swipe scrolls instead of dragging) and `KeyboardSensor`. Wires `closestCenter` collision detection and the auto-scroll activator with a ~80px edge threshold.
- `handleDragEnd(event: DragEndEvent)` — resolves target day and index, then calls `setProductionPlacement`. A drop at the origin position is a no-op and must not fire a mutation.
- `DragOverlay` rendering a `ProductionCard` clone.

**Acceptance criteria:**
- [x] `@dnd-kit/core` and `@dnd-kit/sortable` added to `package.json`; both are client-only and every file importing them carries `'use client'` (CONSTRAINT-03) — `calendarDnd.ts` uses `import type` only
- [x] Dragging a card to another day calls `setProductionPlacement` with the new date and released index — resolver + mutation hook tested; **no real drag simulated**
- [~] Dragging within a day persists the new sequence, and the order survives a reload — reorder resolution tested; **"survives a reload" NOT verified end-to-end**
- [x] Cards land at the exact index released — never appended to the end — tested, including the column-append exception
- [~] Holding a dragged card near either edge auto-scrolls the strip — `AUTO_SCROLL_EDGE_RATIO` configured and asserted; **the scrolling itself is NOT observed** ⚠
- [x] `completed` / `invoiced` cards are not draggable — tested: no listeners, no `aria-roledescription`
- [x] Nothing can be dropped on a non-weekday — no weekend drop target exists; the strip renders Mon–Fri only and the server rejects weekend dates independently
- [~] A tap (movement below the 6px threshold) opens the popup instead of starting a drag — **only half satisfiable: the popup is Task 58.** The 6px threshold is set so a tap does not drag; **Task 58 must wire the tap handler**
- [~] On touch, a swipe scrolls the calendar and only a long-press starts a drag — 250ms/8px `TouchSensor` configured; **this is A-05 and it is still unvalidated** ⚠
- [~] Keyboard drag works via `KeyboardSensor` with visible focus — sensor wired with `sortableKeyboardCoordinates`; **NOT observed** ⚠
- [~] `useReducedMotion()` respected — no drop animation when set — `dropAnimation={null}` set on the branch; **the animation is NOT observed** ⚠
- [x] A failed mutation surfaces a toast and the card returns to its original position — never a silent revert — tested. No optimistic move exists (CONSTRAINT-02), so there is nothing to roll back

**Tests required:**
- `components/calendar/__tests__/CalendarDnd.test.tsx` → `drop on another day calls setProductionPlacement with that date` → `expect action called with new date and index`
- `components/calendar/__tests__/CalendarDnd.test.tsx` → `drop at origin does not call the action` → `expect action not called`
- `components/calendar/__tests__/CalendarDnd.test.tsx` → `built cards expose no drag listeners` → `expect disabled sortable`
- `components/calendar/__tests__/CalendarDnd.test.tsx` → `failed placement shows a toast and reverts` → `expect toast and original position`

**Depends on:** Task 52, Task 55
**Specialist:** @ui-totetrack

**Status:** [x] Done 2026-07-26 — 19 tests (620 suite-wide), `next build` clean, `/calendar` bundle 5.95 kB → 23.7 kB.
> **Six criteria above are `[~]`, not `[x]`.** No real drag has ever occurred — jsdom cannot produce one, and simulating it would only test the mock. Auto-scroll, touch long-press, keyboard drag, the reduced-motion drop animation and reload persistence are all **configured and unit-tested at the constant level, never observed**. Criterion 8 is structurally half-satisfiable: the popup it names is Task 58.
> **A-05 did not exist in `docs/assumptions.md`** despite two handoffs citing it. `@dev`'s pre-code gate reads that file and would have blocked. Written up properly during this task with its contingency (tap-to-select-then-tap-target) and flagged as still unvalidated. **This is the assumption most likely to fire on this project.**
> **The sortable node is `SortableProductionCard.tsx`, not `ProductionCard` as specified.** Making the presentational card require a `DndContext` would break Task 57's dropdown, Task 58's popup, and all 16 existing card tests, which render it bare.
> **`@dnd-kit/utilities` was deliberately not installed** — it is only transitive. `toTranslate` in `calendarDnd.ts` replaces the one helper needed.
> **Task 58 owes this task a tap handler.** The 6px threshold exists so a tap is not a drag; nothing yet opens a popup on that tap.

---

## Task 57: `UnscheduledCallout` + dropdown drop target ✅ Done 2026-07-27

> Added 2026-07-26 via `@create-plan`. Source: `docs/prd.md` Feature 11 (D16 / CONSTRAINT-19).

**Files:**
- `components/calendar/UnscheduledCallout.tsx` — create
- `components/calendar/AddOrderMenu.tsx` — create
- `components/calendar/__tests__/UnscheduledCallout.test.tsx` — create

**Functions to implement:**
- `UnscheduledCallout({ rows, onPlace, onClear })` — `'use client'`. Amber pill (`bg-amber-100 text-amber-800`, `rounded-full`, `min-h-[44px]`) showing the count plus "need a production date". Opens a dropdown of `ProductionCard`s, 4 visible then scroll. Registers as a `@dnd-kit` droppable so a card dragged onto it calls `clearProductionPlacement`.
- `AddOrderMenu({ date, rows, onPick })` — the per-day `+ Add order` list, rendering the same unscheduled set.

**Acceptance criteria:**
- [x] Count equals `getUnscheduledOrders().length` and decrements when an order is placed — count tested; the decrement follows from `revalidatePath` + `router.refresh()`, **not observed**
- [~] Dropdown shows exactly 4 cards before scrolling (`UNSCHEDULED_DROPDOWN_VISIBLE`) — height rule derived from the constant and asserted; **jsdom evaluates no `calc()`, so the rendered result is unverified** ⚠
- [~] Dragging a card out of the dropdown onto a day sets its `production_date` — cards are draggable with an `UNSCHEDULED_ORIGIN` sentinel and the resolver handles it; **the gesture is unexercised**
- [x] Dragging a card from the calendar onto the callout calls `clearProductionPlacement` — `resolveUnscheduleTarget` + the mutation tested across all branches
- [~] The dropdown auto-opens when a card is dragged over the collapsed pill — `useDndMonitor` wired; **firing it needs a real drag, so this is code-inspection only** ⚠
- [x] Per-day `+ Add order` lists exactly the same set as the callout — both take `getUnscheduledOrders()`; tested
- [x] Zero unscheduled orders renders an empty state rather than a bare `0` pill — the pill is not rendered at all; tested
- [x] Callout keyboard reachable, `aria-expanded` reflects state, trigger ≥44px — tested, including Escape
- [~] A dated order dropped on the callout visibly returns to its default day — correct by construction (`effective_production_date` falls back to the prior business day) but **never seen**

**Tests required:**
- `components/calendar/__tests__/UnscheduledCallout.test.tsx` → `shows the unscheduled count` → `expect count text`
- `components/calendar/__tests__/UnscheduledCallout.test.tsx` → `drop on the callout clears the production date` → `expect clearProductionPlacement called`
- `components/calendar/__tests__/UnscheduledCallout.test.tsx` → `renders empty state when nothing is unscheduled` → `expect empty copy, no pill count`

**Depends on:** Task 51, Task 56
**Specialist:** @ui-totetrack

**Status:** [x] Done 2026-07-26 — 17 tests (638 suite-wide), `next build` clean, `/calendar` 23.7 → 24.7 kB.
> **Four criteria are `[~]`.** All four need a real drag or real CSS layout; jsdom provides neither. The drag-over auto-open in particular is **code-inspection only**.
> **The DnD context moved up to wrap the header** — the callout is a `useDroppable` and must sit inside `DndContext`. No DOM wrapper is added, so the root flex column is unchanged.
> **`DayColumnParts.tsx` created** (not in the file list): the `+ Add order` menu pushed `DayColumn.tsx` to 209 lines, past the 200 cap. Split with the project's existing `*Parts` idiom; `DayColumn` is now 91 lines.
> **`+ Add order` appends** (`index = column length`) rather than inserting — a pick has no released position, unlike a drag.
> **Menu rows are plain buttons, not `ProductionCard`s** — 176px is too narrow for a card-in-a-menu. This is the payoff for keeping `ProductionCard` context-free in Task 56.
> **`getUnscheduledOrders()` has still never returned a row against the live DB**, so the callout has only ever rendered its empty state with real data. Seeding a both-dates-NULL order is now three sessions overdue.

---

## Task 58: `ProductionCardDialog` — read-only popup ✅ Done 2026-07-27

> Added 2026-07-26 via `@create-plan`. Source: `docs/prd.md` Feature 11 (D16 / CONSTRAINT-19).

**Files:**
- `components/calendar/ProductionCardDialog.tsx` — create
- `components/calendar/__tests__/ProductionCardDialog.test.tsx` — create

**Functions to implement:**
- `ProductionCardDialog({ open, row, onClose, onToggleSameDay, onRemove })` — `'use client'`. Reuses the `CancelOrderDialog` shell exactly: `fixed inset-0 z-50 bg-black/40` backdrop, `bg-card rounded-xl shadow-lg max-w-md w-full p-6 space-y-4` panel, `modalVariants` from `lib/animations`, Escape-to-close, backdrop-click-to-close.
- Body: PO number + `OrderStatusBadge`, same-day toggle row, customer, `<QtyGrid mode="display" values={…} unitPrices={…} />`, derived total, production date, requested delivery date, backhaul, notes.
- Footer: `Remove from calendar` (ghost) + `Open in Orders` (primary) linking to `/orders?id=[uuid]`.

**Acceptance criteria:**
- [x] Reuses `QtyGrid` display mode with `unitPrices` so filled cells render `qty / $unit`, matching PO detail since Feature 10 — tested
- [x] Orders with NULL unit prices fall back to bare quantities without crashing or rendering `$null` — tested for both `$null` and `NaN`
- [x] Total shows the derived `price`, formatted with the shared currency formatter — tested
- [x] Same-day toggle calls `toggleSameDayDelivery` — tested with both `true` and `false`. The card's `SD` tag updating depends on `revalidatePath` + `router.refresh()`, **not observed**
- [x] No control on the dialog can edit any other order field — asserted directly: one checkbox, zero textboxes/spinbuttons/comboboxes/textareas
- [x] `Remove from calendar` calls `clearProductionPlacement` and closes the dialog — tested
- [x] `Open in Orders` navigates to `/orders?id=[uuid]` — href asserted
- [x] Escape and backdrop click close; focus trapped while open and restored to the card on close — all four tested. **This is the first focus trap in the project**; the other five dialogs have neither
- [~] Respects `useReducedMotion()` via the shared `modalVariants` — wired on both backdrop and panel; **the animation itself is not observed** ⚠
- [x] File under 200 lines (CQ) — 162, plus `ProductionCardDialogParts.tsx` (170) and `productionCardDialogHooks.ts` (98)

**Tests required:**
- `components/calendar/__tests__/ProductionCardDialog.test.tsx` → `renders qty / $unit for priced cells` → `expect formatted string`
- `components/calendar/__tests__/ProductionCardDialog.test.tsx` → `falls back to bare quantities when unit prices are null` → `expect no $ rendered, no crash`
- `components/calendar/__tests__/ProductionCardDialog.test.tsx` → `same-day toggle calls the action` → `expect toggleSameDayDelivery called with next value`
- `components/calendar/__tests__/ProductionCardDialog.test.tsx` → `remove calls clearProductionPlacement and closes` → `expect action called and onClose fired`

**Depends on:** Task 52, Task 54
**Specialist:** @ui-totetrack

**Status:** [x] Done 2026-07-26 — 17 tests (655 suite-wide), `next build` clean, `/calendar` 24.7 → 24.9 kB.
> **`CalendarOrderRow` had no `notes` field**, so the specified body was not satisfiable. Added `o.notes` to the Task 51 query + interface. It is the only long-text column on the row and is fetched for every card while only the popup reads it — first candidate if the calendar payload ever needs trimming.
> **This is the first focus trap in the codebase.** All five existing dialogs (`CancelOrderDialog`, `RevertOrderDialog`, `DeleteCustomerDialog`, `OverwriteInvoiceDialog`, `ConvertLeadDialog`) set initial focus and handle Escape but let Tab escape the panel and never restore focus on close. **Worth its own task.**
> **Task 56's tap-handler debt is paid** — `SortableProductionCard` calls `selectCard(row)` on click, via a `cardSelection` context rather than six prop hops. **Untested risk:** if `@dnd-kit`'s `PointerSensor` does not suppress the click that follows a real drag, dropping a card would also open its popup. First thing to check in a browser.
> **`useProductionPlacement` was rewritten**, not extended — `setSameDay` pushed it to 61 lines with the same call-toast-refresh block three times. `useCalendarMutation` now holds the error path once.

---

## Task 59: Dashboard Production widget ✅ Done 2026-07-27

> Added 2026-07-26 via `@create-plan`. Source: `docs/prd.md` Feature 11 (D16 / CONSTRAINT-19).

**Files:**
- `components/dashboard/ProductionWidget.tsx` — create
- `components/dashboard/DashboardView.tsx` — modify
- `db/queries/dashboard.ts` — modify
- `db/queries/dashboard.sql.ts` — modify
- `app/(app)/dashboard/page.tsx` — modify
- `components/dashboard/__tests__/ProductionWidget.test.tsx` — create

**Functions to implement:**
- `buildProductionWidgetQuery(days: string[])` in `dashboard.sql.ts` — rows for the given business days, using the same COALESCE + prior-business-day rule as Task 51.
- `getProductionWidgetData(today: Date): Promise<{ groups: { date: string; rows: ProductionWidgetRow[]; total: number }[]; unscheduledCount: number }>` — the next 2 business days via `nextBusinessDay`, capped at 3 rows per group with the remainder as a count.
- `ProductionWidget({ groups, unscheduledCount })` — `'use client'`. Copies the widget skeleton verbatim: `rounded-xl bg-card border border-border`, `px-4 py-2.5 border-b border-border bg-muted/50` header, `min-h-[44px]` rows, `px-4 py-3 border-t border-border` footer.
- Mount in `DashboardView` alongside `OpenOrdersWidget`.

**Acceptance criteria:**
- [x] Shows the next 2 **business** days — on Friday that is Fri + Mon; on Sat/Sun it is Mon + Tue — tested from Mon/Thu/Fri/Sat/Sun plus a sweep asserting no weekend is ever emitted
- [~] ~~Group labels read `Today` / `Tomorrow` only when literally true~~ — **superseded 2026-07-27.** Relative labels removed entirely at the builder's request; every column is headed with the real weekday and date. The two days are now **side-by-side columns**, not stacked groups
- [x] Up to 4 rows per group, remainder shown as `+ N more` — tested at both the query and component layers. **Revised 2026-07-27 (was 3):** builder asked for an 8-order snapshot, 4 per day, matching the calendar's own 4-cards-per-column target
- [x] `B` and `SD` tags sit immediately **after the customer name** — asserted structurally: the tags share a parent with the customer name, not the PO number
- [x] Footer shows the unscheduled count as an amber pill and a `View calendar` link to `/calendar` — tested; zero renders `All orders dated` rather than a `0` pill
- [x] Empty day renders an empty state, not a blank group — tested at both layers
- [x] Rows ≥44px and link to `/orders?id=[uuid]` consistent with the other widgets — tested
- [x] Header, divider and footer treatment match the other dashboard widgets exactly — class strings copied from `OpenOrdersWidget`; **visual match not observed** ⚠

**Tests required:**
- `components/dashboard/__tests__/ProductionWidget.test.tsx` → `renders two business-day groups` → `expect 2 group headings`
- `components/dashboard/__tests__/ProductionWidget.test.tsx` → `on Friday the second group is Monday` → `expect Mon label`
- `components/dashboard/__tests__/ProductionWidget.test.tsx` → `caps at 3 rows and shows the remainder` → `expect "+2 more"`
- `components/dashboard/__tests__/ProductionWidget.test.tsx` → `shows the unscheduled count` → `expect amber pill text`

**Depends on:** Task 51
**Specialist:** @ui-totetrack

**Status:** [x] Done 2026-07-26 — 30 tests (685 suite-wide), `next build` clean.
> **The placement rule did NOT become a third copy.** `EFFECTIVE_PRODUCTION_DATE` moved from inside `db/queries/calendar.ts` to `db/queries/effectiveProductionDate.sql.ts` and is now imported by both the calendar and the widget queries. Still exactly two implementations — one SQL, one TypeScript (`lib/dates.ts`) — as CONSTRAINT-19 requires. **Update this note in CONSTRAINT-19 during Task 60: the SQL half now lives in its own file.**
> **`db/queries/production-widget.ts` + `.constants.ts` created**, not in the file list. Appending to `dashboard.ts` put it at 374 lines (over the 300 cap), and the pure helpers had to leave the DB-importing module because the widget test pulled the postgres driver into vitest — the same trap `calendar.constants.ts` exists to prevent.
> **`nextBusinessDay` is strictly after its argument**, so `productionWidgetDays` seeds the window with today when today is a weekday. Seeding with `nextBusinessDay(today)` would have shown Wed + Thu on a Tuesday.
> **⚠ The new SQL has never executed.** `sql.join` building an `IN (…::date)` list is new syntax for this codebase, verified by string shape only — the same gap that let a real syntax bug ship in `customerVolumeAveragesQuery`. **Worth one live smoke test before Task 60**, as the calendar queries got in the Task 49–51 session.

---

## Task 60: Documentation sync ✅ Done 2026-07-27

> Added 2026-07-26 via `@create-plan`. Source: `docs/prd.md` Feature 11 (D16 / CONSTRAINT-19).

**Files:**
- `docs/architecture.md` — modify
- `docs/founder-brief.md` — modify (**required** — see below)
- `docs/constraints.md` — modify
- `docs/data-model.md` — modify

> **Why `founder-brief.md` is mandatory here:** `@end-session` Step 2 states that `docs/architecture.md` cannot change without `docs/founder-brief.md` also updating — they are the technical and plain-language views of the same decision. This task changes the architecture stack table, so an FB entry is required. Caught during `@end-session` on 2026-07-26.

**Functions to implement:**
- `founder-brief.md` → append **FB-11 — Drag-and-Drop Library Added to a Locked Stack** (FB-10 is currently last). Use the established format: Decided / Means for your product / Check before approving / What this closes off. Content: `@dnd-kit/core` + `@dnd-kit/sortable` added for sortable reordering, edge auto-scroll, keyboard drag, and iPad touch drag-vs-scroll disambiguation; CONSTRAINT-01 forbids library *substitutions*, not additions, so no rule was broken; approved by Builder without `@cto` review; closes off nothing, but sets the precedent that dependency additions are allowed when no in-stack option exists.
- `architecture.md` → Stack table: add `Drag and drop | @dnd-kit/core + @dnd-kit/sortable | Latest`
- `architecture.md` → Routing Structure: add `calendar/page.tsx`
- `architecture.md` → Component Tree: add the `components/calendar/` group
- `architecture.md` → Component Boundary Rule: extend to name `@dnd-kit` alongside `framer-motion` and `recharts`
- `architecture.md` → Database Layer: add `db/queries/calendar.ts` and `lib/actions/calendar.ts`
- `constraints.md` → CONSTRAINT-03: add `@dnd-kit` to the client-only library list
- `data-model.md` → `orders`: document the 3 new columns. This file was reconciled through migration 0008 on 2026-07-25 and must not be allowed to drift again.

**Acceptance criteria:**
- [x] Stack table lists `@dnd-kit` with its role
- [x] `founder-brief.md` gains a brief covering the `@dnd-kit` addition — **appended as FB-12, not FB-11.** FB-11 has existed since Task 51 (the production-date decision); the spec's "FB-10 is currently last" was stale
- [x] Component boundary rule names all client-only libraries, so no future task imports `@dnd-kit` into a server component — also documents that a **type-only** import needs no directive
- [x] CONSTRAINT-03 and the architecture boundary rule agree word for word on the library list — verified programmatically by byte-identical substring match, and both now carry a note to change them together
- [x] `data-model.md` documents `production_date`, `same_day_delivery`, `production_sort_index` with nullability and defaults — plus `orders_production_date_idx` and the migration-0010 header date
- [x] No doc still refers to the Production Calendar as "Feature 10" or to migration `0009` — **already true; nothing changed.** The 9 surviving hits all refer to the per-combo unit-pricing feature, which genuinely is Feature 10 / migration 0009. A find-and-replace here would have corrupted the pricing docs

**Tests required:**
- None — documentation only. Verified by review against the shipped code.

**Depends on:** Tasks 49–59

**Status:** [x] Done 2026-07-27 — documentation only; `tsc` and 685/685 tests confirm no source was touched.
> **Appended as FB-12.** The spec's instruction to write FB-11 was stale — Task 51 already used that number.
> **Corrected a fact the spec predates:** both `architecture.md` and `constraints.md` said the SQL half of the placement rule lives in `db/queries/calendar.ts`. Task 59 moved it to `db/queries/effectiveProductionDate.sql.ts`. CONSTRAINT-19 now states that two implementations is the ceiling and any new consumer imports rather than copies.
> **The component tree was diffed against disk**, not written from memory — `calendarWeeks.ts` was missing on the first pass.

---

## Feature 11 (Production Calendar) — code-complete 2026-07-27

Tasks 49–60 all `[x]`. Test suite 482 → **685**.

**Not yet done, and it is the whole risk surface:** none of this has been opened in a browser. jsdom evaluates no `calc()`, `clamp()`, `min-h-0` or media queries and cannot produce a real pointer event, so **14 criteria across Tasks 55–59 are marked `[~]`**. Two named risks: the click-after-drag interaction (Task 58) may open a popup on every drop, and `buildProductionWidgetQuery`'s `sql.join` list (Task 59) has never executed against Postgres.

**Next per the Completion Order:** `@code-review`, then `@qa` if this is a shippable checkpoint.

---

# Feature 12 — Orders list ergonomics + Calendar write surface

> Added 2026-07-27. Planned directly with the builder (not via `@create-plan` — its pre-check requires `manifest.md`, which does not exist).
> Tasks 61–62 are Orders-tab only and shipped independently. Tasks 63–67 extend the calendar from a placement-only surface to one that also creates orders and changes status.

---

## Task 61: Orders list — drop pagination ✅ Done 2026-07-27

**Files:**
- `db/queries/orders.ts` — modify
- `db/queries/orders.constants.ts` — **delete**
- `components/orders/OrderPagination.tsx` — **delete**
- `components/orders/OrderTable.tsx`, `OrderLayout.tsx`, `app/(app)/orders/page.tsx` — modify
- `db/queries/__tests__/orders.test.ts`, `components/orders/__tests__/OrderTable.test.tsx`, `OrderLayout.test.tsx` — modify

**Acceptance:**
- [x] Every order for the active filter renders in one scroll; no pagination footer
- [x] `getOrders` runs a single query — the `COUNT(*)` round-trip is gone
- [x] A stale `?page=2` URL still loads the list (param ignored, not an error)
- [x] Row click preserves the active status filter
- [x] `architecture.md`'s Platform-Native Rule precedent repointed to `db/queries/calendar.constants.ts`

---

## Task 62: Orders list — search by PO number or customer name ✅ Done 2026-07-27

**Files:**
- `db/queries/orders.ts` — modify (`search?: string` on `GetOrdersFilters`, `buildSearchClause`)
- `app/(app)/orders/page.tsx`, `components/orders/OrderTable.tsx`, `OrderLayout.tsx` — modify
- `db/queries/__tests__/orders.test.ts`, `components/orders/__tests__/OrderTable.test.tsx` — modify

**Acceptance:**
- [x] Case-insensitive partial match on `po_number` OR customer `company_name`
- [x] Search ANDs with the active status tab
- [x] Whitespace-only term emits no ILIKE clause
- [x] Term is parameterized — never string-concatenated (SEC-02)
- [x] Tab switch and row click both preserve the search term
- [x] 250ms debounce (deliberate divergence from the customers tab — the response is now the unbounded full list)
- [x] Empty state reads "No orders match that search."

> **Deviation from the original spec, applied:** `buildStatusClause` emitted `WHERE o.status = …` and returned empty SQL for `status=all`, so an `AND` search clause had nothing to attach to. The base query now carries a `WHERE TRUE` anchor and both clauses emit `AND`, matching `db/queries/leads.ts`. Behaviour-neutral; planner-neutral.

---

## Task 63: `createOrder` accepts a production-date override ✅ Done 2026-07-27

**Files:**
- `lib/actions/orders.validation.ts` — modify
- `lib/actions/orders.internal.ts` — modify
- `lib/actions/orders.ts` — modify
- `lib/actions/__tests__/orders.test.ts` — modify

**Functions to implement:**
- `normalizeCreate(data)` — when `data.production_date` is supplied, use it verbatim; otherwise fall back to `defaultProductionDate(base.requested_delivery_date)` exactly as today.

**Acceptance:**
- [ ] An explicit `production_date` wins over the delivery-date default, whatever the delivery date is (CONSTRAINT-19 — position is stored, never derived)
- [ ] Omitting it preserves today's behaviour byte for byte
- [ ] A Saturday or Sunday `production_date` is **rejected on write** with a user-facing error — the no-weekend invariant is enforced on write, never on read (CONSTRAINT-19). Reuse the Zod rule already in `lib/actions/calendar.validation.ts` rather than writing a second one
- [ ] `createOrder` revalidates `/calendar` and `/dashboard` in addition to `/orders` — the new card and the dashboard widget must both appear without a manual reload
  > Spec corrected during Task 63: this originally said `/`, which would be a no-op — `app/page.tsx` is a bare `redirect('/dashboard')` and the widget lives at `/dashboard`. Matches the existing `CALENDAR_REVALIDATE_PATHS`.
- [ ] Tests: happy path (override honoured), error case (weekend rejected), regression (no override → unchanged default)

---

## Task 64: "Add Purchase Order" from a day column ✅ Done 2026-07-27

**Files:**
- `components/calendar/AddOrderMenu.tsx` — modify
- `components/calendar/newOrderDay.tsx` — create (context, mirroring `cardSelection.tsx`)
- `components/calendar/DayColumnParts.tsx` — modify
- `components/calendar/CalendarLayout.tsx` — modify
- `components/shell/DetailDrawer.tsx` — modify (additive `alwaysOverlay` prop)
- `app/(app)/calendar/page.tsx` — modify (3rd parallel fetch: `getActiveCustomersForSelect()`)
- `components/calendar/__tests__/CalendarLayout.test.tsx` — modify

**Acceptance:**
- [ ] The day menu shows "Add Purchase Order" above the unscheduled list, visually separated
- [ ] Selecting it opens the right drawer with `OrderForm mode="create"`; the user never leaves `/calendar`
- [ ] The saved order's `production_date` is the day whose `+` was clicked — **regardless of the delivery date entered in the form**
- [ ] Drawer closes on save and the new card appears in that column
- [ ] The `/calendar` page still never scrolls; the drawer scrolls internally (CONSTRAINT-19)
- [ ] `DetailDrawer`'s existing five consumers (Orders, Customers, Leads, Invoices, Support) are visually unchanged — the new prop is opt-in and defaults to current behaviour
- [ ] The day signal reaches the menu via context, not prop drilling through `DayColumn`/`WeekStrip`

---

## Task 65: Backhaul + Same-day pill toggles in the card popup ✅ Done 2026-07-27

**Files:**
- `lib/actions/calendar.ts` — modify (`toggleBackhaul`)
- `lib/actions/calendar.validation.ts` — modify
- `components/calendar/ProductionCardDialog.tsx` / `ProductionCardDialogParts.tsx` — modify
- `components/calendar/useProductionPlacement.ts` — modify
- `lib/actions/__tests__/calendar.test.ts`, `components/calendar/__tests__/ProductionCardDialog.test.tsx` — modify

**Functions to implement:**
- `toggleBackhaul(orderId: string, next: boolean): Promise<{ success: true } | { error: string }>` — mirrors `toggleSameDayDelivery`. Takes the target state rather than flipping, so a double-fired click cannot toggle twice.

**Acceptance:**
- [ ] Two pill toggles render on one row at the top of the popup: Backhaul, then Same-day delivery
- [ ] Both persist to Postgres and survive a reload
- [ ] Backhaul is removed from `DetailFields` — it must not render twice
- [ ] Toggling is permitted on `invoiced` / `cancelled` orders (CONSTRAINT-18 permits non-qty/price edits)
- [ ] Failure surfaces a toast and leaves the pill in its true state — no optimistic-only UI (CONSTRAINT-02)
- [ ] Tests: happy + error path per action

---

## Task 66: Status block in the card popup ✅ Done 2026-07-27

**Files:**
- `components/calendar/ProductionCardDialog.tsx` + a new sibling parts file — modify/create
- `components/calendar/productionCardDialogHooks.ts` — modify
- `components/orders/OrderStatusActions.tsx` — modify (additive `onDialogOpenChange`)
- `lib/actions/orders.ts` — modify (`updateOrderStatus` revalidation)
- `lib/actions/orders.revert.ts` — modify (revalidation)
- `components/calendar/__tests__/ProductionCardDialog.test.tsx` — modify

**Acceptance:**
- [ ] `OrderStatusActions` renders below the pill row and behaves exactly as on the Orders tab: Mark as Complete + Cancel Order on `scheduled`; Revert to Scheduled on the other three
- [ ] Cancelling removes the card from the calendar and closes the popup — the calendar filters `status <> 'cancelled'`; reverting a cancelled order is only possible from the Orders tab, by design
- [ ] Marking complete dims the card in place and makes it non-draggable, keeping its sequence slot
- [ ] **Escape with a confirm dialog open closes only the confirm dialog, not the popup underneath.** Feed nested-dialog state into the existing `useEscapeClose(open, onClose, disabled)` flag — the same mechanism that already gates Escape while `isBusy`
- [ ] Focus is trapped in the topmost dialog and returns to the popup when the confirm closes
- [ ] `updateOrderStatus` and `revertOrderToScheduled` both revalidate `/calendar` and `/` — without this the card does not disappear after a cancel
- [ ] The Orders tab's own status block is behaviourally unchanged
- [ ] Both dialog files stay within the 200-line component cap (CQ-02)

---

## Task 67: Dim built orders harder ✅ Done 2026-07-27

**Files:**
- `components/calendar/ProductionCard.tsx` — modify
- `components/dashboard/ProductionWidget.tsx` — modify
- `db/queries/dashboard.sql.ts` — modify (select `o.status`)
- `db/queries/production-widget.constants.ts` — modify (`status` on `ProductionWidgetRow`)
- `components/calendar/__tests__/ProductionCard.test.tsx`, `components/dashboard/__tests__/ProductionWidget.test.tsx` — modify

**Acceptance:**
- [ ] Completed/invoiced calendar cards are clearly distinguishable from active ones at a glance
- [ ] Dimming does **not** breach the legibility floor — CONSTRAINT-19 ranks text legibility above card density. Combine a modest opacity drop with a background shift rather than opacity alone
- [ ] The dashboard production widget dims built rows too — it currently has no status-based treatment at all, and `ProductionWidgetRow` does not carry `status` until this task adds it
- [ ] `useReducedMotion` behaviour unchanged

---

# Feature 13 — Touch interaction replacement: long-press-to-arm + tap-to-place

> Added 2026-07-27, after A-05's contingency fired on a real iPad (see `docs/assumptions.md` → A-05 for the diagnosis). Planned directly with the builder; brainstorm settled cancel semantics, insert-position semantics, unschedule parity, and desktop scope in-session.
>
> **Sequencing: docs-only until Feature 12 (Tasks 63–67) lands.** Both features modify `CalendarLayout.tsx`, `DayColumnParts.tsx`, `ProductionCard.tsx` and the calendar tests; starting Task 68's code while Feature 12 is in flight would collide in the working tree. This section is the approved spec, written while that work proceeds.

---

## Task 68: Long-press-to-arm + tap-to-place on touch devices ✅ Done 2026-07-27

**Why this exists:** Touch drag was unusable on a real iPad in every browser (all WebKit). Root causes: iPadOS's own long-press behaviours (text-selection callout, native drag) were never suppressed and fire on top of the `TouchSensor` drag; the 8px activation tolerance is tighter than natural fingertip drift; and nothing signals when activation happens. Per the A-05 contingency, the touch sensor is **replaced, not tuned** — but with a revised design, because the originally agreed tap-to-select fallback conflicts with tap-opens-popup (shipped in Task 58). Desktop pointer drag and the keyboard path are untouched.

**Interaction model (settled with the builder 2026-07-27):**
- A ≈350ms still-finger long-press on a card **arms** it — shake + bold outline (outline only under reduced motion). Finger movement or scroll during the press cancels arming and becomes an ordinary scroll.
- Arming works both on calendar cards and on cards inside the unscheduled callout dropdown.
- While armed, one tap resolves the placement:
  - **Another card** (any day, including the armed card's own day) → armed card takes that card's position; that card and everything below shift down one.
  - **Empty column space below a day's cards** → armed card appends as that day's last card.
  - **Unscheduled callout** → armed card is unscheduled (parity with drag-to-callout and `Remove from calendar` — CONSTRAINT-19's one-operation rule now has three entry points).
  - **The armed card itself, or anything else** → cancel. No write.
- Scrolling the strip or a column while armed does **not** cancel — browsing to a distant week and then tapping is the intended path (this is the key advantage over drag, which required edge auto-scroll).
- While armed, taps never open the card popup. Unarmed taps open the popup exactly as today.
- Placement animates the card flying to its new slot (framer-motion layout animation); instant under reduced motion.

**Files:**
- `components/calendar/calendarDnd.ts` — modify: arm-delay/move-tolerance constants; retire the `TouchSensor` constants
- `components/calendar/CalendarDndContext.tsx` — modify: remove `TouchSensor`; gate `PointerSensor` activation to mouse/pen so it cannot race the long-press on touch
- `components/calendar/useLongPressArm.ts` — create: touch-only long-press detection (timer + move/scroll cancellation)
- `components/calendar/armMode.tsx` — create: armed-card context + tap routing that resolves to the existing `onPlace` / `onUnschedule`
- `components/calendar/ProductionCard.tsx`, `SortableProductionCard.tsx` — modify: armed visual state; iOS gesture-suppression CSS (`-webkit-touch-callout: none`, `user-select: none`, `-webkit-user-drag: none`) so the OS long-press behaviours stop firing; popup suppression while armed
- `components/calendar/DayColumn.tsx` / `DayColumnParts.tsx` — modify: empty-space tap target (append)
- `components/calendar/UnscheduledCallout.tsx` — modify: tap-to-unschedule target; arming inside the dropdown
- `components/calendar/CalendarLayout.tsx` — modify: outside-tap cancel
- `components/calendar/__tests__/` — modify `CalendarDnd.test.tsx`, `ProductionCard.test.tsx`, `UnscheduledCallout.test.tsx`; create `useLongPressArm.test.ts`

**Status: [x] Done 2026-07-27 — built at `60abf0a`, validated on the real iPad by the builder the same day. Suite 685 → 791. This closes A-05 and completes Feature 13.**

**Acceptance:**
- [x] Long-press arms; shake + bold outline; outline-only under `useReducedMotion` (shake disabled via `prefers-reduced-motion` in `globals.css` — same OS signal `useReducedMotion` reads)
- [x] Finger movement past tolerance, or a scroll, during the press cancels arming and scrolls normally
- [x] Tap on another card inserts at that card's position and shifts it and everything below down one — same-day taps reorder by the identical rule (`resolveTapAction` converts the rendered index to the same post-removal insertion index a drag produces, so the server cannot tell the gestures apart)
- [x] Tap on empty column space appends to that day
- [x] Tap on the unscheduled callout unschedules; an already-unscheduled armed card tapped there is a no-op (no write)
- [x] Tap on the armed card itself or anywhere else cancels with no write; a tap resolving to the card's current position writes nothing
- [x] Cards inside the unscheduled dropdown can be armed and placed onto a day
- [x] Strip and column scrolling while armed preserves the armed state (cancel rides on `click`, which a scroll gesture never produces)
- [x] While armed, no tap opens the card popup; unarmed tap-to-popup is byte-for-byte unchanged
- [x] Placement animates the card to its destination (framer-motion `layoutId` flight, mounted only for the just-placed card so desktop drags never fight it); instant under reduced motion
- [x] Desktop mouse drag and keyboard drag behave exactly as before; `PointerSensor` no longer activates from touch pointers (`MouseAndPenPointerSensor`); `TouchSensor` is gone
- [x] iOS long-press system behaviours (selection callout, native drag) do not fire on cards (`.calendar-card-press` in `globals.css`) — *CSS is in place; observable only on the device, covered by the validation criterion*
- [x] Tests: happy + error path per new function; insert-index math; unschedule parity; popup suppression while armed (`armPlacement.test.ts`, `useLongPressArm.test.tsx`, `armMode.test.tsx`, additions to `UnscheduledCallout.test.tsx`; 791/791 pass)
- [x] **Validated on a real iPad: arm, place across weeks with a scroll in between, same-day reorder, unschedule, cancel, popup unaffected.** Confirmed by the builder 2026-07-27
- [x] `docs/assumptions.md` A-05, `docs/prd.md`, `docs/architecture.md`, and `docs/founder-brief.md` (FB-14) updated to final state at close — A-05 marked validated 2026-07-27

---

# QA Fix — 2026-07-27 BLOCKED report

> Added 2026-07-27 by `@qa` → builder approval. Source: `docs/qa-report.md` (Status: BLOCKED — finding 1, with findings 4a/4b bundled as nearly-free test-only additions). Not a PRD feature — a coverage fix task, added manually per `@qa`'s BLOCKED closing procedure.

---

## Task 69: Test the read-path access-control gate (+ bundled minor coverage gaps)

**Why this exists:** `app/(app)/layout.tsx` is the *only* access-control gate on the read path — `db/queries/*` perform no auth checks by design, and `middleware.ts` only refreshes tokens ("errors here are non-fatal", it gates nothing). Page reads go through Drizzle's direct Postgres connection, so RLS does not protect them either. The `getUser()` + `redirect('/login')` in this layout is the entire login wall for viewing data, and it has zero tests: a regression would silently expose every screen (customers, orders, invoices, pricing) to anyone with the public Vercel URL, while all 806 tests stayed green — and the only real user would never notice, because they're always logged in. The 2026-04-25 QA report claimed tests existed in `app/(app)/__tests__/`; they do not. This is the outage-postmortem lesson applied proactively: `redirect()` lines in this codebase demonstrably get touched.

**Files:**
- `app/(app)/__tests__/layout.test.tsx` — create
- `lib/actions/auth.ts` — modify (`signOut` error handling only — `signIn` untouched; the 🔴 outage guard in `docs/api-spec.md` applies)
- `lib/actions/__tests__/auth.test.ts` — modify (signOut error cases)
- `components/calendar/__tests__/UnscheduledCallout.test.tsx` (or sibling) — modify (hook-level `setBackhaul` coverage beside the existing `setSameDay` tests)

**Functions to implement:**
- No new production functions. `signOut(): Promise<{ error: string } | void>` gains a catch so a thrown `supabase.auth.signOut()` rejection no longer escapes unhandled — logged with context, surfaced as `GENERIC_FAILURE_MESSAGE` (follow `signIn`'s existing error-shape precedent).

**Acceptance criteria:**
- [x] Layout guard test mocks the server Supabase client + `next/navigation`'s `redirect` (the pattern existing action tests already use — no new test infra)
- [x] `getUser()` returns no user → `redirect('/login')` called, children NOT rendered
- [x] `getUser()` returns an error → treated as unauthenticated → redirect, children NOT rendered
- [x] `getUser()` returns a valid user → children render, `redirect` never called
- [x] [TS-04] read-path access control is now covered by tests — clears QA finding 1
- [x] `signOut`: thrown/rejected `supabase.auth.signOut()` is caught — [EH-01] failure logged with context, user-facing `GENERIC_FAILURE_MESSAGE`, never an unhandled rejection; [TS-01] auth functions carry 2 error cases
- [x] `useProductionPlacement.setBackhaul` exercised at hook level: happy path + refused-mutation path (parity with the existing `setSameDay` tests)
- [x] `signIn` and its `redirect()` are byte-for-byte untouched (production-outage guard)
- [x] Suite green (`npx vitest run`), `npx tsc --noEmit` clean; no production behavior change except the `signOut` catch

**Tests required:**
- `app/(app)/layout` → `redirects to /login when no user` (error case)
- `app/(app)/layout` → `redirects to /login when getUser errors` (error case)
- `app/(app)/layout` → `renders children for an authenticated user` (happy path)
- `signOut` → `returns generic failure when auth service throws` (error case)
- `signOut` → `returns generic failure when signOut rejects` (error case)
- `useProductionPlacement.setBackhaul` → happy + refused-mutation

**Status:** [x] Done 2026-07-27 — layout guard + signOut error handling + setBackhaul hook coverage shipped; 7 new tests (813 suite-wide), `tsc` clean, `signIn` untouched. NavDrawer gained a one-line action wrapper for the new signOut return type (noted in session log).

**Depends on:** None

---

# Feature 14: Multiple Saved Delivery Addresses — 2026-07-28

> Source: `docs/prd.md` → Feature 14. Order of work: 70 → 71 → 72 and 73 (72/73 independent of each other). Migration 0012 runs against the shared dev/prod database (CONSTRAINT-20) — additive-only, live the moment it runs; no `db:seed`/`db:wipe` at any point.

## Task 70: `customer_addresses` schema, migration 0012, and query layer

**Files:**
- `db/schema/customers.ts` — modify (add `customerAddresses` table beside `customerContacts`, same style)
- `db/migrations/0012_customer_addresses.sql` — create (hand-authored, house style with comment header)
- `db/queries/customers.select.ts` — modify (extend dropdown query with per-customer address list)
- `db/migrations/__tests__/0012.test.ts` — create
- `db/queries/__tests__/customers.test.ts` — modify

**Functions to implement:**
- `customerAddresses` pgTable: `id uuid PK defaultRandom`, `customer_id uuid notNull FK → customers.id onDelete: 'cascade'`, `address text notNull`, `last_used_at timestamptz` (nullable), `created_at`/`updated_at` timestamptz notNull defaultNow, `index('customer_addresses_customer_id_idx')`
- Migration 0012: `CREATE TABLE`; backfill `INSERT INTO customer_addresses (customer_id, address) SELECT id, default_delivery_address FROM customers WHERE default_delivery_address IS NOT NULL AND btrim(default_delivery_address) <> ''`; `ENABLE ROW LEVEL SECURITY` + `authenticated_access` policy (copy the 0002 pattern verbatim)
- `getActiveCustomersForSelect(): Promise<CustomerSelectOption[]>` — extend with `addresses: { id: string; address: string }[]` via `json_agg` scalar subquery, ordered `last_used_at DESC NULLS LAST, created_at DESC`; `CustomerSelectOption` KEEPS deprecated `default_delivery_address` until Task 72 (amended 2026-07-28 — `useDeliveryAddressAutofill` still compiles against it; both removed together in Task 72)

**Acceptance criteria:**
- [x] [CONSTRAINT-05] migration enables RLS + `authenticated_access` policy on `customer_addresses`
- [x] Migration is purely additive — no DROP/ALTER of existing columns; `default_delivery_address` untouched in the DB
- [x] Backfill skips NULL and blank-after-trim addresses
- [x] Given a customer with 3 addresses, when options load, then `addresses` is ordered MRU-first; a customer with none gets `[]`
- [x] [EH-01] query failures throw `DatabaseError` with `{ operation, cause }` logged

**Tests required:**
- `0012.test.ts` → SQL-text asserts: creates table, backfills, enables RLS + policy, touches nothing else (0011 pattern) (happy + guard)
- `getActiveCustomersForSelect` → `returns MRU-ordered addresses arrays per customer` (happy path)
- `getActiveCustomersForSelect` → `throws DatabaseError with cause when the underlying query fails` (error case)

**Status:** [x] Done 2026-07-28 — schema + migration 0012 (NOT yet applied to the shared DB — builder-gated) + MRU query extension; 10 new tests (823 suite-wide), `tsc` clean. Deviations logged in session log: interface keeps deprecated field until Task 72; `OrderForm.test.tsx` literals gained `addresses: []`.

**Depends on:** None

---

## Task 71: Customer-address server actions

**Files:**
- `lib/actions/customer-addresses.ts` — create
- `lib/actions/__tests__/customer-addresses.test.ts` — create

**Functions to implement:**
- `addCustomerAddress(customer_id: string, address: string): Promise<{ id: string } | { error: string }>` — dedupe: exact-text match for that customer bumps `last_used_at` and returns the existing id
- `updateCustomerAddress(id: string, address: string): Promise<{ success: true } | { error: string }>`
- `deleteCustomerAddress(id: string): Promise<{ success: true } | { error: string }>` — hard delete; past orders unaffected (snapshot design)

**Acceptance criteria:**
- [x] All three call `assertAuthenticated()` first; `UUID_RE` guards on ids; blank/whitespace-only address rejected server-side
- [x] [SEC-03] inputs validated server-side regardless of client validation (zod `trim().min(1).max(500)` — cap added matching `DELIVERY_ADDRESS_MAX`)
- [x] [EH-01] failures logged with `{ operation, cause }` context, generic user-facing error returned — never thrown to the client
- [x] `revalidatePath` on success — `/customers`, `/orders`, `/calendar` (file-local `ADDRESS_REVALIDATE_PATHS`)
- [x] [CQ-01] each function < 50 lines (longest 34)

**Tests required:**
- `addCustomerAddress` → `inserts and returns id for a new address` (happy path)
- `addCustomerAddress` → `bumps last_used_at and returns existing id on exact-text duplicate` (edge)
- `addCustomerAddress` → `returns error when unauthenticated / blank address` (error case)
- `updateCustomerAddress` → `updates address text` (happy path) / `rejects invalid uuid` (error case)
- `deleteCustomerAddress` → `deletes the row` (happy path) / `returns generic error when db throws` (error case)

**Status:** [x] Done 2026-07-28 — 3 actions + 10 tests (833 suite-wide), `tsc` clean. Dedupe via exact trimmed-text `eq`; update/delete report "Address not found." on empty `.returning()`.

**Depends on:** Task 70

---

## Task 72: Order form — address dropdown with inline add-new + MRU

**Files:**
- `components/orders/AddressSelect.tsx` — create (`'use client'`; dropdown + "+ Add new address" textarea toggle; < 200 lines)
- `components/orders/OrderLogisticsFields.tsx` — modify (replace address textarea with `AddressSelect`)
- `components/orders/useOrderForm.ts` — modify (delete `useDeliveryAddressAutofill`; reset address selection when `customer_id` changes)
- `components/orders/orderFormSchema.ts` — modify (add `delivery_address_id: string | null` form value; `formValuesToCreateInput` passes it through)
- `lib/actions/orders.ts` — modify (`createOrder` post-insert address handling)
- `lib/actions/orders.validation.ts` — modify (`CreateOrderInput` gains optional `delivery_address_id`)
- `components/orders/__tests__/OrderForm.test.tsx` — modify
- `lib/actions/__tests__/orders.test.ts` — modify

**Functions to implement:**
- `AddressSelect({ addresses, value, onSelect, disabled })` — renders saved addresses MRU-first, pre-selects the first; "+ Add new address" swaps to a textarea; selection writes text into `delivery_address` and id into `delivery_address_id` (new-address entries carry `delivery_address_id: null`)
- `createOrder` post-insert: `delivery_address_id` present → bump that row's `last_used_at`; absent with non-blank `delivery_address` → insert into `customer_addresses` with `last_used_at = now()` (exact-text dedupe → bump instead)

**Acceptance criteria:**
- [x] Given a customer with saved addresses, when picked, then the dropdown pre-selects MRU and `delivery_address` is populated — no typing
- [x] Given zero saved addresses, the address input renders as the textarea directly (cleaner than a one-option dropdown; "+ Add new address" path)
- [x] A new address entered on the order form is persisted to `customer_addresses` within `createOrder`
- [x] Changing the customer resets the address selection
- [x] Edit mode: current snapshot displayed even when it matches no saved row; unchanged resubmit does not create a duplicate (dedupe; `delivery_address_id` stays null)
- [x] Address remains optional — pickup-only behavior byte-for-byte unchanged; [CONSTRAINT-19] calendar never writes `requested_delivery_date`
- [x] Calendar's embedded `OrderForm` (Feature 12 drawer) works unchanged
- [x] [CONSTRAINT-03] `AddressSelect` is `'use client'`; [CQ-01] functions < 50 lines; [CQ-02] components < 200 lines (state split into `useAddressSelect.ts`)
- [x] [SEC-03] server validates `delivery_address_id` is a UUID belonging to the order's customer before the order insert

**Tests required:**
- `AddressSelect` → `pre-selects the MRU address and populates the field` (happy path)
- `AddressSelect` → `shows only add-new when the address list is empty` (edge)
- `OrderForm` → `resets address selection when the customer changes` (happy path)
- `createOrder` → `bumps last_used_at when delivery_address_id is provided` (happy path)
- `createOrder` → `inserts a new customer address when no id and text is non-blank` (happy path)
- `createOrder` → `dedupes an exact-text match instead of inserting` (edge)
- `createOrder` → `rejects a delivery_address_id not belonging to the customer` (error case)

**Status:** [x] Done 2026-07-28 — AddressSelect + useAddressSelect + MRU preselect hook + createOrder ownership check & bookkeeping (`orders.addresses.ts`); `useDeliveryAddressAutofill` deleted; deprecated field dropped from `CustomerSelectOption` (planned here). 14 new tests (847 suite-wide), `tsc` clean. No transaction around insert+bookkeeping (mirrors existing plain insert); post-insert bookkeeping failure contained + logged, create still succeeds — pinned by test.

**Depends on:** Task 70, Task 71

---

## Task 73: Customer detail address management + deprecate `default_delivery_address`

**Files:**
- `components/customers/CustomerAddresses.tsx` — create (`'use client'`; list + inline add/edit/delete with delete confirmation; < 200 lines)
- `components/customers/CustomerDetail.tsx` — modify (render "Delivery Addresses" section)
- `components/customers/CustomerFormBasicFields.tsx` — modify (remove the `default_delivery_address` textarea)
- `components/customers/customerFormSchema.ts` — modify (remove the field from `CustomerFormValues`, `detailToFormValues`, `formValuesToInput`)
- `lib/actions/customers.ts` — modify (`createCustomer`/`updateCustomer` stop writing `default_delivery_address`)
- `db/queries/customers.ts` — modify (customer detail query includes the address list; stops selecting the deprecated column where practical)
- `components/customers/__tests__/CustomerAddresses.test.tsx` — create
- `components/customers/__tests__/CustomerForm.test.tsx`, `CustomerDetail.test.tsx` — modify

**Functions to implement:**
- `CustomerAddresses({ customerId, addresses })` — MRU-first list; inline add (textarea + save), inline edit, delete with confirm; wired to Task 71 actions; loading/error states surfaced

**Acceptance criteria:**
- [x] Detail panel lists addresses MRU-first with working add/edit/delete via Task 71 actions
- [x] Delete asks for confirmation before calling the action (inline row-level confirm; guard-tested)
- [x] [EH-01] action errors surface visibly in the UI — never silently swallowed
- [x] `default_delivery_address` is no longer rendered or written anywhere in app code (DB column remains, deprecated — drop deferred; repo grep verified)
- [x] Existing customer create/edit flows pass unchanged tests apart from the removed field
- [x] [CQ-02] `CustomerAddresses` 195 lines (< 200; state split into `useCustomerAddresses.ts`); [CONSTRAINT-03] `'use client'`
- [x] Suite green (`npx vitest run` — 860/860), `npx tsc --noEmit` clean

**Tests required:**
- `CustomerAddresses` → `renders the list and completes an add flow` (happy path)
- `CustomerAddresses` → `surfaces the action error message on failure` (error case)
- `CustomerForm` → `renders no address textarea and omits the field from the submit payload` (happy path)

**Status:** [x] Done 2026-07-28 — CustomerAddresses (195) + useCustomerAddresses hook + `customers.detail.ts` query split (cured pre-existing 300-cap breach in `db/queries/customers.ts`); deprecation sweep verified by repo grep. 13 new tests (860 suite-wide), `tsc` clean. Feature 14 code-complete; PRD boxes await browser verification.

**Depends on:** Task 70, Task 71

---

## Task 74: Need-to-Contact — suppress customers with a scheduled order

**Rule change (stub — approved in-session 2026-08-02):** a customer with any `status = 'scheduled'` order is never overdue for contact — an order is already booked. `overdue_days` returns NULL for them (all surfaces show nothing), and the dashboard Need-to-Contact list excludes them. Frequency math stays completed-only. Implemented as `has_scheduled_order` (`bool_or`) in the `order_stats` CTEs in `db/queries/customer-overdue.sql.ts` + a WHERE guard in `buildNeedToContactQuery`. Read-path only — no schema change.

**Acceptance criteria:**
- [x] Customer with a scheduled order: absent from Need-to-Contact, `overdue_days` NULL on customer list + detail
- [x] Suite green, `tsc` clean

**Status:** [x] Done 2026-08-02 — `has_scheduled_order` via `bool_or` in both `order_stats` CTEs; `WHEN os.has_scheduled_order THEN NULL` leads the overdue CASE; `IS NOT TRUE` guard in Need-to-Contact WHERE (NULL-safe for no-order customers). 3 new SQL-contract tests (878 suite-wide), `tsc` clean.

---

## Task 75: Calendar card popup — Contact button with nested contact picker

**Feature (stub — approved in-session 2026-08-09):** the production-card popup gains a `Contact` dropdown sitting first in the status button row, so all three actions (Contact + Mark as Complete + Cancel Order) read on one line. The menu opens the device's Messages or Mail app with the recipient prefilled — `sms:` / `mailto:` hrefs, recipient only, no prefilled body (templated messages deferred).

**Data:** `CalendarOrderRow` gains `contacts: CalendarContact[]`, embedded on the row via a `json_agg` correlated subquery in the shared `CALENDAR_SELECT_LIST` (primary-first, `COALESCE` to `[]`). Embedded rather than fetched on click **because this app has no client-side data-fetching pattern at all** — every client component is props-in, mutate-then-`router.refresh()`. Inventing the first fetch path for 1–3 contact rows was not worth the loading/error surface. Read-path only, no schema change.

**Menu shape:** one contact → the two channel items directly, no picker. Two or more → a single-open accordion of contact names, each revealing Message/Email indented beneath (an inline accordion rather than a Windows-style side flyout: the popup panel is `overflow-y-auto` and clips both axes, so a true flyout would need a portal, which would break the project's only focus trap). A channel with no stored value renders disabled, never a dead link. The trigger greys out when **no contact has a usable channel** — a contact holding neither email nor phone is the same dead end as no contact at all.

**Acceptance criteria:**
- [x] Three buttons on one line in the popup at iPad-landscape width; 44px touch targets held
- [x] 0 usable contacts greys the trigger; 1 contact skips the picker; 2+ nest one level
- [x] Missing phone or email renders that item disabled, not a dead `<a>`
- [x] Free-text phones sanitize to a dialable `sms:` href; extensions dropped
- [x] Escape closes the menu only — the popup closes on the next press (existing `useNestedDialog` channel)
- [x] Orders tab renders unchanged (`leadingAction` slot is optional and unset there)
- [x] Suite green, `tsc` clean

**Status:** [x] Done 2026-08-09 — `contacts` embedded via `json_agg` in `CALENDAR_SELECT_LIST`; `lib/contact-links.ts` + `ContactMenu`/`ContactMenuParts` (CQ-02 split); `leadingAction` slot on the shared `OrderStatusActions`. 34 new tests (912 suite-wide), `tsc` clean. One-line fit and the nested picker verified by the builder in the local dev server. `sms:` is inert on desktop Chrome — iPad only, not a defect.

**Depends on:** Feature 11 (calendar), Task 58 (card popup)

---

# Feature 15: Pickups (Tasks 76–81)

Spec: `docs/prd.md` → Feature 15. Binding: CONSTRAINT-25 (separate entity, two calendar lists), CONSTRAINT-21 (address snapshots), CONSTRAINT-20 (dev = prod — every migration is run by hand in the Supabase SQL editor).

---

## Task 76: Rename `orders.pickup_only` to `customer_collects`

Mechanical rename, no behavior change. Isolated so the naming ambiguity is gone before any pickups code lands. `pickup_only` always meant *the customer collects their order instead of us delivering it* — the opposite direction from a pickup.

**Files:**
- `db/migrations/0014_rename_pickup_only.sql` — create
- `db/migrations/__tests__/0014.test.ts` — create
- `db/schema/orders.ts`, `db/seed.ts`, `db/queries/orders.ts` (`OrderDetail` field + SELECT list) — modify
- `lib/actions/orders.validation.ts` (zod field + `requireDeliveryAddressWhenNotPickup` → `requireDeliveryAddressWhenNotCollected`), `orders.internal.ts`, `orders.addresses.ts`, `orders.ts` — modify
- `components/orders/orderFormSchema.ts`, `OrderFormFields.tsx`, `OrderLogisticsFields.tsx`, `AddressSelect.tsx`, `OrderDetail.tsx`, `OrderDetailParts.tsx` (label `"Pickup Only"` → `"Customer Collects"`) — modify
- Tests: `lib/actions/__tests__/orders.test.ts`, `db/queries/__tests__/orders.test.ts`, `components/orders/__tests__/OrderForm.test.tsx` (incl. the `/pickup only/i` matchers), `OrderDetail.test.tsx` — modify
- Docs: `docs/data-model.md`, `docs/api-spec.md` (`pickupOnly` → `customerCollects`) — modify

**Migration `0014_rename_pickup_only.sql`:** a single `ALTER TABLE "orders" RENAME COLUMN "pickup_only" TO "customer_collects";`

**Acceptance criteria:**
- [x] Zero occurrences of `pickup_only` / `pickupOnly` outside `db/migrations/` and the drizzle `meta/` snapshot — scoped to code; the surviving hits in `prd.md`, `constraints.md` and `plan.md` are deliberate narrative about the rename itself
- [x] The order form checkbox reads "Customer Collects"; the delivery address still hides when it is ticked
- [x] Suite green, `tsc` clean

**Tests required:**
- `0014 migration` → `test: renames the column and touches nothing else`
- `OrderForm` → `test: ticking Customer Collects hides the address field` (renamed from the pickup-only case)

**Sequencing:** the SQL runs against live prod. Between running it and Vercel finishing the deploy, order create/edit errors. Run it during a quiet window and push immediately.

**Status:** [x] Complete — 2026-08-10. Code + tests + docs renamed, suite green (938 tests, 85 files), `tsc` clean. `db/migrations/0014_rename_pickup_only.sql` was hand-run against prod in the Supabase SQL editor by the builder on 2026-08-10.

**Depends on:** None

---

## Task 77: `pickups` table, queries and actions

**Files:**
- `db/migrations/0015_pickups.sql`, `db/migrations/__tests__/0015.test.ts` — create
- `db/schema/pickups.ts` — create; `db/schema/enums.ts` (add `pickupStatusEnum`), `db/schema/index.ts` (barrel line) — modify
- `db/queries/pickups.ts` — create
- `lib/actions/pickups.ts` (`'use server'`), `lib/actions/pickups.validation.ts` (no directive — CONSTRAINT-24) — create
- `lib/errors.ts` (add `PickupNotFoundError`) — modify
- `lib/actions/customers.ts` (`deleteCustomer` zero-pickups check) — modify
- `db/queries/__tests__/pickups.test.ts`, `lib/actions/__tests__/pickups.test.ts` — create
- `docs/data-model.md` (pickups table + the `deleteCustomer` rule change) — modify

**Migration `0015_pickups.sql`:**
- `CREATE TYPE "pickup_status" AS ENUM ('scheduled', 'completed', 'cancelled');`
- `CREATE TABLE "pickups"` with: `id` uuid PK default `gen_random_uuid()`; `customer_id` uuid NOT NULL REFERENCES `customers(id)` ON DELETE RESTRICT; `status` pickup_status NOT NULL DEFAULT 'scheduled'; `qty_275` / `qty_330` integer NOT NULL DEFAULT 0; `pickup_date` date (nullable); `sort_index` integer (nullable); `address` text (nullable); `notes` text (nullable); `created_at` / `updated_at` timestamptz NOT NULL DEFAULT now()
- Indexes `pickups_customer_id_idx`, `pickups_status_idx`, `pickups_pickup_date_idx`
- `ALTER TABLE "pickups" ENABLE ROW LEVEL SECURITY;` plus the standard `authenticated_access` policy (`FOR ALL TO authenticated USING (true) WITH CHECK (true)`), matching `0012_customer_addresses.sql`

**Functions to implement:**
- `getPickups(filters?: GetPickupsFilters): Promise<{ rows: PickupTableRow[] }>` — status + customer-name search; scheduled first ascending by date, everything else after descending, mirroring `ORDER_CLAUSE` in `db/queries/orders.ts`
- `getPickupDetail(id: string): Promise<PickupDetail>` — throws `PickupNotFoundError`
- `createPickup(input): Promise<{ id: string } | { error: string }>`
- `updatePickup(id: string, input): Promise<{ success: true } | { error: string }>`
- `updatePickupStatus(id: string, target: 'completed' | 'cancelled' | 'scheduled'): Promise<{ success: true } | { error: string }>`

**Acceptance criteria:**
- [x] SEC-01/02: `assertAuthenticated()` inside the try in every exported action; zod `safeParse` before it; `UUID_RE` on every id param
- [x] CONSTRAINT-24: `pickups.validation.ts` carries no `'use server'`
- [x] At least one of `qty_275` / `qty_330` must be greater than 0; `QUANTITY_MAX` enforced
- [x] `pickup_date` optional — absent means unscheduled
- [x] Address optional; when present it is snapshotted on the pickup **and** upserted into `customer_addresses` through the existing `recordDeliveryAddressUsage` path (CONSTRAINT-21)
- [x] `deleteCustomer` refuses a customer holding pickups with a readable message, not a raw FK error (CONSTRAINT-13)
- [x] Writes revalidate `/pickups`, `/calendar`, `/customers` — never `/dashboard` (no widget shows pickups)
- [x] EH-01: `console.error` with operation, ids and cause, then `GENERIC_FAILURE_MESSAGE` to the client

**Tests required:**
- `getPickups` → `test: status and search clauses compile into the expected SQL` / `test: a driver rejection throws DatabaseError`
- `createPickup` → `test: writes the expected row` / `test: unauthenticated returns the generic failure`
- `updatePickupStatus` → `test: completes a scheduled pickup` / `test: an invalid uuid is rejected before any query`
- `deleteCustomer` → `test: refuses when the customer has pickups`

**Status:** [x] Done 2026-08-10 — migration + schema + queries + actions + `PickupNotFoundError` + `deleteCustomer` pickups guard; 990 tests / 88 files (was 938 / 85), `tsc` clean. Two additive changes outside the Files list: `calendarDateSchema` extracted out of `productionDateSchema` in `lib/actions/dates.validation.ts` (`pickup_date` needs the real-calendar-day check without CONSTRAINT-19's weekday rule), and `recordDeliveryAddressUsage` gained an optional `operation` param so a `createPickup` failure logs the right action (EH-02). `updatePickupStatus` allows reopen (`completed|cancelled → scheduled`) — a pickup has no price, invoice or document, so it is a plain flip; no-op transitions rejected. `db/migrations/0015_pickups.sql` was hand-run against prod in the Supabase SQL editor by the builder on 2026-08-10, alongside `0014`.

**Depends on:** Task 76

---

## Task 78: Pickups tab

Mirrors the Orders vertical: a server page reading URL params, a client two-panel layout, `DetailDrawer` on the right.

**Files:**
- `app/(app)/pickups/page.tsx` — create
- `components/pickups/PickupLayout.tsx`, `PickupTable.tsx`, `PickupRow.tsx`, `PickupStatusTabs.tsx`, `PickupStatusBadge.tsx`, `PickupDetail.tsx`, `PickupForm.tsx`, `PickupFormFields.tsx`, `usePickupForm.ts`, `pickupFormSchema.ts` — create
- `components/shell/NavDrawer.tsx` (`NAV_ITEMS`, entry after Orders) — modify
- `components/dashboard/QuickAddFab.tsx` (4th option → `/pickups?new=1`) — modify
- Tests: `components/pickups/__tests__/PickupTable.test.tsx`, `PickupLayout.test.tsx`, `PickupForm.test.tsx` — create; `components/shell/__tests__/NavDrawer.test.tsx` (`EXPECTED_NAV_ORDER` and the "Calendar between Orders and Leads" case), `components/dashboard/__tests__/QuickAddFab.test.tsx` (count / order / href assertions) — modify

**Acceptance criteria:**
- [x] Columns `Customer | 275 | 330 | Status | Date`; an em dash for a zero count and for a null date
- [x] Status tabs All / Scheduled / Completed / Cancelled with their **own** framer `layoutId`, not the orders tabs' or `order-history-underline`
- [x] Search debounced 250ms, applied server-side via URL params, matching customer name only
- [x] `?new=1` opens the create form through `parseInitialMode`; `?customerId=` pre-selects and locks the customer
- [x] No delete anywhere — cancel is the only removal
- [x] SEC-02: status and uuid params validated at the page boundary
- [x] Touch targets at least 44px; the page never scrolls (CONSTRAINT-19 / 23 — `min-h-svh`, never `vh`)

**Tests required:**
- `PickupTable` → `test: renders rows and builds the expected filter href` / `test: the empty state distinguishes no-results from no-pickups`
- `PickupForm` → `test: submitting creates a pickup` / `test: a server error renders in the alert region`
- `NavDrawer` → `test: Pickups sits between Orders and Calendar`

**Status:** [x] Done 2026-08-10 — page + ten `components/pickups/*` files + NavDrawer entry (lucide `Truck`, between Orders and Calendar) + QuickAddFab 4th option; 1025 tests / 92 files (was 990 / 88), `tsc` clean. Two additions outside the Files list: `PickupDetailParts.tsx`, splitting `PickupDetail.tsx` (240 lines, a CQ-02 breach) into 97 / 184 on the established `OrderDetail` + `OrderDetailParts` idiom; and `app/(app)/pickups/__tests__/page.test.tsx`, the first page-boundary test for a list route (worth backfilling onto orders/customers/leads). That page boundary now validates `status` against an `all|scheduled|completed|cancelled` whitelist and uuids via the canonical `isUuid`, mirroring `app/(app)/orders/page.tsx` — **closes @security finding T77-L02 (Low)**, `db/queries/pickups.ts` untouched. QuickAddFab order deliberately differs from NavDrawer order (spec says "4th option"); a comment at the FAB says why. **Three criteria are asserted only as class strings and still need the builder's eyes on real iPad hardware** — 44px touch targets, the page never scrolling in landscape (CONSTRAINT-23 exists for this blind spot), and the status-tab pill animation not fighting Order History's underline when both are mounted. **Closed 2026-08-10 — the builder confirmed the feature visually on the real iPad.**

**Depends on:** Task 77

---

## Task 79: Pickup History on the customer detail panel

**Files:**
- `db/queries/pickups.ts` (add `getCustomerPickups(customerId, window)`) — modify
- `components/customers/PickupHistory.tsx` — create
- `app/(app)/customers/page.tsx` (add to the `Promise.all` in `loadCustomerDetail`, to `DetailResult` and to `EMPTY_DETAIL_RESULT`), `components/customers/CustomerLayout.tsx`, `CustomerDetail.tsx` (render below `OrderHistory`) — modify
- `components/customers/__tests__/PickupHistory.test.tsx` — create; `CustomerDetail.test.tsx` — modify

**Acceptance criteria:**
- [x] The section sits below Order History with the same card chrome and window tabs
- [x] It uses its **own** `?pwindow=` param and its own `layoutId`, so it neither drives nor fights Order History's tabs
- [x] Volume Overview is untouched — it stays purchase volume only
- [x] Rows link to `/pickups?id=…`
- [x] The section header carries a muted `· N unscheduled` count when the customer has undated scheduled pickups — informative, never an alert (builder decision 2026-08-10, option 3a)

**Tests required:**
- `PickupHistory` → `test: renders rows for the selected window` / `test: empty state when the customer has none`

**Status:** [x] Done 2026-08-10 — `components/customers/PickupHistory.tsx` (191 lines) below Order History, fed by a new `getCustomerPickups` in `db/queries/pickups.ts` (233 lines, under the 300 service cap); 1046 tests / 94 files (was 1025 / 92), `tsc` clean. Isolation from Order History is by construction: `WINDOW_PARAM = 'pwindow'` and `UNDERLINE_LAYOUT_ID = 'pickup-history-underline'`, both verified unique against every `layoutId` and param in the codebase. Reused rather than duplicated — `computeWindowStartDate` and `CustomerOrdersWindow` are imported from `db/queries/customers.ts` (aliased `CustomerPickupsWindow`) so the two panels cannot drift on what "3M" means, and the panel reuses `PickupStatusBadge` + `formatPoTotal` rather than a second colour map; no import cycle. Columns are `Date | 275 | 330 | Status` — a pickup has no PO number and no price. `pwindow` is whitelisted at the page boundary through the same `parseWindow` as `window` (the mandated T77-L02 / T78-L01 pattern), now typed `string | string[] | undefined` and matching by whitelist membership only — no `.trim()` or other string-only method is ever called, so a repeated `?pwindow=a&pwindow=b` array falls through to the default instead of throwing; covered by a new `app/(app)/customers/__tests__/page.test.tsx` alongside hostile values and a malformed `?id=`. **One decision awaits the builder:** the window filter excludes undated pickups (`AND p.pickup_date >= $startDate` mirrors `customerOrdersQuery` deliberately, and is commented), so a customer whose only pickups are unscheduled sees "No pickups in this window" — an undated pickup is a more common real state than an undated order, and pinning unscheduled rows to the top instead is a one-line spec change. **Still needs real-iPad verification** (jsdom has no layout engine): the two underlines not fighting when both panels are mounted — jsdom only proves the `layoutId` strings differ (the same open item Task 78 flagged for the status-tab pill); 44px touch targets on the new tab row, asserted only as a class string; CONSTRAINT-19/23 — the detail panel is a whole card taller and scrolls internally via `overflow-y-auto`, but the page must still not scroll; and whether the four-column table's `overflow-x-auto` wrapper ever triggers at iPad width. **Follow-up 2026-08-10 — that decision is now made:** the builder chose **option 3a**, so `getCustomerUnscheduledPickupCount` was added to `db/queries/pickups.ts` and the section header now reads `Pickup History · N unscheduled` in muted secondary text (no badge, pill or accent — informative, never an alert), while the **row list is deliberately unchanged** — unscheduled rows are *not* pinned to the top and the `pickup_date >= $startDate` window filter stands. "Unscheduled" is defined as `pickup_date IS NULL AND status = 'scheduled'`; the count is the customer's total, not window-dependent, and rides the existing `Promise.all` in `loadCustomerDetail`. `PickupHistory.tsx` would have hit 205 lines, so `PickupRowItem` / `PickupsTable` split out into a new `components/customers/PickupHistoryParts.tsx` (150 / 75) to hold the CQ-02 200-line cap. Suite 1055 tests / 94 files (was 1046 / 94), `tsc` clean. **The real-iPad items above are closed 2026-08-10 — the builder confirmed the feature visually on the real iPad.** See `docs/session-log.md`.

**Depends on:** Task 78

---

## Task 80: Pickups on the calendar — rendering, toggles, popup

Read and status-write only. Dates are still set from the Pickups tab, so the app is coherent at the end of this task; dragging arrives in Task 81.

**Files:**
- `db/queries/pickups.calendar.ts` — create: `getCalendarPickups(range)` and `getUnscheduledPickups()` over a shared projection including the `contacts` `json_agg` subquery, filtering `status <> 'cancelled'`, ordered by `pickup_date` then `sort_index ASC NULLS LAST`
- `components/calendar/PickupCard.tsx`, `PickupCardDialog.tsx`, `pickupVisibility.tsx` (context module with an inert default, following the `cardSelection.tsx` idiom) — create
- `app/(app)/calendar/page.tsx`, `CalendarLayout.tsx`, `calendarLayoutHooks.ts`, `WeekStrip.tsx`, `DayColumn.tsx`, `DayColumnParts.tsx`, `UnscheduledCallout.tsx` — modify
- `app/globals.css` — modify only if the two-list height split needs new metrics
- Tests: `components/calendar/__tests__/PickupCard.test.tsx`, `PickupCardDialog.test.tsx`, `pickupVisibility.test.tsx` — create; `CalendarLayout.test.tsx` — modify

**Acceptance criteria:**
- [x] Two independent toggles in the calendar header; **Orders on, Pickups off** by default; the state resets on every visit — nothing is persisted (CONSTRAINT-25)
- [x] Pickups render as a second list below the orders list in each day column, each list independently ordered
- [x] Both toggles off shows an empty-state message, not a blank grid
- [x] The pickup card is amber-surfaced with plain dark text (`12 × 275, 4 × 330`), **not** the green/blue combo language, and keeps `height: var(--card-h)` so the four-card math holds
- [x] Completed pickups are greyed and locked (`BUILT_SURFACE_CLASS`); cancelled ones are hidden
- [x] The popup offers the Contact menu (reusing `ContactMenu` unchanged) plus Mark Complete, Cancel, and Remove from calendar (which clears `pickup_date`)
- [x] The page still never scrolls; each list scrolls inside its column (CONSTRAINT-19)
- [x] **iPad-verified** — two lists at real card height on the device, not in jsdom — verified by the builder on the real iPad, 2026-08-10

**Tests required:**
- `PickupCard` → `test: renders the 275/330 counts and holds var(--card-h)` / `test: a completed pickup renders the built surface`
- `pickupVisibility` → `test: defaults to orders-on and pickups-off`
- `CalendarLayout` → `test: toggling pickups on renders pickup cards in the right column`

**Status:** [x] Done 2026-08-10 — `db/queries/pickups.calendar.ts` plus seven new `components/calendar/*` files and four new test files; 1110 tests / 98 files (was 1055 / 94), `tsc` clean, all prior calendar, dnd and arm-mode tests green with the four-card height math, `--card-h` and the `overflow-hidden` root untouched. Read and status-write only, as specified — dates are still set from the Pickups tab until Task 81. **Three split files beyond the Files list, forced by CQ-01/CQ-02** and following the same `*Parts` idiom as Tasks 78/79: `CalendarHeader.tsx` (header + toggles), `CalendarBoard.tsx` (`CalendarLayout` had reached 98 lines against CONSTRAINT-14's 80-line allowance) and `ColumnPickupList.tsx` (`DayColumnParts` had reached 209 lines). **`UnscheduledCallout.tsx` was left unchanged and a sibling `UnscheduledPickupsCallout` added instead** — folding both pills into one component would breach CQ-02 and entangle the orders drop target with a group that has no drop handling until Task 81; the new pill renders only while the Pickups toggle is on. **"Remove from calendar" reuses the existing audited `updatePickup` with `pickup_date: null`** rather than inventing a mutation path; the cost is documented at the call site — it resends the whole editable row (last-write-wins against a concurrent Pickups-tab edit) and does not clear `sort_index` — and **Task 81's `clearPickupPlacement` supersedes it**. The popup reuses `PickupStatusBlock` unchanged, so it also offers Reopen on a completed pickup (one audited transition map, mirroring the order popup's reuse of `OrderStatusActions`). Security: `parseCalendarWeek` now takes `string | string[]` and shape-checks with `typeof value === 'string'` before any string method, closing the T78-L01 array class for this page (array-param test added); nothing raw from `searchParams` reaches the new query module — only derived `yyyy-MM-dd` bounds, bound as Drizzle params. **The iPad-verified criterion is now closed — the builder completed the visual verification on the real iPad, 2026-08-10.** See `docs/session-log.md`.

**Depends on:** Task 77 (Task 78 is not required, though it ships first in practice)

---

## Task 81: Pickup drag, drop and arm mode

The highest-risk task in the feature. Every drag and tap payload gains a `group` discriminator, and nothing may cross groups.

**Files:**
- `components/calendar/calendarDnd.ts` — add `group: 'order' | 'pickup'` to `CardDragData` and `ColumnDropData`, validate it in `readDropData`, reject cross-group drops in `resolveDropTarget`, pre-filter collision detection by group, and handle the group in `resolveUnscheduleTarget`
- `CalendarDndContext.tsx` (a tagged-union `activeRow` so the overlay renders the right card), `SortableProductionCard.tsx` plus a `SortablePickupCard.tsx`, `DayColumn.tsx` (a second `useDroppable`, id `pickups:${dateKey}`), `DayColumnParts.tsx` (a second `SortableContext`, id `${group}:${dateKey}`) — modify
- `armPlacement.ts` (`ArmedCard`, all three `TapTarget` shapes, `insertionIndex`, and `resolveColumnTap`'s `cardCount - 1`), `armMode.tsx` (dispatch by group), `useProductionPlacement.ts` or a parallel `usePickupPlacement.ts` — modify
- `lib/actions/pickups.calendar.ts` — create: `setPickupPlacement`, `clearPickupPlacement`
- `AddOrderMenu.tsx` (becomes Add Purchase Order / Add Pickup plus the undated-pickup list), `NewOrderDrawer.tsx` or a sibling pickup drawer, `UnscheduledCallout.tsx` — modify
- Tests: `CalendarDnd.test.tsx`, `armPlacement.test.ts`, `armMode.test.tsx`, `UnscheduledCallout.test.tsx`, `CalendarLayout.test.tsx` — modify; `lib/actions/__tests__/pickups.calendar.test.ts` — create

**Acceptance criteria:**
- [x] An order card cannot be dropped into the pickup list or the reverse — and the drag **preview** never opens a slot the drop will refuse
- [x] Reordering within a group writes that group's `sort_index` only
- [x] Dragging a pickup onto a day writes `pickup_date`; dragging it to the unscheduled callout clears it
- [x] Long-press arm mode obeys the same group rule, including the same-column `index - 1` correction
- [x] Each day's "+" offers Add Purchase Order and Add Pickup, and lists undated rows of both kinds, labelled
- [x] Placement writes revalidate `/calendar` and `/pickups`
- [x] **iPad-verified** — long-press arm, cross-week place and unschedule, all for pickups, on the device — verified by the builder on the real iPad, 2026-08-10

**Tests required:**
- `resolveDropTarget` → `test: rejects a cross-group drop` / `test: a same-group same-position drop is a no-op`
- `resolveTapAction` → `test: an armed pickup ignores an order column tap`
- `setPickupPlacement` → `test: writes the date and sort index` / `test: rejects an unknown pickup id`

**Status:** [x] Done 2026-08-10 — every drag and tap payload now carries a `group` discriminator; 1184 tests / 99 files (was 1110 / 98), `tsc` clean. **Substantial work was already on disk from an interrupted earlier pass** — the core modules (`calendarDnd.ts`, `armPlacement.ts`, `calendarCollision.ts`, `SortablePickupCard`, `usePickupPlacement`, the action module) had been rewritten with `group` but every consumer and all five test files were unmigrated, leaving 39 `tsc` errors; that work was finished rather than restarted. **The group invariant is enforced at four layers:** collision — `groupedCollisionDetection` filters `droppableContainers` by group *before* `closestCenter` runs, so the other group's list never becomes `over` and the preview never opens a slot the drop would refuse (a UX guarantee, not the security control); drop — `resolveDropTarget` / `resolveUnscheduleTarget` refuse a group mismatch as a last line, and `readDropData` validates `group` rather than trusting it; arm tap — `resolveTapAction` checks `target.group !== armed.group` first and returns `cancel`, and `armed.group` participates in the `isArmed` comparison so cards cannot cross-light; server — `z.literal('pickup')` rejects a crossed payload before any query, auth call or DB touch, with the `pickups`-table status lookup as an independent second guard (both tested, including the crossed-payload case). **INFO-05 is closed:** Task 80's "Remove from calendar" is repointed at `clearPickupPlacement`, which nulls both `pickup_date` and `sort_index`; `@/lib/actions/pickups` is no longer imported by any calendar component and `updatePickup` retains exactly one caller repo-wide (the Pickups tab form), with the old test now asserting it is *not* called. **Two CQ-driven splits on the established `*Parts` idiom:** `CalendarDragOverlay.tsx` (`CalendarDndContext` had reached 201 lines against the 200 cap) and `CalendarOverlays.tsx` (`CalendarLayout`'s body had reached 95 against CONSTRAINT-14's 80). Also: `pickupsByDay` bucketing moved up to `CalendarLayout` so a `+ Add` pickup sizes against the pickups list only; the new-pickup drawer pre-fills the **visible** date field (unlike the order drawer's hidden override) because a pickup's date *is* its placement; `+ Add order` relabelled `+ Add`; `z.literal(..., { errorMap })` is invalid in zod 4, so `{ message }` was used. Known gap, mirroring orders: with zero undated pickups the callout renders nothing and so is not a drop target then — the orders callout has always behaved the same, and the popup's Remove always works. **`@security` verdict: CLEAR**, with three new Low findings, none blocking — T81-L01 (`UUID_RE.test(id)` coerces, so a one-element array id passes the gate at `lib/actions/pickups.calendar.ts:98,157`; fails closed at the driver; repo-wide pattern), T81-L02 (CONSTRAINT-24 baseline stale — 10/28/26 recorded, 11/30/28 actual), T81-L03 (`setProductionPlacement` has no `group` literal, making the *order* action the weaker side — one guard where pickups has two; one line to fix). No crafted payload can renumber another group's or another day's `sort_index` (no bulk update exists; all four write sites are a single `.set()` with `.where(eq(<table>.id, id))`), and mass assignment is impossible (9 injected keys stripped by zod, no `parsed.data` spread); residual stale-index via the Pickups tab form recorded as INFO-07, inert. **The iPad-verified criterion is now met and checked — the builder completed the visual verification on the real iPad, 2026-08-10.** See `docs/session-log.md`.

**Depends on:** Task 80

---

## Task 82: Pin dependency versions and add crash error boundaries

**Infra task — no `docs/prd.md` entry by design.** This changes no product surface and adds no feature; it closes security finding REPO-03 and adds a resilience net. Two unrelated-looking edits are bundled because both are small, both are mechanical, and both are prerequisites for `@launch-prep`.

Two problems, one task. **REPO-03:** fifteen packages are pinned to the literal string `"latest"`, so any reinstall can silently pull software that was never tested here — and `@supabase/ssr`, `postgres` and `drizzle-orm` hold database credentials at runtime while `zod` carries the mass-assignment defence for every server action. **No error boundary:** `app/` contains no `error.tsx`, `global-error.tsx` or `not-found.tsx` anywhere, so any unhandled throw in an authenticated page replaces the entire segment with a blank page and no route back — the operator's only recovery is knowing to retype the URL.

**Files:**
- `package.json` — modify: replace every `"latest"` with a caret range at the version already resolved in `package-lock.json`
- `app/(app)/error.tsx` — create (`'use client'`): segment boundary for every authenticated route, rendered inside `AppShell`
- `app/global-error.tsx` — create (`'use client'`): last-resort boundary for a throw in the root layout; renders its own `<html>`/`<body>`, imports no app chrome
- `app/(app)/__tests__/error.test.tsx` — create

**Versions to pin** (source of truth: top-level `node_modules/<pkg>` entries in `package-lock.json`, verified 2026-08-11):

`dependencies` — `@hookform/resolvers` ^5.2.2, `@supabase/ssr` ^0.10.2, `@supabase/supabase-js` ^2.104.0, `date-fns` ^4.1.0, `drizzle-orm` ^0.45.2, `framer-motion` ^12.38.0, `postgres` ^3.4.9, `react-hook-form` ^7.73.1, `recharts` ^3.8.1, `zod` ^4.3.6

`devDependencies` — `@types/node` ^25.6.0, `autoprefixer` ^10.5.0, `drizzle-kit` ^0.31.10, `postcss` ^8.5.10, `typescript` ^6.0.3

REPO-03 named the ten production dependencies only; the five devDependencies carry the identical defect and are included on builder approval (2026-08-11).

**Functions to implement:**
- `AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): JSX.Element` — default export of `app/(app)/error.tsx`
- `GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }): JSX.Element` — default export of `app/global-error.tsx`

**Acceptance criteria:**
- [x] No occurrence of the literal `"latest"` remains anywhere in `package.json` — verified, `grep -c '"latest"' package.json` = 0
- [x] `npm install` after the edit leaves the **installed tree** untouched. *Criterion corrected during implementation:* the original wording demanded a byte-identical `package-lock.json`, which is unachievable by construction — the lockfile mirrors the root manifest's declared ranges in `packages[""]`, so editing `package.json` necessarily rewrites those 15 lines. The real proof is that **zero `version`, `resolved` or `integrity` lines changed** (verified: 0), and npm reported `up to date`. That is what was checked
- [x] `npm run build` succeeds and `npx tsc --noEmit` is clean — both verified
- [x] Full suite green — **1222 tests / 102 files**, up from the 1218 / 101 baseline by exactly the four new tests in one new file
- [x] A thrown error in any `app/(app)/*` page renders the error screen *inside* `AppShell` — sidebar and navigation remain usable, so the operator can always leave the broken route
- [x] The screen renders a plain-English message ("Something went wrong."), a **Try again** button wired to `reset()`, and a **Back to dashboard** link to `/dashboard`
- [x] [EH-01] `error` and `error.digest` are written to `console.error` in an effect — the boundary must never swallow the cause silently
- [x] [SEC-04] The raw `error.message`, stack and `digest` are never rendered into the DOM; they go to the console only — asserted directly against a deliberately leaky message (`connect ECONNREFUSED db.internal:5432 for customer 4821`)
- [x] Styling uses existing tokens only (`text-muted-foreground`, `bg-card`, `text-destructive`, `--radius`) and `components/ui/button` — no new colours, no new primitives. *(The plan cited CONSTRAINT-20 for this; that constraint is the shared-Supabase-project decision. The binding rule here is the Industrial Slate token palette in `app/globals.css`, which is what was followed.)*
- [x] `app/global-error.tsx` imports neither `AppShell` nor `ToastProvider` — a root-layout crash means that chrome is exactly what is broken
- [x] Both files are under the 200-line component cap (CQ-02) and the 80-line JSX-component cap (CONSTRAINT-14) — 58 and 56 lines

**Tests required:**
- `AppError` → `test: renders the fallback message and a Try again button`
- `AppError` → `test: clicking Try again invokes reset`
- `AppError` → `test: does not render the raw error message or digest in the DOM`
- `AppError` → `test: logs the error and digest to console.error`

**Status:** [x] Done 2026-08-11 — REPO-03 closed and the app has crash boundaries for the first time. **Pins:** all 15 `"latest"` entries replaced with caret ranges at the already-resolved versions; the ten production deps were the finding, the five devDependencies (`@types/node`, `autoprefixer`, `drizzle-kit`, `postcss`, `typescript`) were added on builder approval as the same defect. `npm install` reported `up to date` and changed no `version`/`resolved`/`integrity` line — the tree that was tested is the tree that is pinned. **Boundaries:** `app/(app)/error.tsx` sits inside the authenticated layout so `AppShell` survives the crash and the operator is never stranded; `app/global-error.tsx` renders its own `<html>`/`<body>`, imports `./globals.css` (root-layout styles do not reach it) and offers a hard reload rather than `reset()`, because re-rendering the layout that just threw lands on the same error. **Neither screen renders the error text** — a thrown postgres error can carry a connection string or a customer row, and this was the one surface that would have put internals on a page; the test asserts a deliberately leaky message never reaches the DOM. **Two deviations from the spec, both recorded above as criterion corrections:** the "byte-identical lockfile" criterion was unachievable by construction and was replaced with the check that actually proves the point; and the styling criterion cited CONSTRAINT-20, which is the shared-Supabase decision, not a design rule. **One implementation deviation:** the test was first written against `@testing-library/user-event`, which is not installed — rewritten to `fireEvent`, the established repo precedent, rather than adding a dependency for one click. No icon was used: `lucide-react@1.x` renamed the triangle-alert glyph and no existing file imports it, so the text-only treatment of the four existing empty states was matched instead. 1222 tests / 102 files (was 1218 / 101), `tsc` clean, `npm run build` clean.

**Depends on:** None

---

## Task 83: Upgrade to React 19 and Next.js 15

**Infra task — no `docs/prd.md` entry by design.** Closes the first half of security finding REPO-02. Split from Task 84 deliberately: React 19 is a different risk axis from Next 16's tooling changes, and bundling them would produce a change no one can review and no one can bisect. Each task must be revertable as a single commit.

The Next-specific surface here is small — an impact scan on 2026-08-11 found this repo uses almost none of what Next 15 broke. **React 19 is the actual upgrade**, and it lands on `@dnd-kit`, `framer-motion` and `@base-ui/react` — the calendar drag/drop built across Tasks 76-81.

**Scan results establishing scope (verified 2026-08-11, not assumed):** zero bare `fetch()` calls (all data access is Drizzle/`postgres`/Supabase SDK), zero `app/**/route.ts` handlers, zero `next/image` imports, zero `next/link legacyBehavior`, zero `useFormState`, zero `experimental_*` imports, zero `JSX.Element` annotations, and a five-line `next.config.js` with no custom webpack. Six of Next 15's eleven breaking changes therefore have zero exposure.

**Files:**
- `package.json` — modify: `next` → latest 15.x, `react` + `react-dom` → latest 19.x, `@types/react` → ^19, `@types/react-dom` → ^19, `eslint-config-next` → matching 15.x. Record the exact resolved versions in the Status line
- `lib/supabase/server.ts` — modify: `cookies()` becomes async (line 13 call site, line 10 `ReturnType<typeof cookies>` annotation)
- `app/(app)/calendar/page.tsx`, `customers/page.tsx`, `dashboard/page.tsx`, `invoices/page.tsx`, `leads/page.tsx`, `orders/page.tsx`, `pickups/page.tsx`, `support/page.tsx` — modify: `searchParams` prop type becomes `Promise<...>` and must be awaited. All eight are currently plain objects
- `app/(auth)/login/page.tsx` — verify only; takes no params
- Any test file that mocks `next/headers` or renders a page with `searchParams` — modify as the suite reveals

**Approach:**
1. Run `npx @next/codemod@canary next-async-request-api .` first, then hand-clean. The codemod leaves `@next/codemod` marker comments and `UnsafeUnwrapped` typecasts wherever it cannot infer — none may remain at completion
2. Upgrade dependencies, reinstall, then work `tsc` to zero before running the suite

**Acceptance criteria:**
- [x] `next`, `react`, `react-dom` and their `@types` are on 15.x / 19.x with exact caret pins — `next@^15.5.23`, `react`/`react-dom@^19.2.8`, `@types/react@^19.2.18`, `@types/react-dom@^19.2.4`, `eslint-config-next@^15.5.23`. `grep -c '"latest"' package.json` = 0, so the Task 82 guard holds
- [x] `npx tsc --noEmit` clean — 14 errors at the start of the migration, 0 at the end
- [x] No `UnsafeUnwrapped` typecast and no `@next/codemod` marker comment remains — count 0. The codemod was **not run**; all nine call sites were migrated by hand, which is why there is no marker residue to clean
- [x] `cookies()` is awaited at `lib/supabase/server.ts`; the annotation is now `Awaited<ReturnType<typeof cookies>>`
- [x] All eight `searchParams` pages await the promise. The signature changed from `({ searchParams }: Props)` to `(props: Props)` plus `const searchParams = await props.searchParams`, which keeps every body reference identical and holds the diff to two lines per page
- [x] `npm run build` succeeds — all 11 routes, no warnings
- [x] Full suite green at **1222 tests / 102 files**, exactly the Task 82 baseline. Nothing dropped, nothing skipped
- [x] Calendar drag/drop, arm mode and both card groups exercised in `npm run dev` on desktop — **verified by the builder, 2026-08-11**. Agent-side verification had reached only as far as an unauthenticated session allows: `/calendar`, `/dashboard` and `/orders?search=…&status=…` each returning `307 → /login` with zero dev-log errors, which exercises `middleware.ts`, async `cookies()` and `await createClient()` end to end. The drag/drop pass past the login was the builder's.
- [x] React 19 ref changes checked. **There are zero `forwardRef` call sites in the entire repo** — the largest React 19 migration hazard is structurally absent. All `@dnd-kit` ref usage is the callback form `ref={setNodeRef}` at four sites (`SortablePickupCard.tsx:96`, `SortableProductionCard.tsx:105`, `UnscheduledCallout.tsx:144`, `UnscheduledPickupsCallout.tsx:128`); React 19's new "a callback ref's return value is a cleanup function" rule does not bite because `setNodeRef` returns void. Of 22 `useRef<T>(null)` sites, the 7 that cross a function or prop boundary needed their annotation widened to `RefObject<T | null>` — `useDismissOnOutsideOrEsc.ts:53`, `productionCardDialogHooks.ts:41` and `:171`, and the `cancelRef` prop on `DeleteCustomerDialog`, `ConvertLeadDialog`, `CancelOrderDialog`, `RevertOrderDialog`. This is a truth-in-typing change, not a behaviour change: those refs were always null on first render
- [x] [EH-01] No error swallowed. Two tests failed under React 19 and both were diagnosed rather than silenced — see the Status line
- [x] The commit contains no unrelated refactors

**Explicitly NOT gated on iPad verification** — builder decision, 2026-08-11. Task 81 gated on it; this one does not. The residual risk is accepted and stated plainly: React 19's ref handling is the most likely thing to break *touch* drag specifically, and a desktop pass will not surface it. If calendar touch behaviour regresses, this task is where it came from.

**Tests required:**
- No new tests. The existing 1222 are the regression harness — this task's proof is that they still pass unchanged
- Any test modified to accommodate an async API must be modified for that reason alone; a test whose *assertion* changed is a behaviour change and must be called out in the Status line

**Status:** [x] Done 2026-08-11 — all 12 acceptance criteria met. The desktop calendar drag/drop pass was run by the builder after the upgrade landed; everything else was verified in-session.

`next@15.5.23`, `react`/`react-dom@19.2.8`. `tsc` clean, `npm run build` clean (11 routes), **1222 tests / 102 files** — the exact Task 82 baseline, nothing dropped.

**The migration was far smaller than the version numbers suggest: 14 type errors total.** The scan in the task body was right — six of Next 15's eleven breaking changes have zero exposure here, so the Next-specific work was nine call sites: `cookies()` at `lib/supabase/server.ts` and `searchParams` on eight pages. `createClient()` became async, which cascaded to 11 `await createClient()` call sites across six files, all already inside async functions. The codemod was deliberately not run — nine hand edits leave no `UnsafeUnwrapped` residue to clean up afterwards.

**React 19 cost 11 of the 14 errors, and every one was a type widening, not a behaviour change.** `useRef<T>(null)` now yields `RefObject<T | null>`, which is what it always was at runtime; seven annotations that crossed a boundary were widened to match. Zero `forwardRef` in the repo meant the headline React 19 hazard never applied.

**Two tests failed and neither was a product bug — both are recorded because the distinction matters.** `lib/supabase/__tests__/server.test.ts` asserted a *synchronous* throw from `createClient`; the failure it guards is unchanged, but it now arrives as a rejection, so both assertions became `await expect(...).resolves/.rejects`. `components/leads/__tests__/LeadNotesSection.test.tsx` asserted `toHaveValue('')` inline after `onSaved` fired; the component calls `setContent('')` and `onSaved()` back to back after its await, and React 19 records the mock before flushing the re-render where React 18 had already flushed. Wrapped in `waitFor` — **the assertion itself is unchanged in both cases.** No assertion was weakened to make the upgrade pass.

**Runtime verification reached as far as an unauthenticated session goes:** `/calendar`, `/dashboard` and `/orders?search=%20tote%20&status=scheduled` all return `307 → /login` with zero dev-log errors, exercising `middleware.ts`, async `cookies()` and `await createClient()` on the real server. The eight `searchParams` awaits are covered by `tsc` and the existing page tests but were not reachable over HTTP, because the layout redirects before a page renders.

**Accepted risk, restated:** this task is not gated on iPad verification (builder decision). React 19's ref semantics are the most plausible cause of a *touch* drag regression, and neither the suite nor a desktop pass would surface it.

**Depends on:** Task 82

---

## Task 84: Upgrade to Next.js 16 and ESLint 9 flat config

**Infra task — no `docs/prd.md` entry by design.** Closes the second half of REPO-02. Mostly tooling; the application-code surface is near zero once Task 83 has landed.

**Pre-flight gate — blocking:** Next 16 requires **Node.js ≥ 20.9.0** and TypeScript ≥ 5.1. TypeScript is already 6.0.3. Node must be verified with `node --version` *before* this task starts; if it is below 20.9, upgrading Node is a prerequisite and not part of this task.

**Files:**
- `package.json` — modify: `next` → 16.x, `eslint` → ^9, `eslint-config-next` → 16.x; replace the `lint` script (`next lint` is removed in 16) with the ESLint CLI
- `eslint.config.mjs` — create: flat config. Subpaths are `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`
- `.eslintrc.json` — delete if present
- `next.config.js` — modify: review `images` defaults that changed in 16 (`minimumCacheTTL` 60s → 14400s, `qualities` → `[75]`, `imageSizes` drops 16, `maximumRedirects` → 3). This repo imports `next/image` nowhere, so the expected outcome is "reviewed, no change needed" — record that explicitly rather than silently skipping it
- `middleware.ts` → `proxy.ts` — rename via codemod. Deprecated in 16, not removed; doing it now avoids a forced migration later. Note `proxy` is Node-runtime only, no edge

**Approach:** run `npx @next/codemod@canary upgrade latest`, which officially handles only the turbopack config move, `next lint` → ESLint CLI, `middleware` → `proxy`, `unstable_` prefix removal and `experimental_ppr` removal. Everything else is manual.

**Acceptance criteria:**
- [x] `node --version` ≥ 20.9.0 — **v24.16.0**, npm 11.13.0. TypeScript 6.0.3 clears the ≥ 5.1 floor
- [x] `next` on 16.x, `eslint` on ^9, `eslint-config-next` on 16.x, all caret-pinned — `next@^16.3.0`, `eslint@^9.39.5`, `eslint-config-next@^16.3.0`, resolving to 16.3.0 / 9.39.5 / 16.3.0. ESLint stayed on 9 by spec even though 10.8.1 is published; `eslint-config-next@16.3.0` declares `eslint: ">=9.0.0"`, so 9.39.5 is inside the supported range and 10 is a separate decision
- [x] `npm run build` succeeds **on Turbopack** — exit 0, `▲ Next.js 16.3.0 (Turbopack)`, 11 routes, no `--webpack` flag and no custom webpack config introduced
- [x] `npm run lint` runs through the ESLint CLI against `eslint.config.mjs` and completes — **117 problems across 32 files: 34 errors, 83 warnings.** By rule: `@typescript-eslint/no-unused-vars` 80 (warn), `@typescript-eslint/no-explicit-any` 16 (error), `react-hooks/set-state-in-effect` 8 (error), `react-hooks/refs` 7 (error), `react/display-name` 3 (error), `react-hooks/incompatible-library` 2 (warn), unused `eslint-disable` directive 1 (warn). Not fixed — out of scope by explicit constraint, raised as a follow-up
- [x] `npx tsc --noEmit` clean — exit 0, run twice: once after install and again after Next 16 rewrote `tsconfig.json`
- [x] Full suite green at ≥ 1222 tests / 102 files — **1222 tests / 102 files**, identical to the pre-upgrade baseline captured at the start of this task. Nothing dropped, nothing skipped, no test modified
- [x] `middleware.ts` renamed to `proxy.ts` (via `git mv`, so history follows) and the exported `middleware` function renamed to `proxy`; the `config.matcher` is unchanged. Build output lists `ƒ Proxy (Middleware)`, confirming Next resolves the new file. Auth verified over HTTP against `npm run dev`: `GET /dashboard` with no cookies returns **307 → `http://localhost:3000/login`**. The redirect itself lives in `app/(app)/layout.tsx:15`, not in the proxy — `proxy.ts` only refreshes the session — so this request exercises both halves
- [x] No `@slot` directories — re-confirmed at implementation time by scanning `app/` for `@*` directories; zero found, so no `default.js` is required
- [x] `next.config.js` image defaults reviewed — **no change needed, and recorded in the file itself as a comment rather than only here.** Confirmed at implementation time that the repo imports `next/image` nowhere (the only `_next/image` hit is the proxy matcher string, and `next-env.d.ts` carries a type reference). None of the four changed defaults is reachable
- [x] `npm audit --omit=dev` re-run — **1 high, down from the number REPO-02 was raised on.** It is `ws@8.20.0` (GHSA-58qx-3vcg-4xpx uninitialized memory disclosure, GHSA-96hv-2xvq-fx4p memory-exhaustion DoS), reached only via `@supabase/supabase-js@2.104.0 → @supabase/realtime-js@2.104.0`. Not a Next-chain vulnerability, so **Task 84 cannot close it** — it needs a `@supabase/supabase-js` bump and is a follow-up

**Tests required:** none new; the suite is the regression harness, as in Task 83.

**Status:** [x] Done 2026-08-12 — all 10 acceptance criteria met. Node **v24.16.0**. `next@16.3.0`, `eslint@9.39.5`, `eslint-config-next@16.3.0`. `tsc` clean, `npm run build` clean on Turbopack (11 routes), **1222 tests / 102 files** — the exact Task 83 baseline.

**The codemod was deliberately not run, same call as Task 83.** `npx @next/codemod@canary upgrade latest` is interactive and its five official transforms have almost no surface here: a repo-wide grep found zero `unstable_` imports, zero `experimental_ppr`, and no turbopack config to move. That left the `next lint` → ESLint CLI swap and the `middleware` → `proxy` rename, both one-liners. Two deterministic hand edits beat an interactive tool whose output would need auditing anyway.

**Next 16 rewrote two generated files on its own during the build, and both changes were kept.** `tsconfig.json` had `jsx` forced from `preserve` to `react-jsx` (mandatory — Next uses the automatic runtime) and `.next/dev/types/**/*.ts` added to `include`; it also reformatted the file's arrays, which is cosmetic and would be reapplied on any future build, so it was not reverted. `next-env.d.ts` moved from a `/// <reference path>` to `import` form and picked up `root-params.d.ts`. `tsc` and the full suite were re-run after both, and both were clean.

**Unrequested side effect found and shut off: Next 16 writes `AGENTS.md` and `CLAUDE.md` into the repo root on every `dev` and `build`.** The generated `CLAUDE.md` contains only `@AGENTS.md`. `CLAUDE.md` is already gitignored, but `AGENTS.md` is not, so the default behaviour would have dropped an untracked file into the repo root on every build and quietly taken over this project's agent context, which the SBDev framework owns. Disabled with `agentRules: false` in `next.config.js`, both generated files deleted, and a clean rebuild confirmed they do not come back.

**`.eslintrc.json` did not exist** — this project has never had any ESLint config, which is why the 117 findings are the first automated CQ-05 signal it has ever produced. `npm run lint` therefore exits 1 today; the criterion was "runs and completes", which it does, but nothing should be wired to that exit code until the follow-up sweep lands.

**Depends on:** Task 83

---

## Task 85: Clear the first ESLint sweep (117 findings)

**Infra task — no `docs/prd.md` entry by design.** Raised by Task 84, which stood up ESLint 9 flat config and deliberately did not fix what it found.

**Why this is not cosmetic:** 80 of the 117 are unused variables and genuinely are cosmetic, but **17 are React correctness rules** — `react-hooks/set-state-in-effect` (8) and `react-hooks/refs` (7) flag render-phase ref reads and effect-driven state writes, which are exactly the patterns React 19's stricter semantics punish. Those 17 should be read as findings, not as lint noise, and each one triaged on its merits before being silenced.

**Files:** whichever of the 32 flagged files the triage keeps. No blanket `--fix` and no rule disabled repo-wide without a written reason.

**Acceptance criteria:**
- [x] Every `react-hooks/*` finding individually triaged: fixed, or kept with an inline `eslint-disable-next-line` carrying a one-line reason — **14 fixed, 3 kept.** All 7 `react-hooks/refs` were one root cause (`useAddressSelect.ts` read a mount-captured ref during render; replaced with a lazy `useState` initialiser). 7 of the 8 `set-state-in-effect` became React's documented render-phase adjustment — 5 dialog "reset on close" effects and 2 derived-state-by-effect. Kept: `calendarScroll.ts` (post-mount local "today" is deliberate; computing it in render is a hydration mismatch — the hook's own doc says so) and both `incompatible-library` notices (React Compiler bail-outs on `react-hook-form`'s `form.watch()`, locked in by the stack table in `docs/architecture.md` — **not** CONSTRAINT-01, which does not list react-hook-form; the original comments cited it wrongly and were corrected by `@code-review`)
- [x] `@typescript-eslint/no-explicit-any` (16) resolved with real types, not `unknown` casts that move the problem — all 16 were `vi.mock` doubles. Typed with the existing house pattern `Record<string, unknown> & { children?: React.ReactNode }`; 2 turned out to be `next/link` mocks and got a real prop type. No `as any`, no `@ts-expect-error`
- [x] `npm run lint` exits 0 — verified, exit 0, zero output
- [x] ~~Full suite still green at 1222 tests / 102 files~~ **Criterion corrected: the recorded baseline was already stale when this task was written.** Commit `7072363` (the `@code-review` pass after Task 84) added `__tests__/proxy.test.ts` — 6 tests, 1 file — without updating it. True HEAD baseline was **1228 / 103**. Final after Task 85 and its three `@code-review` rounds: **1254 tests / 106 files**, all passing — 1228, plus 2 `LeadForm` Cancel regression tests, plus 10 from review round one (9 in the new `DeleteCustomerDialog.test.tsx`, 2 reopen tests in `ConvertLeadDialog.test.tsx`, minus one vacuous test split), plus 8 from round two (7 in the new `components/shared/__tests__/useResetOnChange.test.tsx`, 1 splitting a partly-vacuous reopen assertion into a genuinely in-flight case). Nothing dropped, nothing skipped. **Future tasks should compare against 1254 / 106**
- [x] `npx tsc --noEmit` clean — verified, exit 0

**Tests required:** none new unless a triaged finding turns out to be a real bug — in which case that bug gets a regression test.
→ **One real bug surfaced, so 2 tests were added.** `LeadForm` declared `onClose`, both `LeadLayout` call sites passed it, and no Cancel button was ever rendered — New Lead / Edit Lead had no way to back out, while `CustomerForm`, `OrderForm` and `PickupForm` all render an identical ghost Cancel. Fixed on builder approval (restore parity, not delete the prop) with a create-mode and an edit-mode regression test, each asserting the server action is not called.

**Status:** [x] Done 2026-08-16 — 117 → 0. **73 of the 117 were never dead code:** typescript-eslint defaults `ignoreRestSiblings` to **false**, and `eslint-config-next` registers `@typescript-eslint/no-unused-vars` as a bare `'warn'`, so that default applied. The repo's `framer-motion` test mocks strip props via rest-destructuring, where the discarded names *are* the mechanism — so the default was overridden in `eslint.config.mjs` with the reasoning in the file. This narrows what the rule reports rather than disabling it. (An earlier version of this note claimed a bare `'warn'` "discards the rule's option defaults" — that is false, and `@code-review` caught it. The defaults applied; they were simply not the wanted ones.) Dead code genuinely removed: `LeadLayout.handleConverted` (orphaned — `ConvertLeadDialog` has no `onConverted` prop), `OrderFormFields.mode` (threaded down through `FormBody` and never read; removed at all three levels), 4 test-local bindings, and a stale `no-control-regex` disable whose rule is not enabled under flat config. **No blanket `--fix` was run and no rule was disabled repo-wide**; all **3** remaining inline disables (`calendarScroll.ts`, `usePickupForm.ts`, `AddressSelect.test.tsx`) carry a one-line reason at the call site.

**Follow-up `@code-review` pass (same day) found 8 violations, all fixed before this task was considered closed.** The render-phase guard had been pasted into 5 files across 4 verticals, which pushed `productionCardDialogHooks.ts` to 205 lines (over CQ-02's 200 cap, in a file whose own header says it was split to stay under) and `ConvertLeadDialog` to 81 lines (over CONSTRAINT-14's 80). Extracted to `components/shared/useResetOnChange.ts` per CONSTRAINT-26, exporting `useResetOnChange` (identity-compare) and `useResetOnClose` (the true→false case); all 7 call sites now use it and both caps are clear. Also fixed: two disable comments citing CONSTRAINT-01 for react-hook-form, which it does not list; the false eslint-config rationale above; a 4-vs-3 miscount of inline disables; missing `@param` docs on `useInvoiceSubmit.clearSignal` (now compared by reference identity, a caller contract that was undocumented) and on `LeadForm`; and `README.md`, which still told a fresh setup to use the **Direct connection** string — the exact string that took prod down on 2026-08-16.

**Depends on:** Task 84

---

## Task 86: Close the last `npm audit --omit=dev` high (ws via Supabase)

**Infra task — no `docs/prd.md` entry by design.** The remaining half of REPO-02's original number that Task 84 structurally could not reach.

**The finding:** `ws@8.20.0` — GHSA-58qx-3vcg-4xpx (uninitialized memory disclosure) and GHSA-96hv-2xvq-fx4p (memory-exhaustion DoS). Reached only through `@supabase/supabase-js@2.104.0 → @supabase/realtime-js@2.104.0`. Nothing in the Next chain pulls it.

**Worth checking before doing the work:** ToteTrack does not use Supabase Realtime anywhere. Confirm that, because if it holds, the exposure is a transitive dependency that is never actually opened as a websocket — which changes this from "patch urgently" to "patch on the next routine bump" and is worth recording either way.

**Files:** `package.json` — bump `@supabase/supabase-js` to a release whose `realtime-js` depends on `ws` ≥ 8.20.2. `npm audit fix` is the fallback only if it produces no breaking change.

**Acceptance criteria:**
- [x] Whether Supabase Realtime is used anywhere in the app determined and recorded in the Status line — **not used.** Zero hits for `realtime`, `.channel(`, `subscribe(`, `postgres_changes` or `broadcast` across `components/`, `lib/`, `app/`, `db/`. The websocket was never opened; the vulnerable code shipped and never ran
- [x] `npm audit --omit=dev` reports 0 high — **reports 0 vulnerabilities of any severity**, exit 0
- [x] Auth still works — `GET /dashboard` signed out returns **307 → `http://localhost:3000/login`** against `npm run dev`, and `/login` returns 200
- [x] Full suite green at **1254 tests / 106 files** — verified, identical to the post-Task-85 baseline. Nothing dropped
- [x] `npm run build` clean — 11 routes, Turbopack, `ƒ Proxy (Middleware)` resolving
- [x] `npx tsc --noEmit` clean and `npm run lint` exit 0 (not required by the spec; run because the bump touches a runtime dependency)

**Tests required:** none new; the suite is the regression harness.

**Status:** [x] Done 2026-08-16 — `@supabase/supabase-js` `^2.104.0` → `^2.109.0`. **The fix is stronger than the spec anticipated:** the spec expected a bump to a `realtime-js` depending on `ws ≥ 8.20.2`, but `realtime-js@2.106.0+` **drops the `ws` dependency entirely** in favour of the platform WebSocket, so the vulnerable package is gone from the tree rather than patched — `npm ls ws` now finds nothing under the production graph.

**Why 2.109.0 and not 2.112.3 (latest).** `@supabase/supabase-js@2.110.0` raises `engines.node` from `>=20.0.0` to `>=22.0.0`. There is no `vercel.json` and no `engines` field in `package.json`, so the deployed Node version is whatever the Vercel project setting says — not verifiable from the repo. 2.109.0 is the newest release that removes `ws` while leaving the Node floor untouched, so it closes the advisory with zero build-environment risk. Local Node is v24.16.0, so the floor is not a local constraint; this is purely about the unverified deploy target. **To move to 2.112.x later, first confirm the Vercel project's Node version is 22.x or higher** — then it is a one-line bump.

**Realtime confirmed unused, so the original exposure was latent.** `ws@8.20.0` carried GHSA-58qx-3vcg-4xpx (uninitialized memory disclosure) and GHSA-96hv-2xvq-fx4p (memory-exhaustion DoS), both reachable only through an open websocket. ToteTrack fetches in Server Components and mutates through Server Actions; it never opens one. Recorded here because the next person to read the advisory should know the difference between "shipped" and "reachable" for this repo.

**Note on the remaining audit noise:** `npm audit` without `--omit=dev` still reports 15 findings (2 low, 7 moderate, 6 high). All are devDependency-only — build and test tooling that never ships to a user. REPO-02 was raised on the production graph, which is now clean.

**Depends on:** Task 84

---

## [~] Task 87: Fix the `/calendar` hydration mismatch (`@dnd-kit` unstable IDs) — superseded: accessibility impact accepted (single-user app, builder decision 2026-08-12)

> **Superseded, not done.** Builder decision 2026-08-12: ToteTrack is single-user (CONSTRAINT-04), the one operator is known, and the only user-facing consequence of this bug is a wrong screen-reader description on drag handles. That impact is accepted.
>
> **What the decision does not cover, recorded so it is not lost:** the ~1,500 console lines per `/calendar` load are unaffected by the single-user argument — that cost falls on whoever debugs this screen next, not on the operator. The fix is a single stable `id` prop on `DndContext`. **Revive this task the first time console noise gets in the way of debugging `/calendar`, or the day this app gains a second user.**

**Infra/accessibility task — no `docs/prd.md` entry by design.** Raised by `@qa` 2026-08-12 (NB-1), found the first time `/calendar` was ever rendered in a logged-in browser.

**The finding:** `/calendar` throws `A tree hydrated but some attributes of the server rendered HTML didn't match the client properties. This won't be patched up.` The attribute is `aria-describedby` — server renders `DndDescribedBy-1`, client renders `DndDescribedBy-0` — repeated across ~60 draggable cards, roughly **1,500 console lines per page load**. `@dnd-kit` derives that ID from an internal counter that is not stable across the server and client renders.

**Why it matters, and why it is not urgent:** React explicitly does not patch the attribute, so each drag handle's accessible description points at the wrong element — screen-reader users get wrong or missing drag instructions. Sighted users are unaffected and drag/drop itself works. The second cost is that 1,500 lines of noise will hide a real error during future debugging. Not a Task 84 regression as far as could be determined, though React 19 made hydration mismatches louder and it may have been silent before.

**Files:**
- Wherever `DndContext` is constructed for both calendar groups — pass a stable `id`. `DndContext` accepts one precisely for SSR determinism. Prefer deriving it from React's `useId` over a hardcoded string, and give the orders and pickups contexts distinct values.

**Acceptance criteria:**
- [ ] `/calendar` loads signed in with **zero** hydration errors in the browser console, both with the Orders group active and with Pickups active
- [ ] Console on `/calendar` is clean apart from the known `favicon.ico` 404
- [ ] Drag/drop and long-press-to-arm still work — verified in `npm run dev`, and on iPad for the touch path, since this touches the same components Task 68 device-validated
- [ ] Full suite green at ≥ **1254 tests / 106 files** — baseline updated 2026-08-16 (see Task 85's corrected criterion)
- [ ] `npx tsc --noEmit` clean

**Tests required:** none new — hydration is not observable from jsdom. The proof is the browser console, so record what was observed in the Status line.

**Status:** [~] Superseded 2026-08-12 by builder decision — see the note at the top of this task. The accessibility impact is accepted on single-user grounds (CONSTRAINT-04); the ~1,500-lines-per-load console noise is **not** covered by that argument and is the reason to revive this. Status line corrected 2026-08-16: the header was marked `[~]` on 2026-08-12 but this line still read `[ ] Not started`, which made the plan look incomplete to every subsequent `@session-start` scan.

**Depends on:** —

---

## Task 88: Add Saturday as a production day

**PRD deviation, approved by builder 2026-08-17.** `docs/prd.md:568` currently states the invariant "no production date ever falls on a weekend". This task reverses that for Saturday only; Sunday remains excluded. The PRD edit is criterion 1 rather than a prior `@cpo` cycle because the builder specified the full semantics at brainstorm.

**Layout is already correct and needs no change.** `DayColumn.tsx:158` is `w-44 shrink-0` (fixed 176px) and `CalendarBoard.tsx:70` is `overflow-x-auto` free scroll over 9 weeks. A 6th column widens a week 912px → 1104px and the strip scrolls. `calendarScroll.ts:24` measures real `offsetLeft`, so it survives untouched. Builder decision: do NOT shrink columns to fit — scrolling is preferred.

**Files:**
- `docs/prd.md` — modify. Feature 11: the `:568` invariant, `prevBusinessDay` at `:566`, the `:590` layout paragraph (the 1008px/iPad-landscape arithmetic no longer holds and is replaced by "columns are fixed-width and the strip scrolls"), and criteria `:604`, `:606`, `:631`
- `lib/dates.ts` — modify. `isBusinessDay` (`:46`), `BUSINESS_DAYS_PER_WEEK` (`:18`) 5 → 6, `startOfBusinessWeek` (`:89`), `businessWeekDays` (`:101`) doc comment
- `lib/calendar-range.ts` — modify. `MONDAY_TO_FRIDAY_OFFSET` (`:10`) 4 → 5, renamed `MONDAY_TO_SATURDAY_OFFSET`; weekend forward-resolution (`:42`) now Sunday only
- `lib/actions/dates.validation.ts` — modify. Error message at `:65` reads "weekday"
- `components/calendar/calendarWeeks.ts` — modify. Week-range label (`:53`)
- `db/queries/production-widget.constants.ts` — modify. Business-day window (`:61`)
- `lib/__tests__/dates.test.ts`, `components/calendar/__tests__/CalendarLayout.test.tsx:156` — modify
- `db/migrations/0011_backfill_production_date.sql` and its test — **verify only, do not edit.** It is a historical backfill; its `ISODOW > 5` assertion describes what was true in April 2026

**No migration.** `db/schema/orders.ts:27` is a plain nullable `date` with no CHECK constraint. Existing Friday-dated rows are untouched and stay valid.

**Acceptance criteria:**
- [x] `docs/prd.md` updated first, in the same commit — the `:568` invariant rewritten to "no production date falls on a Sunday", `:590` layout claim corrected, and the three acceptance-criteria lines changed from 5 columns / Mon–Fri to 6 columns / Mon–Sat. **Four more lines were edited than this criterion names** — the User Story, User Flow 2, the dashboard-widget sentence, the "Weekend visit" edge case, and `:614` ("A full Mon–Fri is visible without horizontal scrolling at 1024px") — because the spec cited `:631` but `:614` was the line actually carrying the obsolete iPad arithmetic. Leaving a self-contradicting PRD was the worse option
- [x] `isBusinessDay(sat) === true`, `isBusinessDay(sun) === false` — implemented as `day !== SUNDAY`; the now-unused `SATURDAY` constant was deleted
- [ ] `/calendar` renders 6 columns per week, Mon–Sat, at the unchanged 176px width; the strip scrolls horizontally and no column shrinks — **column count and the Saturday column accepting a card are covered in jsdom; real layout and scroll need the builder's device**
- [x] `startOfBusinessWeek(saturday)` returns **that week's Monday**, not the following Monday — Saturday now belongs to its own week. `startOfBusinessWeek(sunday)` still returns the following Monday. **Its body needed no change:** `isBusinessDay(date) ? monday : addDays(monday, 7)` produced both cases for free once `isBusinessDay` widened. Documented in place so the two cannot drift
- [ ] "Current week" on a Saturday scrolls to the week containing that Saturday — **scroll-target computation is unit-tested; the real scroll needs the builder's device**
- [x] `prevBusinessDay(monday)` returns **Saturday**, and `prevBusinessDay(sunday)` returns Saturday — so an order with a Monday delivery date auto-defaults its production date to Saturday (`lib/actions/orders.internal.ts:110`). This is the intended consequence of "full production day", confirmed by builder
- [x] A Saturday `production_date` passes `productionDateSchema`; a Sunday one is still rejected, with the message updated to name Saturday as allowed — now reads `'Production dates must fall on Monday through Saturday.'`
- [ ] Existing Saturday-dated pickups become visible in the new column with no write-side change — `pickups.calendar.validation.ts:32` already uses `calendarDateSchema`. **No write-side change was needed, as predicted; visibility itself needs the builder's device**
- [ ] Drag/drop and long-press-to-arm still work on the 6th column, verified on iPad
- [x] Full suite green at ≥ **1254 tests / 106 files**; `npx tsc --noEmit` and `npm run lint` clean — **1287 tests / 108 files**, both clean

**Tests required:**
- `lib/__tests__/dates.test.ts` → `isBusinessDay` accepts Sat, rejects Sun
- `lib/__tests__/dates.test.ts` → `businessWeekDays(monday)` returns 6 dates ending Saturday
- `lib/__tests__/dates.test.ts` → `businessWeekDays(saturday)` still throws (Monday-only arg)
- `lib/__tests__/dates.test.ts` → `startOfBusinessWeek` — Sat maps back, Sun maps forward
- `lib/__tests__/dates.test.ts` → `prevBusinessDay(monday) === saturday`
- `lib/actions/__tests__/` → `productionDateSchema` accepts Sat, rejects Sun
- `CalendarLayout.test.tsx` → 6 columns rendered per week

**Status:** [x] Done 2026-08-17 — business week is now Mon–Sat, Sunday still excluded. All seven spec'd tests written plus a new `lib/actions/__tests__/dates.validation.test.ts`; suite **1254 → 1287 tests / 106 → 108 files**, `tsc` and `lint` clean. **No layout change was needed or made** — columns were already `w-44 shrink-0` and the strip already `overflow-x-auto`, so a week widened 912px → 1104px and scrolls, per the builder's explicit choice of scrolling over narrower columns. **Two consequences reached beyond the calendar, both intended:** a Monday delivery date now seeds a Saturday `production_date`, and the dashboard production widget's Friday window changed Fri+Mon → **Fri+Sat** (no code change in `productionWidgetDays` — it followed from the widened predicate — but its two test files were updated, which the spec's file list did not anticipate). Saturday pickups were already storable and had simply been rendering into a column that did not exist. `db/migrations/0011` and its test were verified untouched as historical records. **CONSTRAINT-19 was stale in seven places** (weekends-only math, the no-weekend write invariant twice, the 176px/1024px fit claim, the widget window, the summary-table row) and has been corrected with a dated revision note. **Four criteria remain unchecked**, all device-dependent and none code-blocking: the 6-column render and horizontal scroll, "Current week" on a real Saturday, drag/long-press on the 6th column, and Saturday pickups appearing.

**Depends on:** —

---

## Task 89: Renumber the column on placement so intra-day reordering persists

**Defect against existing spec — no PRD entry needed.** `docs/prd.md:576` already requires "Cards land at the exact index released, not appended" and `:608` "Dragging within a day persists the new sequence across a page reload". Neither holds today.

**Root cause.** `setProductionPlacement` (`lib/actions/calendar.ts:111`) writes only the dragged row's `production_sort_index` and never renumbers its siblings, which stay `NULL`. The read sort is `production_sort_index ASC NULLS LAST` (`db/queries/calendar.ts:117`), so one card holding index `1` among `NULL` siblings sorts **above all of them**. Consequence: the first same-day reorder always sends the card to the top of the day regardless of the released position, and if it was already top, nothing visibly changes — which reads as "reordering doesn't work". Cross-day moves look fine only because `production_date` is the primary sort key; their landing position within the destination day is equally wrong. Identical bug in `setPickupPlacement` (`lib/actions/pickups.calendar.ts:114`, `sort_index`).

**Index contract to preserve — do not change the client.** Both input paths already send the desired index into the destination list *with the moved card removed*: the touch path compensates at `armPlacement.ts:96` (`insertionIndex`) and the drag path resolves at `calendarDnd.ts:191`. That is exactly splice semantics. Verify this holds for the drag path during implementation; if `resolveDropTarget` proves off by one for a same-day downward drag, fix it there and add a regression test rather than compensating server-side.

**Files:**
- `lib/actions/placement.renumber.ts` — create. Shared, table-agnostic helper
- `lib/actions/calendar.ts` — modify `setProductionPlacement` (`:95`) and `clearProductionPlacement` (`:149`)
- `lib/actions/pickups.calendar.ts` — modify `setPickupPlacement` (`:94`) and `clearPickupPlacement`
- `lib/actions/__tests__/calendar.test.ts`, `lib/actions/__tests__/pickups.calendar.test.ts` — modify

**No migration.** The columns exist. Legacy `NULL`s self-heal on the first write to their column, because the whole column is rewritten.

**Functions to implement:**
- `renumberColumn(tx: Tx, config: PlacementTable, dateKey: string): Promise<void>` — reads every row on `dateKey` ordered by the table's live sort, then writes a dense `0..n-1` sequence
- `placeAndRenumber(tx: Tx, config: PlacementTable, id: string, dateKey: string, sortIndex: number): Promise<void>` — moves the row, splices it at `clamp(sortIndex, 0, siblings)`, renumbers the destination column, and renumbers the origin column too when the row changed day

**Approach:**
1. Wrap each action's write in `db.transaction` per the house pattern at `lib/actions/customers.ts:141`. Neither calendar action uses one today
2. Read the moved row's current date before writing, so the origin column can be renumbered when it differs
3. Order siblings by the same expression the read query uses — orders: `production_sort_index ASC NULLS LAST, po_number ASC`; pickups: `sort_index ASC NULLS LAST, created_at ASC` — so an untouched column renumbers to the order the user is currently looking at, not a reshuffle
4. Keep all existing guards, `revalidate*Surfaces()` calls, `console.error` payloads and `GENERIC_FAILURE_MESSAGE` handling exactly as they are (EH-01/EH-02)
5. `clear*Placement` nulls the date and index, then renumbers the vacated column

**Acceptance criteria:**
- [x] After any placement, every row sharing that date has a distinct `production_sort_index` / `sort_index` forming a dense `0..n-1` — no `NULL`s, no duplicates
- [x] Same-day reorder lands the card at the exact released position, on both the long-press-and-tap path and mouse drag, and survives a page reload — **server-side contract proven by tests; see the gesture-disagreement note below, which is a client-side UX question and not a violation of this contract**
- [x] Cross-day move lands at the exact released position in the destination column, and the origin column closes its gap
- [x] A column whose rows are all `NULL` renumbers to the order the user currently sees — no visible reshuffle beyond the intended move
- [x] Unschedule (`clear*Placement`) renumbers the vacated column
- [x] Pickups behave identically and stay a separate group — no cross-contamination between the two lists on one day (CONSTRAINT-25)
- [x] Both actions are transactional; a mid-write failure leaves indices unchanged
- [x] No optimistic client state added; `router.refresh()` remains the update path (CONSTRAINT-02)
- [ ] Verified on iPad for the touch path
- [x] Full suite green at ≥ **1254 tests / 106 files**; `npx tsc --noEmit` and `npm run lint` clean — **1287 tests / 108 files**, both clean

**Tests required:**
- `renumberColumn` → dense `0..n-1` from an all-`NULL` column, preserving displayed order
- `renumberColumn` → dense `0..n-1` from a column with duplicate indices
- `setProductionPlacement` → same-day move to index 2 puts the card third, siblings renumbered
- `setProductionPlacement` → cross-day move renumbers both origin and destination
- `setProductionPlacement` → `sortIndex` beyond the column length clamps to last
- `setProductionPlacement` → transaction rollback on write failure leaves indices unchanged
- `setProductionPlacement` → still returns the blocked-status error for cancelled/completed/invoiced orders, unchanged
- `setPickupPlacement` → same-day reorder persists; orders on that day are not renumbered
- `clearProductionPlacement` → vacated column renumbers dense

**Status:** [x] Done 2026-08-17 — the builder's "ordering is not allowed" was one root cause producing two symptoms. `setProductionPlacement` wrote only the dragged row's index while its siblings stayed `NULL`, and under `ORDER BY production_sort_index ASC NULLS LAST` a single card holding index `1` sorts **above** every `NULL` — so the first same-day reorder always threw the card to the top of the day, and did nothing visible at all when it was already there. Cross-day moves only looked correct because `production_date` is the primary sort key; their position within the destination day was equally wrong. Fixed by `lib/actions/placement.renumber.ts` (`renumberColumn`, `placeAndRenumber`, `clearAndRenumber`), with both calendar actions now wrapping their write in `db.transaction` — neither did before. 66 tests across the three placement files; suite **1287 / 108**, `tsc` and `lint` clean. **The drag path needed no off-by-one fix:** `resolveDropTarget` returns `over.index` from the original rendered array, which `verticalListSortingStrategy` makes equivalent to `arrayMove` — already the post-removal splice index. Three deviations from the file list, all additive: `clearAndRenumber` exported as a third function so `clear*Placement` stays thin under CQ-02, plus two new files (`placement.renumber.test.ts`, and `placement.fake-db.ts` scaffolding shared by three test files). `updateKey()` resolves drizzle `.set()` keys via `getTableColumns` rather than trusting `column.name` — they coincide in this schema and would break silently if they ever stopped. **One criterion unchecked:** iPad verification of the touch path, which matters more than usual here — see the note below.

**Open finding, recorded as CONSTRAINT-29 — the two gestures disagree by one.** On a same-column **downward** move the touch path lands the card *above* the tapped card, while drag lands it *in* the tapped card's slot. The `- 1` at `components/calendar/armPlacement.ts:96` is the cause, and drag matches both dnd-kit's own drag preview and armPlacement's stated intent ("takes the tapped card's place") — so the touch path is the odd one out. Both send valid post-removal splice indices, so Task 89's server contract holds either way and this is not a regression: it is a pre-existing Task 68 inconsistency, currently pinned by `armPlacement.test.ts:87`. Left as a builder decision because the builder works on the touch path and this changes muscle memory. A same-day drop on empty column space sends `cardCount`, which counts the moved card and is therefore one past the post-removal end; the server's `[0, siblingCount]` clamp absorbs it into last place, which is the intended outcome either way.

**Depends on:** —

---

## Task 90: Close the three remaining unguarded-`await` wedge bugs

**Defect fix — no `docs/prd.md` entry by design.** These restore intended behaviour; nothing about the product spec changes. Carried as technical debt for two sessions after Task 85 found and fixed the other three of the same family.

**The shape.** All three do `setSubmitting(true)` → bare `await someServerAction(...)` → `setSubmitting(false)`, with no `try`/`catch`/`finally`. Returned errors are handled fine — the actions return `{ error }` for everything they anticipate. A **rejection** is not: transport failure, a dropped connection, or a deploy landing mid-request makes `await` throw, so the `setSubmitting(false)` line is never reached and there is no catch. Because these are async event handlers, the rejection does not reach a React error boundary either — it surfaces as an unhandled promise rejection and renders nothing. The control stays disabled with no message and no recovery but a page reload.

**Why `LoginForm` is the worst of the three:** it is pre-auth and it is the only door. The other two are inside the app, so the user can navigate away and come back; a wedged Sign In button locks the whole application behind it.

**Files:**
- `components/auth/LoginForm.tsx` — modify (`:19-23`)
- `components/leads/LeadNextAction.tsx` — modify (`:39-47`)
- `components/leads/LeadNotesSection.tsx` — modify (`:42-52`)
- `components/auth/__tests__/LoginForm.test.tsx`, `components/leads/__tests__/LeadNextAction.test.tsx`, `components/leads/__tests__/LeadNotesSection.test.tsx` — modify or create as needed

**Approach:** follow the pattern already established by Task 85's three fixes (`DeleteCustomerDialog`, `ConvertLeadDialog`, `useInvoiceSubmit`) — read one before writing, do not invent a second house style. `finally` clears the submitting flag so it cannot be stranded on any path; `catch` logs the cause with context (EH-02) and sets the component's existing user-facing error state to a generic message. Do not surface `cause` to the user (SEC — the error boundaries rule).

**Acceptance criteria:**
- [x] All three handlers wrap their `await` so the submitting flag is cleared on success, on a returned `{ error }`, and on a rejection
- [x] A rejection sets the component's existing error state to a generic message — no `cause`, no stack, no server text rendered. Uses the established `GENERIC_FAILURE_MESSAGE` from `@/lib/errors`, not a new literal
- [x] Each rejection is logged with what failed, where, and the relevant input identifiers (EH-02) — `{ leadId, cause }` for the two lead components; **`LoginForm` logs `{ cause }` alone**, because its only input is the password (SEC-01). A test asserts the password appears nowhere in the `console.error` calls
- [x] The submitting flag is cleared via `finally`, not by duplicating the reset in both branches
- [x] Existing returned-`{ error }` behaviour is unchanged — the specific server message still reaches the user. All three pre-existing tests were also strengthened with a button-re-enabled assertion, which they had been missing
- [x] No new shared abstraction introduced for three call sites; if a fourth appears, revisit
- [x] Full suite green at ≥ **1289 tests / 108 files**; `npx tsc --noEmit`, `npm run lint` and `npm run build` clean — **1292 tests / 108 files**, all four clean

**Tests required:**
- `LoginForm` → action rejects: error message shown, Sign In re-enabled, password never logged
- `LoginForm` → action returns `{ error }`: the server's message still shown (regression guard)
- `LeadNextAction` → action rejects: error shown, Save re-enabled, `onSaved` not called
- `LeadNotesSection` → action rejects: error shown, Save re-enabled, note content preserved, `onSaved` not called

**Status:** [x] Done 2026-08-17 — all three closed, completing the family Task 85 opened. Suite **1289 → 1292**; `tsc`, `lint` and `build` clean. **Two of the three needed a hoist, and that is worth recording:** adding an inline `try`/`catch`/`finally` pushed `LeadNextAction` and `LeadNotesSection` past CONSTRAINT-14's 80-line component cap, so their save paths were extracted to module-level `runSave(leadId, input, deps)` / `runAddNote(leadId, content, deps)` runners with a `*Deps` interface — the same shape `DeleteCustomerDialog`, `ConvertLeadDialog` and `useInvoiceSubmit` already use, because they hit the identical cap for the identical reason last session. `LoginForm` kept its handler inline at 65 lines. Client-side validation (`!date`, `!content.trim()`) stayed in the components; only the network path moved. **`LoginForm` deliberately logs `{ cause }` with no context object** — every other call site logs identifiers, but this one's only input is the password. The three pre-existing returned-`{ error }` tests were each missing a button-re-enabled assertion and were strengthened rather than left alone, since that assertion is what distinguishes a handled error from a wedge. All three test files also gained the `afterEach(vi.restoreAllMocks)` guard from `ConvertLeadDialog.test.tsx`.

**Not verified:** the rejection paths are exercised through mocked actions in jsdom, never against a real dropped connection. That is the same limit the Task 85 fixes shipped under and is accepted — reproducing a mid-flight transport failure reliably is not worth building a harness for.

**Depends on:** —

---

## Task 91: One placement rule on touch — the armed card takes the tapped card's position

**Defect fix — no `docs/prd.md` entry needed.** `docs/prd.md:576` already requires "Cards land at the exact index released, not appended", and `:600` already describes the arm-then-tap gesture. Nothing about the product spec changes; this makes the touch path do what both sentences already promise. It also **retires CONSTRAINT-29**, which recorded the touch/drag disagreement as accepted — the accepted asymmetry is the first of the two root causes below.

**The symptom that pointed at the wrong thing.** Moving a card to a *different* day worked; reordering *within* one day did nothing. That asymmetry was the clue, and it has two independent causes that happen to overlap on the same-day path.

**Cause 1 — the decrement (`armPlacement.ts:96`).** `resolveCardTap` subtracted one from the insertion index on same-day downward taps (`target.index - 1`). That implements "insert *above* the tapped card", which makes the most natural gesture — arm a card, tap the card directly below it — resolve to the armed card's own index and get cancelled by the equality check at `armPlacement.ts:107`. A silent no-op, spec'd by CONSTRAINT-29 and pinned by `armPlacement.test.ts:87`, so every test agreed with it.

**Cause 2 — one tap counted twice (`SortableProductionCard.tsx:95-101`).** The card's armed-mode click handler had no `stopPropagation`, so a tap bubbled to the ancestor `<ul onClick>` at `DayColumnParts.tsx:126` and called `tap` a second time. `tap` (`armMode.tsx:124-139`) is a `useCallback` closed over the `armed` **state**, so within one event loop pass the second call still saw the same non-null `armed` and issued a **second placement** — same-day "bottom of this day", cross-day "bottom of the destination day". Two server actions raced with no in-flight guard, and the second one usually won. **Cross-day masked it:** landing at the bottom of the *correct day* looks like a successful move, so only same-day reordering ever showed the damage. A comment in `DayColumnParts.tsx` asserted the bubbled click would find nothing armed, which is the opposite of what the code did.

**The rule this task establishes, stated once:** *the armed card takes the tapped card's position; tapping empty column space or an empty day appends to the bottom.* One rule for every day, including the same one. Removing the decrement makes touch produce indices **identical to mouse drag** for the same gesture, which is what allows CONSTRAINT-29 to be retired rather than merely narrowed.

**Files:**
- `components/calendar/armPlacement.ts` — modify. `resolveCardTap` (`:105`): drop the `insertionIndex` local and pass `target.index` through verbatim; delete the now-unreachable same-day equality cancel. `resolveColumnTap` is **not** changed — its `cardCount - 1` is correct for a same-day append and stays
- `components/calendar/SortableProductionCard.tsx` — modify (`:95-101`). `stopPropagation` in the armed branch only
- `components/calendar/SortablePickupCard.tsx` — modify. Same change, same reason — the pickup list has the identical ancestor handler
- `components/calendar/DayColumnParts.tsx` — modify (`:126`). Correct the comment claiming a bubbled card click finds nothing armed
- `components/calendar/ColumnPickupList.tsx` — modify. Same false comment
- `components/calendar/__tests__/armPlacement.test.ts` — modify. `:87` asserts the old insert-above rule; rewrite it, do not delete it
- New bubble/parity guards — a test that renders a card inside a real list and clicks it (asserting exactly one placement call), and a test asserting touch and drag resolve the same index for the same move

**No migration, no server change.** `placeAndRenumber` (Task 89) already clamps and renumbers correctly; both gestures were already sending valid post-removal splice indices. This is entirely about which index the client chooses to send, and how many times it sends it.

**Functions / components to implement:**
- `resolveCardTap(armed, target)` — modify. Returns `{ kind: 'place', index: target.index }` for same-day and cross-day alike; the only remaining cancel is the identity check on the armed card itself
- `SortableProductionCard` / `SortablePickupCard` armed-branch click handler — modify. `event.stopPropagation()` before dispatching `tap`, guarded so an **unarmed** tap still bubbles and still opens the popup

**Acceptance criteria:**
- [x] `resolveCardTap` returns `target.index` unchanged for every tap, same-day or cross-day — the `- 1` and its `insertionIndex` local are gone, and touch and drag now compute **identical** indices for the same move
- [x] The same-day index-equality cancel is deleted. With the decrement gone it is reachable only by tapping the armed card itself, which the identity check above it already cancels — leaving both would be two paths for one behaviour
- [x] `resolveColumnTap` is byte-for-byte unchanged; its `cardCount - 1` is correct and is not "fixed" in passing
- [x] One tap produces **exactly one** placement call. A card tap in armed mode calls `stopPropagation` and never reaches the ancestor `<ul onClick>`, on both `SortableProductionCard` and `SortablePickupCard`
- [x] `stopPropagation` fires in the **armed branch only** — an unarmed tap still bubbles normally and still opens the card popup. Plain tap = popup is untouched (FB-14's trade)
- [x] The comments in `DayColumnParts.tsx` and `ColumnPickupList.tsx` are corrected. They claimed a bubbled click finds nothing armed, which is the opposite of the truth and is a large part of why this survived review
- [x] `armPlacement.test.ts:87` is rewritten to assert the new rule, not deleted — the old assertion is the record of what was spec'd, and its replacement is the regression guard
- [x] A test renders a card inside a real list and clicks it, asserting a single placement — no existing test did this, which is precisely why cause 2 was invisible
- [x] No optimistic client state added; `router.refresh()` remains the update path (CONSTRAINT-02). No in-flight guard is added to `tap` — the double call is eliminated at its source rather than absorbed downstream
- [x] CONSTRAINT-29 marked superseded by this task, with its summary-table row updated and the original text preserved
- [x] **Verified by the builder on a real iPad** — FB-14 (line 225c) set the hard rule that a touch task cannot close without real-device validation, and this task exists partly because that rule is the only thing that catches gestures jsdom cannot express. All five must pass:
  - [x] Same-day **downward** move — arm a card, tap a card below it; the armed card lands in that card's position
  - [x] Same-day **upward** move — arm a card, tap a card above it; same rule, same result
  - [x] **Adjacent swap in both directions** — arm a card, tap its immediate neighbour above, then repeat downward. Neither is a no-op
  - [x] **Cross-day tap onto a specific card** lands at *that card's* position in the destination day — **not** at the bottom of it. This is the one that looked correct before and was not
  - [x] **Tap empty space** below the cards in a day (and an entirely empty day) appends to the bottom
- [x] Full suite green at ≥ **1292 tests / 108 files**; `npx tsc --noEmit` and `npm run lint` clean

**Checkbox reconciliation (2026-08-17, Task 92).** Every box above was `- [ ]` while the Status line recorded completion — `docs/qa-report.md` NON-BLOCKING-5, which flagged that "verified" and "forgot to tick" must not look identical at a release gate. Each was re-verified before ticking rather than taken on trust: the ten code/test criteria against disk (`armPlacement.ts` `resolveCardTap`/`resolveColumnTap`, the armed-only `stopPropagation` in both card wrappers, the corrected `DayColumnParts.tsx`/`ColumnPickupList.tsx` comments, the rewritten `armPlacement.test.ts` assertion, the `toHaveBeenCalledTimes(1)` bubble guards in `armMode.test.tsx:294/398`, the absence of any in-flight ref in `armMode.tsx`, and CONSTRAINT-29's struck summary row at `docs/constraints.md:535` with its original text preserved below), and the five iPad gestures against the builder's confirmation, given again in this session.

**Tests required:**
- `resolveCardTap` → same-day **downward** tap returns the tapped card's index, not one less (replaces the `:87` assertion)
- `resolveCardTap` → same-day **upward** tap returns the tapped card's index — unchanged behaviour, kept as a guard that the fix did not swing the other way
- `resolveCardTap` → cross-day tap returns the tapped card's index
- `resolveCardTap` → tapping the armed card itself still cancels
- `resolveColumnTap` → same-day empty-space tap still appends (regression guard on the untouched `cardCount - 1`)
- **Parity** → for the same move, `resolveCardTap` and the drag path's `resolveDropTarget` produce the same index. This is the test that keeps CONSTRAINT-29 retired
- **Bubble** → a `SortableProductionCard` rendered inside its real `<ul>` and clicked while armed fires the placement handler exactly once
- **Bubble** → same for `SortablePickupCard`
- **Bubble** → an *unarmed* card click still reaches the popup handler

**Status:** [x] Done 2026-08-17 — **verified by the builder on the real iPad**, which is the criterion that closes it (FB-14 line 225c). Suite **1292 → 1305**; `tsc` and `lint` clean. Both fixes were reverted in isolation to confirm the new guards actually bite: removing `stopPropagation` fails with `expected 1 call, got 2` — the exact double-fire, which no pre-existing test caught while the bug was live — and restoring the `- 1` fails 5 assertions including two from the touch/drag parity suite. **The `- 1` existed because a code comment claimed the drag path used a post-removal index; it never did.** `resolveDropTarget` reads `index` off the `over` payload, which is the card's static rendered position and is never renumbered mid-drag, so the two paths were made to disagree in order to match a comment that was wrong. **One asymmetry survives and is deliberately not swept up:** `resolveColumnTap` still uses `cardCount - 1` where drag's column-space drop uses `cardCount` verbatim, so CONSTRAINT-29 is retired for card targets, not universally. The parity suite is scoped to card targets and says so in a comment. **Correction (2026-08-17 `@qa`):** this note originally claimed the two paths agree only via a clamp that nothing tests, and proposed a test pinning it. That was wrong — Task 89 already pinned both bounds at `placement.renumber.test.ts:133` (index 99 → last) and `:142` (index −1 → first), using a `BEFORE_FIRST_POSITION` sentinel documented at `:56-63` so the test cannot pass without the clamp. The real residual is different and is recorded as NON-BLOCKING-3 in `docs/qa-report.md`: on a **same-column empty-space drag**, touch cancels while drag computes `target.cardCount` and fires a placement that changes nothing — a wasted write and revalidation, violating the stated intent at `calendarDnd.ts:~164`, and untested (`CalendarDnd.test.tsx:177` covers cross-day only).

**PRD wording to check, not a deviation.** `docs/prd.md:600` reads "tap another card to insert at its position (cards below shift down)". The main clause is exactly the new rule; the parenthetical is only true for upward and cross-day moves — on a same-day downward move the tapped card shifts *up*. Flagged rather than edited, since the builder's approved file list for this task did not include the PRD.

**Depends on:** Task 89 (server-side renumbering — without it, a correct index still would not persist)

---

## Task 92: Consolidate the duplicated auth guard — one checker, called inside the try

**Defect fix — no `docs/prd.md` entry by design.** Nothing about the product spec changes. Source: `docs/qa-report.md` BLOCKING-1 (2026-08-17).

**Two defects, not one.** `lib/actions/auth.guard.ts:14-18` states in the imperative that `assertAuthenticated` must be called **inside** the action's `try`, because `createClient()` (`lib/supabase/server.ts:20-27`) and `getUser()` both reach Supabase and can throw. Three modules ignored the shared guard and defined a local copy, called outside the `try`:

- `lib/actions/invoices.ts:47-52`, called at `:204` (try opens `:210`) — `createInvoice`
- `lib/actions/leads.ts:32-37`, called at `:52,95,157,194,241` — all five lead actions
- `lib/actions/support.ts:55-60`, called at `:71,199,250` — all three support actions

**Placement.** Called outside a `try`, an auth-service blip makes the throw escape the action and reject on the client, where nothing handles it. This compounds with BLOCKING-2: three of those nine are called from sites that swallow rejections, so the operator's work appears to submit into nothing.

**Silence.** Each copy was `if (error || !data.user) return { error: 'You are not signed in.' }` — no `console.error`, and an auth *service* failure collapsed into a missing-session message. That sends an already-signed-in operator to a login screen that cannot help them, and logs nothing. It is exactly the EH-02/EH-04 defect the shared guard was written to fix: the guard logs `{ operation, status, cause }` and returns `GENERIC_FAILURE_MESSAGE` for a service failure, reserving `'You are not signed in.'` for a genuinely absent session.

**No security hole opens or closes here.** All nine actions failed closed before and fail closed after. This is a robustness and observability fix. It nonetheless touches authentication, so the Security Trigger fires and the task cannot close without `@security`.

**Files:**
- `lib/actions/invoices.ts` — modify. Delete the local guard; import the shared one; move the call inside the `try`
- `lib/actions/leads.ts` — modify. Same, across 5 call sites
- `lib/actions/support.ts` — modify. Same, across 3 call sites
- `lib/actions/__tests__/invoices.test.ts`, `lib/actions/__tests__/leads.test.ts`, `lib/actions/__tests__/support.test.ts` — modify

**Approach:** `lib/actions/customers.ts:132` is the reference — it carries the inline comment confirming compliance, and `customer-addresses.ts:56-64` shows the same shape with an id check and a Zod parse following the guard inside the same `try`. Match them; do not invent a second house style. The already-compliant modules (`orders`, `orders.revert`, `customers`, `customer-addresses`, `calendar`, `pickups`, `pickups.calendar`) also import `GENERIC_FAILURE_MESSAGE` from `./auth.guard` rather than redeclaring it, so the three local copies of that constant go with the three local guards.

**Functions / components to implement:**
- No new exported action. `assertAuthenticated` is imported, not written
- `runUploadPreflight(ticketId, file)` in `lib/actions/support.ts` — new **non-exported** helper. `uploadTicketAttachment` had ~20 lines of guard/id/file/quota checks above its `try`; moving them inside pushes the action past CQ-01's 50-line cap, so they move together into one helper called from the first line of the `try`. Not exported, so `'use server'`'s async-only rule and CONSTRAINT-24's endpoint count are both unaffected

**Acceptance criteria:**
- [x] All three local `assertAuthenticated` copies are deleted; a repo-wide search for `async function assertAuthenticated` under `lib/actions/` returns exactly one hit, in `auth.guard.ts`
- [x] All **9** call sites import the shared guard and sit **inside** their action's `try`, matching `customers.ts:132`
- [x] The three local `GENERIC_FAILURE_MESSAGE` declarations are gone; all three modules import it from `./auth.guard`. Same string, so no user-facing copy changes
- [x] `createClient` is no longer imported by `invoices.ts` or `leads.ts` (the guard was its only consumer there); `support.ts` keeps it — the storage upload and the signed-URL mint still need a client (CQ-05, no unused imports)
- [x] Check order within each action is preserved. Auth still runs before the id check and before Zod, so no action starts validating for a caller it has not authenticated
- [x] An auth-*service* failure now returns `GENERIC_FAILURE_MESSAGE` and is logged; a genuinely missing session still returns `'You are not signed in.'`. The two are distinguishable in the log and in the message (EH-02, EH-04)
- [x] `uploadTicketAttachment` and `getSupportAttachmentSignedUrl` have no `await` left outside a `try`. The former's preflight is inside it; the latter's private lookup-only `try` is widened to the whole body, since `createClient()` and `createSignedUrl` sat outside every handler
- [x] `uploadTicketAttachment`'s LOW-01 orphan cleanup still runs on a post-upload failure, and does **not** run when the failure happened before anything was written — `supabase`/`storagePath` stay `undefined` until preflight picks a destination
- [x] No success path changes. No revalidation, transaction, quota, sanitisation or storage behaviour is altered
- [x] CQ-01 every changed function < 50 lines; CQ-02 all three files < 300 lines; CQ-05 no `console.log`, no dead code, no unused imports
- [x] Full suite green at ≥ **1305 tests / 108 files**; `npx tsc --noEmit` and `npm run lint` clean

**Tests required:**
- `createInvoice` / `createLead` / `createTicket` → `getUser` **rejects**: the action resolves to `{ error: GENERIC_FAILURE_MESSAGE }` rather than rejecting, and `console.error` is called with the action's name and `cause`. This is the case no test in the repo covered — every existing auth test used a *resolved* `{ user: null }`
- `createInvoice` / `createLead` / `createTicket` → `getUser` resolves carrying an `error`: generic message, not `'You are not signed in.'`, and the guard's own `{ operation, status }` log fires
- `uploadTicketAttachment` → `getUser` rejects before any upload: handled `{ error }`, and **no** storage upload, transaction, or orphan `remove`
- Existing not-signed-in tests keep asserting `'You are not signed in.'` — the `AUTH_FAIL` fixtures in `leads.test.ts` and `support.test.ts` carried a bogus `error: new Error('no session')` alongside `user: null`, which the shared guard correctly reads as a service failure; they are corrected to `error: null` so they test the case their name claims

**Status:** [x] Done 2026-08-17 — shipped as `11bc142`, **closed on `@security` CLEAR** (0 Critical / 0 High) after the Security Trigger held it open through three audit passes. The audit verified the guard mechanically rather than from the commit message: it parsed every exported async function across all 11 `'use server'` modules and compared byte offsets of `try {`, the guard call, and the first data access — **30 actions, 28 guarded, all 28 inside the `try`, zero with data access before the guard**, no inverted branch and no discarded result at any of the nine changed sites. It also confirmed the shared guard logs *more* than the deleted copies (an `AuthError`'s message/status/code/stack, no token or session) while revealing *less* to the caller, and that it takes no identifier argument, so there is no identity-existence oracle. **Neither blocking pass was ever about this task's code** — the two Highs that held it open were an exposed pair of QA screenshots and a leak in the write-up of that incident, both introduced during the same session's documentation work. All nine call sites are on the shared guard and inside their `try`; the three changed test files went **55 → 62** tests, `tsc` and `lint` clean, full suite green at 108 files. **Behaviour did change in one respect, and it is the point of the task:** an auth-service failure at these nine actions now reads "Something went wrong. Please try again." and is logged, where it previously read "You are not signed in." and was logged nowhere. **`support.ts` needed more than a guard move** — `uploadTicketAttachment` had four checks and two awaits above its `try`, and `getSupportAttachmentSignedUrl`'s `try` covered only its DB lookup, leaving the guard, `createClient()` and `createSignedUrl` outside every handler. Both were brought under one `try`; the former's prelude became `runUploadPreflight` to stay inside CQ-01. **`support.ts` is now 299 lines against CQ-02's 300** — the next change to it must split the attachment machinery into a sibling, the way `orders.revert.ts` and `leads.convert.ts` were extracted at this same cap.

**Not verified:** the rejection paths are exercised through a mocked `getUser` in vitest, never against a real Supabase Auth outage. Same limit Tasks 85 and 90 shipped under, accepted for the same reason.

**Depends on:** —

---

## Task 93: Stop the lead and customer forms failing silently

**Defect fix — no `docs/prd.md` entry by design.** Nothing about the product spec changes. Source: `docs/qa-report.md` BLOCKING-2 (2026-08-17).

**Scoped deliberately to two of four sites.** The finding named four: `components/leads/LeadForm.tsx:83-96`, `components/customers/CustomerForm.tsx:158-168`, `components/support/useTicketSubmit.ts:42-61` and `components/support/TicketAttachments.tsx:17-35`. **The builder deprioritised the two support sites** — the support ticket surface is not in the salesperson's active daily workflow — so this task closes the lead and customer forms only. The two support sites remain open and are recorded in `docs/qa-report.md`; they are not superseded and not fixed.

**The defect.** Both forms awaited a server action with no `try`/`catch` at all. A returned `{ error }` was handled; a **rejection** was not. React Hook Form resets `isSubmitting`, so the button did not wedge — the click simply did nothing, with no log and no message. Against this project's LOUD-failure standard (EH-01, EH-02) silent is worse than sticky: Task 90's three wedge fixes at least left visible evidence. These two are the highest-traffic write surfaces in the app.

**Compounds with Task 92.** `LeadForm` calls `createLead`/`updateLead`, two of the nine actions whose guard sat outside the `try`. Before both tasks, an auth-service blip during lead entry produced a rejection that nothing caught and nothing logged, anywhere in the stack.

**Files:**
- `components/leads/LeadForm.tsx` — modify. Submit path extracted to a module-level `runSave(input, deps)` with a `SaveDeps` interface
- `components/customers/CustomerForm.tsx` — modify. Submit handler extracted to a sibling file
- `components/customers/customerFormSubmit.ts` — **create.** Holds `makeCustomerSubmitHandler` and the catch
- `components/leads/__tests__/LeadForm.test.tsx`, `components/customers/__tests__/CustomerForm.test.tsx` — modify

**Approach:** `components/orders/useOrderForm.ts:97-109` is the reference and is copied faithfully in both — `let result` declared **outside** the `try` so only the action call is guarded, leaving the already-handled `{ error }` branch and the success path byte-identical in behaviour. The error surfaces through the same `role="alert"` banner each form already uses for a returned `{ error }`; no new user-facing surface was invented.

**Why both were extracted rather than caught inline.** `CustomerForm.tsx` was **already 206 lines — over CQ-02's 200-line cap before this change**. Adding the catch in place measured at ~239 lines / 83-line body, worse on both caps; extraction to a sibling brought it to 188 (body 67), so a pre-existing violation was closed on the way past. `LeadForm.tsx`'s body was 54 lines of legitimate JSX overflow, and `docs/constraints.md:183` allows CONSTRAINT-14's 80 lines *only* when the overflow is JSX, not logic — ~10 lines of try/catch would have been logic. Both follow the `runSave` / `*Deps` precedent already in their own directories (`LeadNextAction.tsx:32`, `useInvoiceSubmit`).

**Functions / components to implement:**
- `runSave(input, deps: SaveDeps)` in `components/leads/LeadForm.tsx` — module-level, 26 lines
- `makeCustomerSubmitHandler(deps)` in `components/customers/customerFormSubmit.ts` — module-level, 38 lines

**Acceptance criteria:**
- [x] Both submit paths catch a rejection, log with context, and surface an operator-visible error through the existing `role="alert"` banner
- [x] `console.error` receives **identifiers and `cause` only** — `{ mode, leadId|customerId, cause }`. No form values. These forms carry names, emails and phone numbers (SEC-01/SEC-05), and the tests assert specific field values are absent from the logged arguments, following the precedent `LoginForm.test.tsx:79` set for the password
- [x] The already-handled `{ error }` path is unchanged — the server's own message still reaches the operator verbatim, not flattened into the generic string
- [x] The success path is unchanged — `onSaved`, toast and revalidation behaviour identical
- [x] `CustomerForm.tsx` is back under CQ-02's 200-line cap (206 → 188); `LeadForm.tsx` 167 lines; both new helpers < 50 lines (CQ-01)
- [x] CQ-05 no `console.log`, no dead code, no unused imports
- [x] Full suite green; `npx tsc --noEmit` and `npm run lint` clean

**Tests required:**
- `LeadForm` → `createLead` rejects (create mode): generic alert appears, `onSaved` and toast not called, button re-enabled, `console.error` called **once** with `{ mode: 'create', leadId: null, cause }`, and no personal data in the logged context
- `LeadForm` → `updateLead` rejects (edit mode): the real lead id reaches the log
- `CustomerForm` → `updateCustomer` rejects (edit) and `createCustomer` rejects (create): same assertions, with `customerId` naming the flow
- `CustomerForm` → `createCustomer` returns a handled `{ error }`: the server's specific message reaches the alert un-flattened. **This case had no test at all before**
- Call-count strengthening in both files: each had a bare `toHaveBeenCalled()` on a submit path — the same shape that hid the calendar double-fire in Task 91 — now `toHaveBeenCalledTimes(1)`. Both files also gained `afterEach(vi.restoreAllMocks)`

**Status:** [x] Done 2026-08-17 — shipped as `ba57094`. Suite **1305 → 1317**, 108 files; `tsc` and `lint` clean. **Behaviour on a rejection changed from nothing-at-all to a logged failure plus a visible generic message**; the handled-`{ error }` and success paths are untouched. Two pre-existing defects were closed in passing and are worth remembering: `CustomerForm.tsx` was already over its line cap before this task, and both test files were asserting submit calls without counts. **Not a Security Trigger** — no auth, payment or data-model change; the actions themselves were not touched, only the client-side handling of their rejection.

**Not verified:** the rejection paths are exercised through a mocked action in vitest, never against a real server outage. The two support sites named in BLOCKING-2 are still unfixed by explicit decision.

**Depends on:** — (independent of Task 92, though the two together close the compound failure described above)

---

# Feature 16 — Email PO Ingestion (Tasks 94–113)

**Source:** `docs/prd.md` → "Feature 16: Email PO Ingestion". Supersedes the cut recorded at
`prd.md:178` (Tasks 19 and 33). New assumptions A-07 through A-13 in `docs/assumptions.md`.

**Manifest pre-check waived across this feature** (FI-01) — `manifest.md` is absent and this
project predates the requirement. Following the Task 49 precedent: the waiver is recorded
here, and `**Specialist:**` fields use the existing `@db` / `@ui-totetrack` convention rather
than being omitted.

**Only Tasks 94–97 are written.** Tasks 98–113 are planned in shape but deliberately not yet
specced — they depend on the extraction schema and field descriptions, which are informed by
the first real documents. The agreed sequence:

| # | Task | Specialist |
|---|---|---|
| 98 | Extraction call — OpenRouter + ZDR, schema, source quotes | — |
| 99 | UID + UIDVALIDITY watermark (CONSTRAINT-33) — **[x] done 2026-10-12, security CLEAR** | @db |
| 100 | No silent drops + exact MIME list (CONSTRAINT-34/35) — **[x] done 2026-10-12** (HIGH-02R still open, not in spec) | — |
| 114 | Give up on a UID after 3 failing runs + 1 hour (CONSTRAINT-37, HIGH-02R) — **[x] done 2026-10-12**; `@security` re-run owed; 0019 applied in prod 2026-10-12 | @db |
| 101 | Check suite — quote verification, arithmetic, date ambiguity — **[x] done 2026-10-12**; eval passed on 4 POs, builder confirmed | — |
| 102 | Customer matcher — normalise + `pg_trgm` + address signal — **[x] done 2026-10-12**; 0020 applied in prod 2026-10-12 | @db |
| 103 | Worker foundations — body text, lease column, storage module, failed rows visible (split 2026-10-12, FB-42) — **[x] done 2026-10-12**; 0021 applied in prod 2026-10-12 | @db |
| 115 | Worker core — claim, extract, check, match, persist | @db |
| 116 | Worker route — secret, `after()`, self-chain | — |

**Task 103 sign-off conditions from `@security` (M-04 residual, 2026-10-12)** — the PDF render
deadline cannot interrupt one page mid-render, so the worker must guarantee a hostile PDF still
ends visible (CONSTRAINT-34): (1) increment `attempt_count` **before** rendering starts;
(2) at `MAX_EXTRACTION_ATTEMPTS` the PO becomes a visible review row and is never retried;
(3) set the function's `maxDuration` explicitly; (4) render in a `worker_thread`, **or** the
builder records accepting the CPU cost. HIGH-01 still blocks Task 104 and any production deploy
that runs ingestion.
| 104 | Triggers — 06:00 `America/Chicago` cron + manual, shared secret (route only; the watermark moved to Task 99's `runIngestion`) | — |
| 105 | Badge + dropdown, live progress, last-checked time | @ui-totetrack |
| 106 | Review modal — left pane (image / PDF / text, click-to-expand) | @ui-totetrack |
| 107 | Review modal — right pane, quote highlighting, pickers | @ui-totetrack |
| 108 | Approve / skip / delete — duplicates blocked with a message | — |
| 109 | Auto-advance and "You are all caught up" | @ui-totetrack |
| 110 | Architecture + `document-extraction.md` updates | — |
| — | **core complete — re-evaluate before continuing** | |
| 111 | Duplicate diff + update-existing-order path | — |
| 112 | Inline customer creation, pre-filled, secondary to the picker | @ui-totetrack |
| 113 | Learned per-customer name aliases | @db |

Tasks 111–113 are **in scope but sequenced last by decision (2026-10-07)**. They were
proposed for cutting as exception-path work; the builder kept them and moved them behind the
core. That ordering only pays off if the core is genuinely used before they are started —
`prd.md` records them as "sequenced after the core, pending real usage", not as committed.

**A-12 resolved 2026-10-08:** `pg_trgm` 1.6 is available on the prod project but not
installed. Task 102's migration 0020 enables it.

**`check_results` shape — settled by Task 95, 2026-10-7.** The column is free-form
`jsonb`, but one key is a contract the queue query already depends on: **a failure is an
entry in a top-level `failures` array.** `db/queries/inbound.ts:82-93` sorts the review
queue on `jsonb_array_length(check_results -> 'failures') > 0`, written total so a NULL
column, a missing key or a non-array all count as "no failures" rather than breaking the
queue. **Task 101 must emit that key**; what goes *inside* each entry is deliberately still
open and Task 101 decides it. **Task 107** reads it to order and label the right pane.
Note what the shape cannot express: every entry ranks equally — there is no hard-failure
vs. warning distinction. Adding one is a change *inside* an entry, not to this contract.
Checks rank attention and never gate acceptance: a failure sorts a row to the top, it does
not keep it out of the list.

**No magic numbers anywhere in Feature 16 — audited 2026-10-07.** Every tunable value below
goes in `lib/ingest/ingest.constants.ts` (or `extraction.constants.ts` for Task 98),
following the existing `db/queries/calendar.constants.ts` and
`production-widget.constants.ts` precedent. Not literals buried in logic.

| Value | Where it lives | Why not an env var |
|---|---|---|
| `INGEST_BATCH_SIZE` (POs per invocation, start at 4) | constant | Tied to the Vercel timeout and per-PO latency; changing it is a code decision, not a deployment one |
| `MAX_EXTRACTION_ATTEMPTS` (retries before `extraction_failed`) | constant | Same |
| `ACCEPTED_MIME_TYPES` (`image/*`, `application/pdf`) | constant | Changing it changes parsing behaviour |
| `PO_DOCUMENTS_BUCKET` (`po-documents`) | constant | Fixed by the Supabase project; one source of truth beats a string repeated across files |
| `COMPRESSED_IMAGE_MAX_DIMENSION` / quality | constant | Tuned against legibility, not environment |
| `AMBIGUOUS_DATE_THRESHOLD` (12) | constant | Derived from the calendar, not configurable |

**Environment variables** (all in `.env.example` with placeholder values):
`GMAIL_IMAP_USER`, `GMAIL_IMAP_APP_PASSWORD`, `GMAIL_IMAP_HOST`, `OPENROUTER_API_KEY`,
`OPENROUTER_MODEL`, `INGEST_TRIGGER_SECRET`.

**The one deliberate hardcode, and the reasoning so it is not "fixed" later.** The
per-request `zdr` flag is `true` in code with no override. The configuration-over-hardcoding
rule exists so that values which legitimately *differ* between environments are not baked
in. ZDR must never differ — it is an invariant, not a setting. Behind an environment
variable it acquires a silent failure mode (wrong `.env`, a variable missed on a new deploy)
where privacy is off and nothing breaks loudly. Hardcoding it serves the rule's intent
rather than breaking it. Task 98 asserts it in a test.

**Configuration rules for Task 98, agreed 2026-10-07 — settle these before writing it.**
`OPENROUTER_API_KEY` and `OPENROUTER_MODEL` both come from environment variables, never
hardcoded; `OPENROUTER_MODEL` defaults to `openai/gpt-4.1-mini` but is overridable without
a code change, which is what makes swapping models cheap if accuracy disappoints. This
matches the extraction playbook's rule that config is passed *into* the extraction layer
and never read inside it. **The `zdr` flag is the exception: always `true`, in code, with
no environment override** — a privacy guarantee that can be switched off by environment is
one that will eventually ship switched off. `.env.example` gains both variables with
placeholder values.

---

## Task 94: Amend CONSTRAINT-07 to permit a metered extraction API

**Constraint amendment — no `docs/prd.md` entry by design.** Changes no code and no
user-visible behaviour. It is a gate: CONSTRAINT-07 currently forbids the paid API that
Task 98 requires, and `prd.md:178` already cites this task as the condition being met.

**Files:**
- `docs/constraints.md` — modify. Amend CONSTRAINT-07 in place using the established
  `~~strikethrough~~` + `**Amended [date]:**` convention; do not rewrite history

**Acceptance criteria:**
- [x] CONSTRAINT-07 permits a metered LLM API **scoped to PO extraction only**, via
      OpenRouter with ZDR enforced account-wide
- [x] The amendment restates what remains forbidden: paid Supabase plan, Redis, external
      CDN, any other paid infrastructure
- [x] **No cost figure is pinned.** A dated follow-up action is recorded to write the
      measured figure in after the first few days of real use
- [x] A-13 is cross-referenced for the cost basis (~$0.0015/PO, ~$8/year at 15/day)
- [x] The decisions-log table at `constraints.md:558` gains a row for the amendment

**Tests required:** None — documentation change, no executable code.

**Status:** [x] Done (2026-10-07) — all five criteria met. CONSTRAINT-07 amended in place with the established `~~strikethrough~~` + `**Amended [date]:**` convention; the original decision text stays readable under strikethrough. The API is permitted **only** for PO-document extraction, via OpenRouter with ZDR enforced account-wide (A-08) and the per-request `zdr` flag hardcoded; paid Supabase plan, Redis, external CDN and all other paid infrastructure remain forbidden. **No cost figure was pinned** — A-13 is cited as the basis (~$0.0015/PO, ~$8/year at 15/day), explicitly not as a limit, with a dated follow-up to write the measured spend in after the first few days of real use. Decisions-log row **31** added. No `docs/prd.md` entry, by design. **Note:** `docs/plan.md` has no summary task-status table — status lives only in these per-task `**Status:**` lines — so there was no table row to reconcile.
**Depends on:** None

---

## Task 95: Add the inbound-email staging schema

**Files:**
- `db/schema/inbound.ts` — create. `inbound_emails` + `inbound_pos`, ~~two~~ **three**
  new enums — corrected 2026-10-07: the spec body below defines three (`classification`,
  `source_kind`, `status`); "two" was a miscount, not a scope change
- `db/migrations/0016_inbound_email_ingestion.sql` — create (0015 is the latest)
- `db/queries/inbound.ts` — create. Read/write helpers
- `db/queries/__tests__/inbound.test.ts` — create

**Approach:** two tables, not one. An email yields 0..n POs (three attachments are three
POs), so the email row is the processed-marker and the PO rows are the review queue.

`inbound_emails`: `message_id` text **NOT NULL UNIQUE** — this is both dedupe layer 1 and
the processed marker that replaces the IMAP `\Seen` flag; `classification` enum
(`po_found` | `no_po_found` | `failed`), `from_address`, `subject`, `received_at`,
`processed_at`.

`inbound_pos`: `inbound_email_id` FK cascade; `source_kind` enum (`image` | `pdf` |
`email_body`); `document_path` nullable (null for `email_body`); `content_hash` text
**NOT NULL, indexed, NOT unique**; `duplicate_of_id` uuid self-FK nullable; `status` enum
(`pending_extraction` | `extracting` | `pending_review` | `approved` | `discarded` |
`extraction_failed`); `attempt_count` int default 0; `extracted` jsonb nullable;
`check_results` jsonb nullable; `confirmed` jsonb nullable; `order_id` FK to orders
nullable; `skipped_at` timestamptz nullable.

**Why `content_hash` is not unique:** a duplicate document must still be insertable,
because the agreed design keeps duplicates in the review queue flagged rather than
rejecting them. Uniqueness would make that impossible. This corrects an earlier brainstorm
note that called for a unique index here.

**Why `extracted` and `confirmed` are both retained:** together they are the Feature 16
success metric (% approved with zero edits) and the only correction signal available to
Tasks 111–113. Deleting either loses it permanently.

**Functions to implement:**
- `insertInboundEmail(input): Promise<{ id: string } | { duplicate: true }>` — unique
  violation on `message_id` is caught and reported, not thrown
- `insertInboundPo(input): Promise<{ id: string }>`
- `findPoByContentHash(hash: string): Promise<{ id: string } | null>`
- `listPendingReview(): Promise<InboundPoRow[]>` — check-failures first, then
  `skipped_at NULLS FIRST`, then `created_at`
- `countPendingReview(): Promise<number>`

**Acceptance criteria:**
- [x] RLS is **enabled** on both new tables with policies matching the existing pattern —
      never disabled or bypassed (CONSTRAINT-06 — *the RLS constraint is actually
      **CONSTRAINT-05**; CONSTRAINT-06 is private storage buckets. Implemented against 05*)
- [x] `docs/constraints.md`'s "RLS is enabled on all 8 database tables" is updated to 10,
      or the count is made non-numeric. A stale number here is a security-relevant claim —
      **made non-numeric**: "8" was already stale against 10 live tables, so "10" would have
      been wrong too (the real post-0016 figure is 12). CONSTRAINT-05 now reads "every table
      in the database, without exception" and points at `architecture.md`'s per-table list,
      which was reconciled to 12 the same day. Decisions-log row 32
- [x] `message_id` is UNIQUE; a repeat insert returns `{ duplicate: true }` rather than
      throwing
- [x] `content_hash` is indexed and **not** unique; `duplicate_of_id` is a nullable self-FK
      (`set null`, matching the `orders.invoice_id` nullable-FK precedent)
- [x] Migration 0016 is forward-only — no `DROP`, no destructive statement. Asserted by
      `db/migrations/__tests__/0016.test.ts`, which also pins the only two `ALTER TABLE`
      targets to the two new tables
- [x] `listPendingReview` orders check-failures first, then unskipped before skipped
- [x] CQ-01: every function under 50 lines; CQ-02 all files under 300

**Tests required:**
- `insertInboundEmail` → happy: row created, id returned
- `insertInboundEmail` → error: duplicate `message_id` returns `{ duplicate: true }`,
  does not throw
- `listPendingReview` → check-failures sort ahead of clean rows; skipped sort last

**Status:** [x] Done (2026-10-07) — `db/schema/inbound.ts`, `db/migrations/0016_inbound_email_ingestion.sql`, `db/queries/inbound.ts` and `db/queries/__tests__/inbound.test.ts` created, plus `db/migrations/__tests__/0016.test.ts` (every migration since 0008 has one, and four criteria here are assertions about the SQL file). Three enums — the Files line says two, the body specifies three; the body wins. `content_hash` is NOT NULL + indexed + **not unique**, with the reason comments in both the schema and the migration and a test asserting no unique index, so it cannot be reverted by tidying. `message_id` NOT NULL UNIQUE; a repeat insert returns `{ duplicate: true }` without throwing. `duplicate_of_id` is a nullable self-FK; `duplicate_of_id` and `order_id` are `set null` (spec silent — follows the `orders.invoice_id` precedent). **New contract Task 101 must honour:** a check failure is an entry in a `failures` array on `check_results`, and the ORDER BY type-tests the jsonb before `jsonb_array_length` so an unexpected shape sorts as "no failures" rather than breaking the queue. CONSTRAINT-05's count made non-numeric (log row 32) and `architecture.md`'s RLS list reconciled to 12. **Migration 0016 written by hand and deliberately NOT applied** — no `db:*` command was run against the live database; applying it is the builder's call. `db/migrations/meta/` left untouched: it is a drizzle-kit artifact (`_journal.json` still lists only `0001`). No integration test split out — `db/queries/__tests__/` has never had one; all 11 files mock `@/db` and assert on compiled SQL, so there were no DB-dependent tests to move. Suite: 115 files / 1425 tests passing; `tsc` and `eslint` clean. **Open for Task 110:** `architecture.md:101` still calls `db/queries/*` "read-only DB functions", which this module's insert helpers contradict by spec.
**Depends on:** None
**Specialist:** @db

---

## Task 96: Read unprocessed mail over IMAP

**Files:**
- `lib/ingest/gmail.ts` — create
- `lib/ingest/types.ts` — create. `InboundMessage`, `InboundAttachment`, `GmailDeps`
- `lib/ingest/__tests__/gmail.test.ts` — create

**Approach:** `imapflow` for the connection, `mailparser` for MIME. This module performs
**no database and no storage writes** — it takes the set of already-processed message IDs
as an argument and returns parsed messages. Keeping it pure is what lets its tests run
without a database, matching the extraction playbook's package-boundary rule.

**Read state is never used.** Selection is by UID watermark plus the supplied processed-ID
set, never the `\Seen` flag — opening the inbox in Gmail must not affect ingestion.

**A-09 resolves itself here.** The first action of this task is an IMAP connection; if the
app password no longer works, that surfaces within minutes. Fallback is Gmail API OAuth,
with the 7-day testing-mode refresh-token trap noted in A-09.

**Functions to implement:**
- `fetchUnprocessedMail(processedIds: Set<string>, deps: GmailDeps): Promise<InboundMessage[]>`
- `parseMessage(raw: Buffer): Promise<InboundMessage>` — `{ messageId, from, subject,
  receivedAt, bodyText, attachments: { filename, mimeType, bytes }[] }`

**Acceptance criteria:**
- [x] SEC-01: `GMAIL_IMAP_USER`, `GMAIL_IMAP_APP_PASSWORD`, `GMAIL_IMAP_HOST` read from
      environment only; no credential in source, in a default, or in a log line
- [x] The app password never reaches `console.*`. Test asserts its absence from all logged
      arguments, following the precedent `LoginForm.test.tsx:79` set for the login password
- [x] EH-01 / EH-02: a connection or auth failure throws with context — host and user, never
      the password — and is never swallowed
- [x] No DB write, no storage write, no `db/` import in this module
- [x] Messages already in `processedIds` are not returned
- [x] **`GMAIL_IMAP_USER` must not equal `ADMIN_EMAIL`.** The ingestion inbox is a
      separate account; `ADMIN_EMAIL` is a live Supabase Auth credential
      (CONSTRAINT-04). A startup guard throws with context if the two match, rather
      than quietly reading the login mailbox
- [x] `.env.example` gains `GMAIL_IMAP_USER`, `GMAIL_IMAP_APP_PASSWORD` and
      `GMAIL_IMAP_HOST`, with a comment stating the separate-account rule and that
      the app password requires 2FA plus IMAP enabled on that account. Placeholder
      values only — that file is committed
- [x] Attachments are returned as bytes with their MIME type; body is returned as text
- [x] CQ-01: functions under 50 lines

**Tests required:**
- `parseMessage` → happy: fixture MIME with one PDF attachment yields one attachment and
  the body text
- `fetchUnprocessedMail` → error: auth failure throws with host and user in the message and
  the app password absent from it

**Status:** [x] Done (2026-10-07) — `lib/ingest/gmail.ts`, `lib/ingest/types.ts` and `lib/ingest/__tests__/gmail.test.ts` created (14 tests), plus `lib/ingest/ingest.constants.ts`, which this Files line omits but the feature preamble requires and Task 97 imports: it holds exactly the seven tunables the preamble names, each with its reason for being a constant rather than an env var. **No mailbox, network service or database was contacted** — `GmailDeps.openSession` is required with no default and `createImapSession` (the real `imapflow` session) is exported separately, so no test can reach a live inbox by forgetting to inject a fake. Three error classes went into `lib/errors.ts` beside the nine existing ones: `IngestConfigError`, `ImapConnectionError` (host + user in the message, app password actively scrubbed out of the interpolated reason) and `MimeParseError` (carries the IMAP UID, never body content). The `ADMIN_EMAIL` guard compares trimmed and case-insensitively and names `GMAIL_IMAP_USER`, `ADMIN_EMAIL` and CONSTRAINT-04 — but **not either address**, which CONSTRAINT-04 keeps out of every file including a log sink. Inbox opened `readOnly: true` and `imapflow`'s own logger disabled, so "`\Seen` is never touched" and "the LOGIN line is never printed" are properties of the connection, not promises about the code. **`GmailDeps` carries `config` and `sinceUid`, which the spec does not mention** — the spec requires a UID watermark but gives it no route into the pinned signature, so it travels in this task's own deps type, defaulting to the whole mailbox. **Nothing advances that watermark: Task 99 must decide where the high-water mark is persisted, or every run re-reads the whole mailbox** and relies on `processedIds` alone. **A-09 did NOT resolve** — the spec expects this task's first action to be a live IMAP connection, none was made, so a revoked app password is still undetected. Three constants the preamble names without pinning (`MAX_EXTRACTION_ATTEMPTS`, `COMPRESSED_IMAGE_MAX_DIMENSION`, `COMPRESSED_IMAGE_QUALITY`) were given starting values, each commented as such and pointing at the task that owns revising it. MIME fixture built in memory because `*.pdf` is gitignored repo-wide (CONSTRAINT-30). No integration-test file — nothing under `lib/` has ever had one. Suite: 116 files / 1439 tests passing (1425 before); `tsc` and `eslint` clean. **Doc defect, flagged not fixed:** this task's criteria cite SEC-01, SEC-05, EH-01, EH-02 and CQ-01, none of which exist in `docs/constraints.md` — they are framework rule ids, read as their obvious intent. No constraint was amended.
**Depends on:** None

---

## Task 97: Ingest fetched mail into the staging queue

**Files:**
- `lib/ingest/pipeline.ts` — create
- `lib/ingest/hash.ts` — create. `contentHash`, `normalizeBodyForHash`
- `lib/ingest/__tests__/pipeline.test.ts`, `lib/ingest/__tests__/hash.test.ts` — create

**Approach:** for each message — skip if its `message_id` already exists; write the
`inbound_emails` row; identify candidate POs (attachments of `image/*` or
`application/pdf`, else the body text); for each, hash it, upload to the `po-documents`
bucket, and write an `inbound_pos` row at `pending_extraction`, setting `duplicate_of_id`
when the hash has been seen before.

**Classification here is provisional.** This task can only classify *structurally* — an
accepted-type attachment means "probably a PO", and body-only text cannot be judged
without the model. Task 98 may retroactively set `no_po_found`. Stated so the two tasks do
not contradict each other.

**Body-only hashing is the weakest dedupe layer.** A twice-forwarded email quotes
differently each time, so `normalizeBodyForHash` strips quoted replies, signatures and
whitespace, and some duplicates will still reach the queue as new POs. Accepted —
nothing auto-approves, and the save-time PO-number check is the backstop.

**Functions to implement:**
- `ingestMessages(messages: InboundMessage[], deps: IngestDeps): Promise<IngestSummary>`
- `contentHash(input: Buffer | string): string` — SHA-256, hex
- `normalizeBodyForHash(body: string): string`

**Acceptance criteria:**
- [x] Idempotent: running twice over the same mailbox creates no new rows and no duplicate
      storage objects
- [x] Three accepted attachments on one email produce three `inbound_pos` rows
- [x] A body-only PO gets `source_kind = email_body`, a normalised-body hash, and no
      `document_path`
- [x] A repeat `content_hash` **still inserts** a row, with `duplicate_of_id` set and status
      `pending_extraction`, so it reaches the review queue
- [x] An email with no candidate PO still writes its `inbound_emails` row with
      classification `no_po_found` — nothing is silently discarded
- [x] CONSTRAINT-30: documents are written only to the `po-documents` bucket. No source
      document is ever written to the repository or any non-gitignored path. PO documents
      are production data by the same reasoning that applied to QA screenshots
- [x] EH-01 / EH-02: a failure on one message is caught, logged with its message id, sets
      that email's classification to `failed`, and the loop continues. One bad email must
      never abort the batch
- [x] A storage upload failure leaves **no** `inbound_pos` row — no row may point at a
      missing object
- [x] Logged context carries identifiers only — message id, hash, counts. No body text, no
      customer names, no attachment contents (SEC-01 / SEC-05)
- [x] CQ-01: functions under 50 lines; `pipeline.ts` under the service file cap

**Tests required:**
- `ingestMessages` → happy: one email with one PDF yields one email row, one PO row, one
  storage upload
- `ingestMessages` → error: storage upload rejects, so no PO row is created, classification
  is `failed`, and the remaining messages still process
- `normalizeBodyForHash` → happy: two forwarded variants of the same body hash equal
- `contentHash` → error case: empty input throws rather than returning a hash of nothing

**Status:** [x] Done (2026-10-07) — `lib/ingest/pipeline.ts` (240 lines), `lib/ingest/hash.ts`, `lib/ingest/candidates.ts` and the two test files created (22 tests; suite 118 files / 1461 tests passing, `tsc` and `eslint` clean); documents are hashed and uploaded **before** the `inbound_emails` row is written, because the Task 95 data layer has no classification-update helper and a storage failure must land as `classification = 'failed'` with no PO row on the first and only write; a repeat `content_hash` still inserts a row with `duplicate_of_id` set and `status` left to its column default, so a duplicate is flagged and reviewed rather than rejected; storage keys are content-addressed (`inbound/<sha256><ext>`, never the sender's filename), which is what makes a repeated batch create no duplicate object; `normalizeBodyForHash` unquotes `>` markers rather than dropping those lines (in a forward the PO *is* the quoted block) and strips forward/reply separators, attribution lines, re-emitted headers and the signature; `contentHash` throws `ContentHashError` on empty input; logs carry message ids, counts and 12-character hash prefixes only. **Deviations:** `candidates.ts` is a fifth file, split out because `pipeline.ts` was 331 lines against the 300-line cap this task's own CQ-01 criterion cites; `IngestDeps` / `IngestSummary` are declared in `pipeline.ts` because `types.ts` defines neither and was off-limits; `lib/errors.ts` gained `ContentHashError` and `DocumentUploadError`. **Flagged, not fixed:** a DB failure *after* the email row is written cannot correct that row's classification — it is logged with the message id and reported in `failedMessageIds`, but reconciling it needs an update helper in `db/queries/inbound.ts` (at 298/300 lines). **Owed by Task 104:** production wiring of `IngestDeps`, and a "list processed message ids" query, which `db/queries/inbound.ts` does not have.
**Depends on:** Task 95, Task 96

---

## Task 98: Extraction call — OpenRouter + ZDR, schema, source quotes

**Written 2026-10-12 after reading the first 4 real POs** (four senders, four layouts, all
single-page digital PDFs). Sample documents are production data and are **not** committed
or quoted here — not even sender names (`constraints.md:536`).

**Scope: one pure function, document in → structured reading out.** No database writes, no
queue, no retries — those are Task 103's worker. No checks — those are Task 101. This task
produces the JSON that `inbound_pos.extracted` will hold.

**Decisions from the brainstorm (2026-10-12), binding on this task:**
- **Tote types are interpreted, not matched.** Six types — 275/330 × Recon / Rebottled /
  New. Field descriptions give *examples* of each (Recon: `RECON`, `REC`,
  `Reconditioned`; Rebottled: `REB`, `REBOT`, `Rebottled`; sizes `275`/`330` with or
  without `GAL`/`G`), and the model is told to interpret unseen abbreviations. Extra
  descriptors (`Limited Use`, `NAT`, valve/bung specs) are ignored. **When the type is
  undeterminable the line is returned as `unknown` with its quote — never guessed.**
- **Every PO is a delivery.** `customer_collects` is not extracted (also PRD Out of Scope);
  the salesperson marks a pickup in review.
- **Delivery-date synonyms include ship date.** `Sched. Delivery Date`, `Need Date`,
  `Expected`, `Ship Date` are delivery-date candidates; `Order Date` / `P.O. Date` are
  not. All labelled dates are returned with label and role — choosing among several is
  Task 101/107's job (PRD: none pre-selected).
- **Price = Σ(qty × unit price) over tote lines only.** Non-tote lines (service notes,
  accruals, freight) are returned as `other` lines with any amount, **for Task 101's
  arithmetic check only — never persisted to `orders`.** A dedicated "Other" order field was
  proposed and **parked by the builder** — the existing order structure is unchanged.
- **One PO per document.** Confirmed by the builder; multi-PO PDFs are not handled.

**The vendor-block trap.** Every sample names *us* in a "Vendor" block, under varying legal
names. The prompt states the vendor is never the customer; the customer is the issuer
(letterhead / buyer / bill-to). Our name variants live in `extraction.constants.ts`.

**The several-numbers trap.** One sample carries its PO number under a bare `Number` label
*plus* an end-customer `CUST PO` and a `REF#`. The schema returns **all** PO-number
candidates with labels; the field description says the issuer's own PO number is the one
in the header, not one quoted inside a line description.

**Files:**
- `lib/extraction/extraction.constants.ts` — create. Default model (`openai/gpt-4.1-mini`),
  temperature 0, request timeout, `MAX_PDF_PAGES`, render scale, our vendor-name variants
- `lib/extraction/types.ts` — create. `ExtractionInput`, `ExtractedPo`, `ExtractedLine`,
  `ExtractedDate`, `Quoted<T>` (`{ value, quote }`)
- `lib/extraction/schema.ts` — create. JSON schema sent as `response_format`, per-field
  descriptions, and the zod schema validating the response
- `lib/extraction/prompt.ts` — create. System prompt
- `lib/extraction/config.ts` — create. `readExtractionConfig(env)`, mirroring
  `readGmailImapConfig`: `OPENROUTER_API_KEY` required, `OPENROUTER_MODEL` optional
- `lib/extraction/render-pdf.ts` — create. PDF → one PNG per page (CONSTRAINT-35/36)
- `lib/extraction/openrouter.ts` — create. The HTTP call
- `lib/extraction/extract.ts` — create. `extractPo` orchestrator + `toOrderQuantities`
- `lib/extraction/__tests__/*.test.ts` — create
- `.env.example` — modify. `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` placeholders
- `package.json` — modify. Adds the PDF renderer

**Approach:**
1. **Input by kind.** PDF → rendered to page images. Image (`jpeg`/`png`/`webp`) → passed
   through unmodified. Email body → sent as text. Over `MAX_PDF_PAGES` → a typed error
   naming the page count, which Task 103 turns into a visible review row (CONSTRAINT-34) —
   **never silently truncated**.
2. **PDF renderer: `pdfjs-dist` + `@napi-rs/canvas`** (Apache-2.0 / MIT, prebuilt Linux
   binaries for Vercel). Rejected: `mupdf` — one package, but **AGPL**; native PDF
   passthrough — unverified with this provider (CONSTRAINT-36). **Assumption to verify in
   this task:** `@napi-rs/canvas` loads in a Vercel function. If not, stop and re-decide.
3. **The call.** `POST /api/v1/chat/completions` with a strict `json_schema`
   `response_format` and `provider: { zdr: true, require_parameters: true }`. **`zdr: true`
   is a literal in code, no env override** (plan header). No usable ZDR route → OpenRouter
   errors → we throw loudly; there is no fallback.
4. **Response handling.** Parsed with zod. Malformed JSON, schema mismatch, non-2xx and
   timeout each throw a distinct typed error with model, status and context — **never
   document content** (SEC-01/05).
5. **Output shape (stored as `extracted`).** Per field `{ value, quote }`: PO-number
   candidates, customer name, ship-to address, bill-to address, labelled dates (value,
   label, role: `order` | `delivery` | `other`), stated total, and lines — each
   `{ kind: 'tote' | 'other', toteType: one of 6 | 'unknown', qty, unitPrice, lineTotal,
   quote }`. Plus `isPurchaseOrder: boolean`, so a non-PO document can become
   `no_po_found` (Task 97's provisional classification).
6. **`toOrderQuantities(extracted)`** — pure; sums tote lines into the six `qty_*` /
   `unit_price_*` slots and derives `price`. Two lines of one type at **different** unit
   prices → reported as a conflict, not averaged.

**Evaluation — acceptance gate, outputs never committed.** Run `extractPo` on the 4 real POs
via a scratchpad script; the builder checks every field against the document. Pass bar:
tote type, qty and unit price right on every tote line; PO number and delivery date right
where present; nothing invented where the document is blank.

**Functions to implement:**
- `extractPo(input: ExtractionInput, config: ExtractionConfig, deps?): Promise<ExtractedPo>`
- `renderPdfPages(pdf: Buffer, maxPages: number): Promise<Buffer[]>`
- `callOpenRouter(request, config, fetchImpl): Promise<unknown>`
- `readExtractionConfig(env): ExtractionConfig`
- `toOrderQuantities(extracted: ExtractedPo): OrderQuantities`

**Acceptance criteria:**
- [x] `zdr: true` on every request; a test fails if it is absent or env-controlled
- [x] `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` from env only; a missing key throws at
      config read, naming the variable
- [x] PDFs reach the model as page images, never as a PDF; images unmodified
- [x] Every returned value carries a quote; `unknown` tote type is a valid output, not an error
- [x] Over-page-limit, malformed response, non-2xx and timeout each throw a distinct typed
      error; none caught and swallowed (EH-01/02)
- [~] Logs carry model, status, page count, durations — **moved to Task 103** (@security L-A, 2026-10-12): `lib/extraction/` deliberately has no log statements; the worker that calls it logs model, status, page count and ms, never content. Ticked in error at first
- [x] Evaluation passes on all 4 POs, confirmed by the builder
- [x] CQ-01/02: functions < 50 lines, files < 300
- [x] Full suite green; `tsc` and `lint` clean

**Tests required:**
- `readExtractionConfig` → happy; missing key throws
- `callOpenRouter` → body has `zdr: true`, strict schema, model from config; non-2xx
  throws with status; timeout throws
- `extractPo` → happy with mocked fetch; malformed JSON throws; schema mismatch throws
- `renderPdfPages` → synthetic in-test PDF (never a real PO) yields N PNGs; over limit throws
- `toOrderQuantities` → lines sum into the right slots; one type at two prices reports a
  conflict; `other` lines excluded from price

**Model output is untrusted input for Tasks 101/107 (@security L-D).** Prompt injection in a
document can set any field: `isPurchaseOrder: false`, negative or huge quantities and prices,
arbitrary-length quotes. Downstream must: keep `no_po_found` a visible review row, never a drop
(CONSTRAINT-34); bound numbers (integer quantity > 0, price ≥ 0 with a sane max) before they
reach `orders`; render quotes as text only, never HTML.

**Open for Task 101, surfaced so it is not lost:** quote verification against a **rendered
image** has no local text to check — CONSTRAINT-35 forbids local text extraction.
Body-text POs verify trivially; images do not. Task 101 must decide how.

**Specialist:** —
**Status:** [x] Done 2026-10-12 — `lib/extraction/`: constants, types, errors, schema, prompt, config, render-pdf, openrouter, extract (largest file 150 lines, longest function ~30). Built by three parallel subagents against a hand-written shared contract (types, schema, errors). **Evaluation passed on all 4 real POs, confirmed by the builder** — tote type, qty and unit price right on every tote line; PO number and delivery date right where present; nothing invented. **It took two prompt iterations:** first run named one PO's ship-to company as the customer; second named a buyer's initials; the customer rule is now "Bill To company, else letterhead — never ship-to, never a person". Empty `$0.00` template rows were also being returned as lines; now skipped. **Deviations:** errors live in `lib/extraction/errors.ts` rather than `lib/errors.ts` (merging would push that file to ~319 lines, over CQ-02); `toOrderQuantities` stayed in `extract.ts` (141 lines). **New deps:** `pdfjs-dist` 6.4.299, `@napi-rs/canvas` 1.0.11, pinned — **not yet run on Vercel** (A-14 records the `serverExternalPackages` + Node ≥ 22.13 prerequisites for Task 103/104). Timeout covers the response body too, not just headers. Suite 127 files / 1591 tests; `tsc` and `eslint` clean. Also fixed in passing: a `db/seed.ts` type error introduced by the CONSTRAINT-20 guard commit.
**Depends on:** Task 94 (done)

---

## Task 99: Track processed mail by UID + UIDVALIDITY (CONSTRAINT-33)

**Planned 2026-10-12.** Pulled ahead of the check suite by decision: it has no dependency on
extraction and clears HIGH-01, the only open High. **Re-run `@security` after this task.**

**Files:**
- `db/migrations/0017_uid_watermark.sql` — create. `inbound_emails` gains `uid_validity bigint
  NOT NULL` and `uid bigint NOT NULL` + `UNIQUE (uid_validity, uid)`; `message_id` drops
  `UNIQUE` and `NOT NULL`. New table `ingest_mailbox_state` (`mailbox text PK`,
  `uid_validity bigint NOT NULL`, `last_uid bigint NOT NULL`, `last_run_at timestamptz`) with
  RLS matching CONSTRAINT-05. **The migration aborts loudly if `inbound_emails` has any row.**
  Applied locally via `db:migrate-local`; prod by the builder pasting into the SQL editor
  (never `db:migrate`).
- `db/migrations/__tests__/0017.test.ts` — create
- `db/schema/inbound.ts` — modify to match; header comment rewritten (message_id is a label)
- `db/queries/inbound.ts` — **split** (298/300 lines) into `inbound-emails.ts`,
  `inbound-pos.ts`, `ingest-state.ts`; tests split to match
- `lib/ingest/imap-session.ts` — modify. Expose the open mailbox's `uidValidity`
- `lib/ingest/gmail.ts`, `lib/ingest/message.ts`, `lib/ingest/types.ts` — modify
- `lib/ingest/identity.ts` — **delete** (with its tests). `boundHeader` moves to `message.ts`
- `lib/ingest/hash.ts` — modify. `refusalHash(uidValidity, uid, failure)` replaces
  `surrogateContentHash`
- `lib/ingest/pipeline.ts` — modify. Writes via `stageEmailWithPos`
- `lib/ingest/run.ts` — create. Orchestrator; not wired to any route (Task 104)

**Approach:**
1. **Admission is by UID only.** `collectUnprocessed` drops `processedIds`; a message is admitted
   iff `uid > watermark` and `uid ∉ stagedUidsAbove(watermark)` (a UID-only DB lookup, so H-01's
   "admission before bytes" holds and no parsed header participates). The post-parse UID
   re-check returns as layer two (architecture rule 3).
2. **`InboundMessage` gains `uid`; `messageId` becomes `string | null`** — a bounded display
   label. No branch reads it. `identityForDeclared`, `standInMessageId`, `canonicalMessageId`
   and the `ingest-uid:` / `ingest-longid:` / `ingest-claimed:` prefixes are removed.
3. **One transaction per message.** `stageEmailWithPos(email, pos[])` inserts the email row and
   all its PO rows atomically; a `(uid_validity, uid)` unique violation returns
   `{ duplicate: true }` (reported, not thrown). Uploads happen before it (content-addressed,
   idempotent).
4. **`runIngestion(deps): Promise<IngestRunSummary>`** — read state → open session → compare
   UIDVALIDITY → fetch → stage → advance → write `last_run_at`. The watermark advances to the
   **highest UID such that every listed UID ≤ it is committed or already staged**. A failed or
   deferred message halts the advance there and is returned in the summary
   (`haltedAtUid`, `failedUids`, `deferredUids`). Later messages are still staged.
5. **UIDVALIDITY changed** → `console.error` with old and new values, watermark reset to 0 under
   the new validity; `content_hash` flags the re-ingested duplicates (architecture failure-mode
   table).

**Functions to implement:**
- `runIngestion(deps: IngestRunDeps): Promise<IngestRunSummary>`
- `advanceWatermark(current: number, outcomes: UidOutcome[]): number` — pure
- `stageEmailWithPos(email, pos): Promise<{ id: string } | { duplicate: true }>`
- `readIngestState(mailbox)`, `writeIngestState(state)`, `stagedUidsAbove(uidValidity, uid)`
- `refusalHash(uidValidity, uid, failure): string`

**Acceptance criteria:**
- [x] No branch reads `message_id`; a test stages two messages sharing one `Message-ID`, both land
- [x] Crash between staging and watermark advance: next run re-lists, the composite unique blocks
      a second staging, no bytes are re-downloaded for already-staged UIDs
- [x] A failed or deferred UID halts the watermark below it and appears in the run summary
- [x] UIDVALIDITY change resets the watermark and logs loudly
- [x] `identity.ts` deleted; no `ingest-uid:` / `ingest-longid:` / `ingest-claimed:` left in `lib/` or `db/`
- [x] Migration test: no unique index on `message_id`; composite unique present; abort-if-rows
      guard present; RLS enabled on `ingest_mailbox_state`
- [x] `readOnly: true` on the IMAP connection unchanged
- [x] SEC-05: logs carry UIDs, counts and hash prefixes — never addresses, subjects or bodies *(re-ticked after MEDIUM-04 was fixed and re-verified 2026-10-12)*
- [x] CQ-01/02: functions < 50 lines, files < 300; full suite green; `tsc` and `eslint` clean

**Tests required:**
- `advanceWatermark` → contiguous success advances; a gap halts; empty run unchanged
- `runIngestion` → happy path advances + writes `last_run_at`; failure halts; UIDVALIDITY change
  resets; already-staged UID skipped without `fetchSource`
- `stageEmailWithPos` → inserts both; duplicate returns `{ duplicate: true }`; other DB error throws
- `collectUnprocessed` → admits by UID; post-parse re-check rejects a UID at/below the watermark
- `0017` migration → SQL assertions above

**Depends on:** Tasks 95–97 (done)
**Specialist:** @db
**Status:** [x] Done (2026-10-12). `@security` CLEAR after two targeted fixes: HIGH-02 (NUL headers and implausible dates cleaned at the boundary) and MEDIUM-04 (`lib/loggable-failure.ts`). **Residual HIGH-02R** (a message that keeps failing pins the watermark) is owed by **Task 100** as builder option 1, "give up after N tries", via `@cto`; it gates Task 104. 0017 applied locally only, not prod. `stageEmailWithPos` resolves `duplicate_of_id` inside its transaction, so sibling POs in one email are flagged. `insertInboundEmail`, `insertInboundPo` and `findPoByContentHash` are removed: nothing calls them now. `fetchUnprocessedMail` is replaced by `openMailbox` / `collectUnprocessed` / `closeMailbox`, because UIDVALIDITY is only known once the session is open. The upload-failure path still commits a `failed` email row; Task 100 changes that. See the session log.

---

## Task 100: No silent drops, and the exact accepted file types (CONSTRAINT-34/35)

**Planned 2026-10-12.** Every path that today drops part of a message becomes a review row.

**Files:**
- `lib/ingest/ingest.constants.ts` — modify. `ACCEPTED_MIME_TYPES` = exactly
  `application/pdf`, `image/jpeg`, `image/png`, `image/webp`; `PO_DOCUMENT_EXTENSIONS` shrinks to
  match; `PO_DOCUMENT_FALLBACK_EXTENSION` removed
- `lib/ingest/candidates.ts` — modify. Wildcard matcher removed; `image/jpg` normalised to
  `image/jpeg` before matching
- `lib/ingest/types.ts` — modify. `IngestLimitReason` gains `unsupported_format`,
  `empty_attachment`, `no_po_found`; `IngestLimitFailure` gains optional `mimeType`
  (sanitised to `type/subtype`, ≤ 100 chars). Discriminator `check: 'ingest_limit'` unchanged
- `lib/ingest/limits.ts`, `lib/ingest/pipeline.ts` — modify
- tests for each

**Approach:**
- Unlisted type → `unsupported_format` refusal row carrying the sanitised MIME type, so the
  review row can say "ask the vendor to re-send as PDF or JPG".
- Empty attachment → `empty_attachment` refusal row (replaces the `console.error` + `continue`).
- No candidates and no refusals → one `email_body` row with reason `no_po_found`, in the review
  queue. Spam is dismissed by a human, never by the system.
- **Storage upload failure throws for that message** — nothing commits, Task 99's watermark halts
  below it, the next run retries. The current "write the refusals only and classify `failed`"
  partial path is removed.
- **M-03 (inline parts) accepted as-is, by decision 2026-10-12:** a signature GIF becomes an
  `unsupported_format` row beside the real PO; filtering inline images would be a drop path, and
  a pasted PO screenshot is an inline image. Revisit after real usage.

**Acceptance criteria:**
- [x] Every path through `selectCandidates` / `stageDocuments` ends in a committed row or a thrown
      error — one test per message shape
- [x] SVG, HEIC, TIFF and GIF attachments each produce an `unsupported_format` row
- [x] An email with no PO and no attachment content produces exactly one `no_po_found` review row
- [x] An upload failure leaves no row for that message and halts the watermark
- [x] SEC-05: no sender filename, subject or body in `check_results` or logs
- [x] CQ-01/02; full suite green; `tsc` and `eslint` clean

**Tests required:**
- `selectCandidates` → accepted types pass; each excluded type refused; `image/jpg` accepted;
  empty attachment refused; nothing → `no_po_found`
- `ingestMessages` / `runIngestion` → upload failure throws and nothing commits

**Depends on:** Task 99
**Status:** [x] Done (2026-10-12). `selectCandidates` now ends every attachment as a candidate or a refusal (`triageAttachment`), and an email with neither yields one `no_po_found` row (email classified `no_po_found`, not `failed`). `PO_DOCUMENT_EXTENSIONS` is keyed by `AcceptedMimeType`, so the compiler enforces the pairing; `documentPathFor` has no fallback. `mimeType` on a refusal is lowercased, parameter-stripped, checked against RFC 6838 characters and dropped (not truncated) above `MAX_RECORDED_MIME_TYPE_LENGTH`. Upload failure propagates to `ingestMessages` → `failedUids` → watermark halts; proven end to end in `run.test.ts`. **Not in this task:** HIGH-02R "give up after N tries" — the Task 99 status line says Task 100 owes it, but this spec never included it; it still needs `@cto` and gates Task 104. Suite 132 files / 1633 tests.

---

## Task 114: Give up on a UID after 3 failing runs + 1 hour (CONSTRAINT-37, HIGH-02R)

**Planned 2026-10-12** (`@cto` → FB-41, CONSTRAINT-37). Numbered 114 to avoid another renumber;
**executes before Task 101 and gates Task 104.** Closes HIGH-02R: no message can pin the
watermark. Design: `docs/architecture.md` → "Give-up rule".

**Files:**
- `db/migrations/0019_ingest_uid_failures.sql` — create. Table `ingest_uid_failures`
  (`uid_validity bigint`, `uid bigint`, PK both; `attempts integer NOT NULL`;
  `first_failed_at`, `last_failed_at timestamptz NOT NULL`). RLS per the 0002 single-user
  pattern. Prod: pasted by hand before Task 104; locally `db:migrate-local`. Never `db:migrate`.
- `db/migrations/__tests__/0019.test.ts` — create
- `db/schema/inbound.ts` — modify (table definition)
- `db/queries/ingest-failures.ts` + `db/queries/__tests__/ingest-failures.test.ts` — create
- `lib/ingest/limits.constants.ts` — modify. `GIVE_UP_MIN_ATTEMPTS = 3`,
  `GIVE_UP_MIN_AGE_MS = 60 * 60 * 1000` (builder decision, not env vars)
- `lib/ingest/types.ts` — modify. `IngestLimitReason` gains `staging_failed`; `unit` gains
  `runs`; `DeclaredMessage` and `InboundMessage` gain `arrivedAt: Date | null` (IMAP
  `INTERNALDATE`, server-assigned); `CollectedMail` gains `arrivals: Map<number, Date | null>`
- `lib/ingest/imap-session.ts` — modify. Listing also requests `internalDate`; still never `source`
- `lib/ingest/message.ts`, `lib/ingest/gmail.ts` — modify. Carry `arrivedAt` through, fill `arrivals`
- `lib/ingest/give-up.ts` + `lib/ingest/__tests__/give-up.test.ts` — create
- `lib/ingest/run.ts` + `lib/ingest/__tests__/run.test.ts` — modify. New injected deps:
  `recordFailures`, `clearFailures`, `clearOtherValidities`

**Functions to implement:**
- `recordFailures(uidValidity: number, uids: number[], now: Date): Promise<FailureRecord[]>` —
  upsert; `attempts + 1`, `last_failed_at = now`, `first_failed_at` kept on conflict; returns
  the post-increment rows. Throws `DatabaseError`
- `clearFailures(uidValidity: number, uids: number[]): Promise<void>`
- `clearOtherValidities(uidValidity: number): Promise<void>` — on a UIDVALIDITY reset
- `shouldGiveUp(record: FailureRecord, now: Date): boolean` — `attempts >= GIVE_UP_MIN_ATTEMPTS`
  **and** `now - first_failed_at >= GIVE_UP_MIN_AGE_MS`. Pure
- `placeholderMessage(uid: number, arrivedAt: Date | null, attempts: number): InboundMessage` —
  `messageId`/`from`/`subject` null, `receivedAt = arrivedAt`, empty body, no attachments,
  `rejection = { check: 'ingest_limit', reason: 'staging_failed', part: 'message',
  measured: attempts, limit: GIVE_UP_MIN_ATTEMPTS, unit: 'runs' }`. Pure

**Flow in `runIngestion`** (after `ingestMessages`, before `writeState`):
1. `failed = staging.failedUids ∪ collected.rejectedUids`. Deferred UIDs are never included.
2. `records = recordFailures(failed)`; for each record where `shouldGiveUp`, stage
   `placeholderMessage(...)` through `ingestMessages`; its committed UIDs move from failed to
   committed.
3. `clearFailures` for every committed UID, placeholders included. On a UIDVALIDITY reset,
   `clearOtherValidities` first.
4. `advanceWatermark` as today; summary reports `gaveUpUids`.

**Acceptance criteria:**
- [x] 3 failing runs but < 1 hour since the first → no placeholder, watermark still halted
- [x] ≥ 1 hour but < 3 failing runs → no placeholder
- [x] 3 runs **and** ≥ 1 hour → one `failed` `inbound_emails` row (`message_id`, `from_address`,
      `subject` NULL; `received_at` = INTERNALDATE) + one `staging_failed` row at
      `pending_review`; the watermark passes the UID
- [x] Deferred UIDs never increment a counter
- [x] A UID that commits on retry has its counter row deleted
- [x] Placeholder write fails (DB down) → UID stays failed, counter kept, retried next run
- [x] A UIDVALIDITY change clears counters belonging to the old validity
- [x] SEC-05: no sender-written value in the placeholder, `check_results` or logs
- [x] H-01: the listing still never requests `source` (existing test stays green)
- [x] EH-01/02: counter failures throw `DatabaseError` with UIDs only, no headers
- [x] CQ-01/02; full suite green; `tsc` and `eslint` clean

**Tests required:**
- `shouldGiveUp` → both thresholds on each side of the boundary
- `placeholderMessage` → exact shape; no header field set
- `runIngestion` → fail ×3 with the clock advanced past 1 hour → placeholder staged, watermark
  advances, counter cleared; deferred never counts; retry success clears the counter;
  placeholder write throws → UID still failed, counter kept
- `ingest-failures` against local Postgres → upsert increments, `first_failed_at` preserved,
  clear removes rows
- `0019` → table, PK, RLS present

**Depends on:** Task 100 (done)
**Specialist:** @db
**Status:** [x] Done (2026-10-12). `giveUpOnFailures` (in `give-up.ts`) owns increment → threshold → placeholder staging; `runIngestion` calls it through `settleFailures` and then clears the counter. Two small additions beyond the spec: (1) `clearFailures` also clears **already-staged** UIDs, so a crash between a commit and its clear leaves no stale row; (2) `recordFailures` rejects an unparseable timestamp read back from the DB instead of returning `Invalid Date`. New `npm run test:integration` loads `.env` and runs `*.integration.test.ts` against the local stack (guarded to localhost); `npm test` skips those visibly. 0019 applied locally and pasted into prod by the builder (2026-10-12). Mutation-checked: OR'd thresholds, counting deferred UIDs and dropping the clear all fail tests. Suite 137 files / 1670 passed + 3 integration skipped.

---

## Task 101: Check suite — quotes, arithmetic, dates, field gates

**Planned 2026-10-12.** Pure functions: extraction in, `check_results` out. No DB writes (Task 103's
worker persists). Quote verification per FB-40 / CONSTRAINT-35 (amended).

**Files:**
- `lib/extraction/render-pdf.ts` — modify. The same parse also returns each page's text layer
  (`getTextContent`), under the existing bounds and deadline
- `lib/extraction/extract.ts` — modify. `extractPo` returns `{ extracted, sourceText }`;
  `sourceText` is `string[]` (PDF pages, or `[body]` for text input) or `null` (image, or a PDF
  whose text layer is blank — a scan). **The text is never added to the model request.**
- `lib/checks/checks.constants.ts` — create. `MAX_QUOTE_CHARS`, `MAX_LINE_QUANTITY`,
  `MAX_UNIT_PRICE`, `MONEY_TOLERANCE_CENTS` (0)
- `lib/checks/types.ts` — create. `CheckName`, `CheckFailure { check, field, detail }`,
  `QuoteResult { field, status: 'verified' | 'not_found' | 'unverifiable' }`, `CheckResults`
- `lib/checks/quotes.ts`, `arithmetic.ts`, `dates.ts`, `fields.ts`, `run-checks.ts` — create
- `lib/checks/__tests__/*.test.ts` — create

**Output:** `check_results = { version: 1, failures: CheckFailure[], quotes: QuoteResult[] }` —
`failures` honours the Task 95 contract.

**Checks (each a `failures` entry):**
- **Quote:** `not_found`; or longer than `MAX_QUOTE_CHARS`. `unverifiable` is recorded in
  `quotes`, never a failure. Matching normalises case, whitespace and punctuation spacing; a
  token-order fallback tolerates table-column reordering — tuned on the 4 POs.
- **Arithmetic:** stated total ≠ Σ(qty × unit) over tote lines **to the cent** (the $7,800 vs
  $7,800.18 gap fails), unless `other` lines account for the delta exactly (pass, listed in
  `detail`); qty × unit ≠ line total; line total with no unit price that does not divide evenly
  by qty to the cent.
- **Dates:** ambiguous (both numeric components ≤ 12 and unequal) **unless another date on the
  same document proves the order** (a component > 12 fixes MM/DD vs DD/MM for the document);
  more than one `delivery` candidate.
- **Fields:** no PO number; no ship-to address; any `unknown` tote line; one tote type at two
  prices (`toOrderQuantities` conflicts); `isPurchaseOrder: false`; bounds (L-D) — quantity an
  integer > 0 and ≤ `MAX_LINE_QUANTITY`, unit price ≥ 0 and ≤ `MAX_UNIT_PRICE`; flagged, never
  clamped.

**Functions to implement:**
- `runChecks(extracted: ExtractedPo, sourceText: string[] | null): CheckResults`
- `verifyQuote(quote: string, sourceText: string[] | null): QuoteResult['status']`
- `checkArithmetic(extracted): CheckFailure[]`, `checkDates(extracted): CheckFailure[]`,
  `checkFields(extracted): CheckFailure[]`

**Evaluation — acceptance gate, outputs never committed:** run extraction + checks on the 4 real
POs via a scratchpad script. Every genuine quote `verified` — **zero false `not_found`**; a planted
invented value returns `not_found`; the Dakota-style gap is flagged. Builder confirms.

**Acceptance criteria:**
- [x] A test proves `sourceText` never appears in the OpenRouter request body
- [x] Image input → every quote `unverifiable`, no quote failures
- [x] Each check above has a passing and a failing test
- [x] Every number in the checks comes from `checks.constants.ts` (no magic numbers)
- [x] Quotes rendered nowhere as HTML (L-D) — checks store status, not markup
- [x] Evaluation passes on all 4 POs, confirmed by the builder
- [x] CQ-01/02; full suite green; `tsc` and `eslint` clean

**Tests required:** per check — happy and failing; `verifyQuote` → verified / not_found /
unverifiable / column-reordered match; `renderPdfPages` → synthetic PDF returns text per page,
blank-text PDF yields `null` upstream; `runChecks` → `failures` key always an array.

**Depends on:** Task 98 (done). Independent of 112/113.
**Status:** [x] Done (2026-10-12). `lib/checks/` (constants, types, fuzzy, quotes, arithmetic, dates, fields, run-checks); `renderPdfPages` now returns `{ images, text }` from the same parse; `extractPo` returns `{ extracted, sourceText }`. **Evaluation passed, builder confirmed:** live run on the 4 POs: 36/36 quotes `verified`, zero false `not_found`; a planted total is `not_found` on all 4; Dakota flagged. **Builder decision:** a total gap that `other` lines cover exactly is still a `total_mismatch` failure, with the covering lines named in `detail` (the spec contradicted itself). **Beyond the spec:** (1) all-letter quote tokens of 5+ characters may differ by one edit, because the model fixes misspellings when quoting ("Arlintgon", "VITON"); digits always exact; (2) `MAX_SOURCE_TEXT_CHARS` (30k): over it, quotes are `unverifiable` plus a `source_text_too_long` failure, which bounds the matcher; (3) a tote line with no quantity fails `quantity_out_of_bounds`; (4) the same delivery date printed twice is not flagged. **Known limit:** the token fallback does not require tokens to be adjacent. **Not built:** a check for a date read against the document's proven day/month order. Limits: `MAX_LINE_QUANTITY` 500, `MAX_UNIT_PRICE` $1,000, `MAX_QUOTE_CHARS` 600. Mutation-checked. Suite 1740 passed + 3 integration skipped; `tsc` and `eslint` clean.

---

## Task 102: Customer matcher — normalise + pg_trgm + address signal

**Planned 2026-10-12.** Builder decisions (2026-10-12): pre-fill on an exact normalised match
only; results live in `check_results.customerMatch`; the address signal boosts and surfaces but
never pre-fills alone; thresholds are tuned on a customer CSV the builder exports. Task 103's
worker calls the matcher and persists the result. This task writes no `inbound_pos` rows.
A-12 is resolved (`pg_trgm` 1.6 available, not installed).

**Files:**
- `db/migrations/0020_customer_matcher.sql` — create. `CREATE EXTENSION IF NOT EXISTS pg_trgm
  WITH SCHEMA extensions`; `public.normalise_company_name(text)` and
  `public.normalise_address(text)`, both `IMMUTABLE` with `SET search_path = ''`. No trigram
  index: at ~100 customers a sequential scan is trivial. The file records that reason.
- `db/migrations/__tests__/0020.test.ts` — create (assertions on the SQL file, following the 0016+ precedent)
- `db/queries/customer-match.ts` — create. One parameterised query
- `db/queries/__tests__/customer-match.integration.test.ts` — create (real pg_trgm on the local stack)
- `lib/matching/matching.constants.ts` — create. `NAME_SIMILARITY_MIN`, `ADDRESS_SIMILARITY_MIN`,
  `ADDRESS_BOOST`, `MAX_CUSTOMER_CANDIDATES`
- `lib/matching/types.ts`, `lib/matching/match-customer.ts` — create
- `lib/checks/types.ts` — modify. Add `no_customer_match` and `ambiguous_customer` to `CheckName`;
  add an optional `customerMatch?: CustomerMatch` to `CheckResults` (additive, so the version stays 1)
- `lib/matching/__tests__/match-customer.test.ts` — create

**Normalisation (SQL is the single source):** lowercase; `&` becomes `and`; strip punctuation;
collapse whitespace; drop trailing US suffixes (inc, llc, ltd, co, corp, corporation, company)
and a leading "the". Address: lowercase, strip punctuation, collapse whitespace, and unify
common abbreviations (street/st, road/rd, avenue/ave, suite/ste). The UK suffixes in A-12's
contingency (Ltd/PLC) were for the wrong market.

**Output:** `customerMatch = { prefillCustomerId: string | null, candidates: { customerId,
score, nameScore, addressMatched, status }[] }`. **IDs and numbers only, never names or
addresses** (SEC-05 / L-D).

**Functions to implement:**
- `findCustomerCandidates(name: string | null, shipTo: string | null): Promise<CandidateRow[]>`:
  customers with name similarity ≥ `NAME_SIMILARITY_MIN`, UNION any customer with a saved
  address at similarity ≥ `ADDRESS_SIMILARITY_MIN`. Returns the name score, the best address
  score and an exact-match flag.
- `matchCustomer(extracted: ExtractedPo): Promise<CustomerMatch>`: rank by nameScore, plus
  `ADDRESS_BOOST` when an address matched; cap at `MAX_CUSTOMER_CANDIDATES`.
- `customerMatchFailures(match: CustomerMatch): CheckFailure[]`: pure.

**Acceptance criteria:**
- [x] Exactly one customer's normalised name equals the PO's → `prefillCustomerId` set
- [x] Two customers share that normalised name → no pre-fill, `ambiguous_customer`
- [x] Fuzzy-only matches → ranked, `prefillCustomerId` null, `ambiguous_customer`
- [x] Address-only match → listed but never pre-filled, even when it is the only candidate
- [x] No candidates (or both name and ship-to null) → `no_customer_match`, empty list
- [x] Inactive customers are included and carry `status`
- [x] The query is parameterised; no SQL is built from strings (SEC: parameterised queries)
- [x] The migration is applied locally with `db:migrate-local` only. Prod gets it when the builder
      pastes it in. **Never `db:migrate`.**
- [x] Every threshold comes from `matching.constants.ts` (no magic numbers)
- [x] A DB failure throws with context (EH: loud) and never returns an empty match
- [x] CQ-01/02; full suite green; `tsc` and `eslint` clean
- [x] Evaluation passes, confirmed by the builder (below)

**Evaluation — acceptance gate, outputs never committed:** the builder exports `company_name`
and addresses from prod to a CSV in the scratchpad. A script loads it into the local DB and runs
the 4 sample POs' `customerName` / `shipToAddress` through `matchCustomer`. Pass: each PO's true
customer is either pre-filled or ranked #1, and no wrong customer is ever pre-filled. Thresholds
are adjusted in the constants file only.

**Tests required:** normalisation (suffixes, `&`, punctuation, a leading "The") in the
integration test; a passing and a failing test for each criterion above; a DB error throws with
context; `customerMatchFailures` covers each failure kind.

**Risks:** the evaluation takes prod customer data to local disk (scratchpad only, never
committed). Migration 0020 must be pasted into prod before Task 104 goes live. A customer renamed
or deleted after matching leaves a stored ID that is stale or missing, and Task 107 must handle it.

**Depends on:** Task 101 (done). Feeds Task 103 (which calls it), Task 107 (which renders the
candidates) and Task 113 (whose aliases feed `findCustomerCandidates`).
**Specialist:** @db
**Status:** [x] Done (2026-10-12). Migration 0020 (pg_trgm in `extensions`, two IMMUTABLE normalisers with `search_path=''`, EXECUTE revoked from the API roles) is applied locally; **pasted into prod by the builder 2026-10-12.** `db/queries/customer-match.ts` and `lib/matching/` are in; `lib/checks/types.ts` gains `no_customer_match`, `ambiguous_customer` and an optional `customerMatch`. **Evaluation passed, builder confirmed:** on a 100-row prod export (local only, gitignored as `docs/*.csv`), Mansfield, BASCO and Dakota are pre-filled correctly, and Rhenium is ranked #1 without a pre-fill. **Changes from the evaluation (builder-approved):** (1) periods and apostrophes are deleted, not turned into spaces, so "L.L.C." is stripped (a bug); (2) `nf` counts as a suffix, because "(NF)" is the salesperson's own tag; (3) a new list-only signal, `NAME_IN_ADDRESS_SIMILARITY_MIN` (0.8), uses pg_trgm `word_similarity` to find the PO name inside saved addresses. Saved addresses open with the legal name while `company_name` holds a nickname ("Delta Energy/Rhenium"), so this signal never pre-fills. Also beyond the spec: address normalisation unifies drive, boulevard, highway and parkway. Mutation-checked the pre-fill rule and the address boost. Suite 1767 passed; integration passes on the local stack; `tsc` and `eslint` clean.

---

## Task 103: Worker foundations — body text, lease column, storage module, failed rows visible

**Planned 2026-10-12 (@cto FB-42, CONSTRAINT-38).** The original Task 103 ("drain, self-chain,
retry") is split into three: **103** (data and access, this task), **115** (worker core) and
**116** (route and self-chain). This keeps each piece testable on its own and within CQ-02.
This task adds data and access only; no extraction runs yet.

**Files:**
- `db/migrations/0021_worker_foundations.sql` + `db/migrations/__tests__/0021.test.ts` — create.
  `inbound_pos.body_text text NULL` plus CHECK `(body_text IS NULL OR source_kind = 'email_body')`;
  `inbound_pos.extraction_started_at timestamptz NULL`. Re-runnable (IF NOT EXISTS, guarded CHECK).
- `db/schema/inbound.ts` — modify (two columns)
- `lib/ingest/candidates.ts`, `lib/ingest/pipeline.ts`, `db/queries/inbound-pos.ts` — modify. A body
  candidate carries its normalised text; `poRow` writes `body_text`; attachment and refusal rows
  write NULL. The body is stored in full and never truncated (`extractPo` refuses an over-cap
  body loudly, M-05).
- `db/queries/inbound-pos.ts` — modify. The queue list and count include `extraction_failed`
  alongside `pending_review` (PRD: a failed PO appears in the queue, usable as manual entry).
- `lib/storage/po-documents.ts` — create. `uploadPoDocument(path, bytes, contentType)` and
  `downloadPoDocument(path): Promise<Buffer>`. It reads `SUPABASE_SECRET_KEY` and is the only
  file that may; the bucket is pinned to `PO_DOCUMENTS_BUCKET`; uploads use `upsert: true`,
  which closes MEDIUM-06 early.
- `lib/storage/errors.ts` — create. `StorageConfigError`, `PoDocumentStorageError`
- `.env.example` — add `SUPABASE_SECRET_KEY` and `INGEST_TRIGGER_SECRET` with placeholder values

**Acceptance criteria:**
- [x] A body PO staged locally has `body_text` equal to the normalised body; attachment rows have NULL
- [x] The CHECK rejects `body_text` on a `pdf` row (integration test)
- [x] `extraction_failed` rows appear in `listPendingReview` and `countPendingReview`
- [x] Storage module: upload then download round-trips the bytes on the local stack; a second
      upload to the same path succeeds (MEDIUM-06); a missing key throws `StorageConfigError`
- [x] A test asserts that no other source file references `SUPABASE_SECRET_KEY` (CONSTRAINT-38)
- [x] Errors name the path only, never document content (SEC-05)
- [x] Applied locally with `db:migrate-local`; the builder pastes it into prod before Task 104.
      **Never `db:migrate`.**
- [x] CQ-01/02; full suite green; `tsc` and `eslint` clean

**Tests required:** a migration-file test; a body-candidate unit test; queue inclusion (the
compiled SQL lists both statuses); storage happy, missing-key and failure paths (unit, mocked
client) plus an integration round-trip; the CONSTRAINT-38 grep test.

**Depends on:** Task 102 (done).
**Specialist:** @db
**Status:** [x] Done (2026-10-12). Migration 0021 applied locally with `db:migrate-local` and re-run clean (re-runnable); **pasted into prod by the builder 2026-10-12.** `@security` CLEAR (LOW-T103-1 to -3; MEDIUM-06 closes when Task 104 wires `uploadPoDocument`). `body_text` flows candidate → `StagedCandidate` → `poRow`; `InsertInboundPoInput.body_text` is **required** (`string | null`) so no writer can omit it. Queue reads `status IN (pending_review, extraction_failed)` from one constant. `lib/storage/po-documents.ts` builds a fresh session-less client per call (no cached client to outlive a rotated key). CONSTRAINT-38 grep test walks every non-test source file; mutation-checked (a planted reader fails it). Local `.env` gained the local stack's `SUPABASE_SECRET_KEY`. Suite 1784 passed; integration 16/16 incl. the storage round-trip and the CHECK (SQLSTATE 23514); `tsc` and `eslint` clean.

---

## Task 115: Worker core — claim, extract, check, match, persist

**Planned 2026-10-12 (FB-42).** Meets M-04 sign-off conditions 1 and 2 (condition 4 accepted by the
builder: no `worker_thread`) and the L-A logging rule moved here from Task 98.

**Files:**
- `db/queries/extraction-queue.ts` — create:
  - `claimBatch(limit, leaseMs, now)`: one UPDATE with `FOR UPDATE SKIP LOCKED` that sets
    `extracting`, `attempt_count + 1` and `extraction_started_at`. It claims `pending_extraction`
    rows and `extracting` rows whose lease has expired.
  - `completeExtraction(id, extracted, checkResults)` → `pending_review`
  - `failExtraction(id, checkResults)` → `extraction_failed`
  - `releaseForRetry(id)` → `pending_extraction`
- `lib/ingest/worker.ts` — create. `drainExtractionBatch(deps): Promise<BatchSummary>`
- `lib/ingest/worker-errors.ts` — create. `isPermanentExtractionError(error)`
- `lib/ingest/ingest.constants.ts` — add `EXTRACTION_LEASE_MS` (5 minutes; must exceed the route's `maxDuration`)
- `lib/checks/types.ts` — add the `extraction_failed` CheckName

**Behaviour for each claimed row:**
1. `attempt_count` (already incremented) above `MAX_EXTRACTION_ATTEMPTS` → `failExtraction`
   without rendering. This is M-04 condition 2: a row that keeps killing the function ends visible.
2. Load the input: `pdf` / `image` → `downloadPoDocument`; `email_body` → `body_text`
3. `extractPo` → `runChecks` → `matchCustomer` → `completeExtraction`, writing
   `{ ...checks, failures: [...checks.failures, ...customerMatchFailures(match)], customerMatch }`
4. A permanent error (`TextInputTooLongError`, `PdfTooManyPagesError`, `PdfPageTooLargeError`,
   `ExtractionResponseError`) → `failExtraction` immediately. A transient one (HTTP, timeout,
   render timeout, storage, DB) → `releaseForRetry`, until attempts run out and it becomes
   `failExtraction`.
5. The failure entry is `{ check: 'extraction_failed', field: 'document', detail: <error class name> }`
6. One row's failure never stops the batch. `ExtractionConfigError` does stop it, loudly:
   nothing in the batch could succeed.

**Acceptance criteria:**
- [ ] Two concurrent `claimBatch` calls never return the same row (integration test)
- [ ] The attempt is counted at claim time, before any render (M-04 condition 1)
- [ ] Lease: a row stuck at `extracting` past `EXTRACTION_LEASE_MS` is reclaimed; one inside the lease is not
- [ ] Each branch above is tested; a planted permanent error ends `extraction_failed` in one run
- [ ] Logs carry model, status, page count, duration and row id only. A test asserts that no
      extracted value, quote, body text or `sourceText` reaches `console.*` (L-A, SEC-05)
- [ ] `sourceText` is never persisted (MEDIUM-07 precondition), asserted on the written row
- [ ] Every number comes from constants; CQ-01/02; full suite green; `tsc` and `eslint` clean

**Tests required:** a happy path and the error case for each function; the integration tests
for claim and lease on the local stack; the worker with injected deps (download, `extractPo`, matcher).

**Depends on:** Task 103.
**Specialist:** @db
**Status:** [ ]

---

## Task 116: Worker route — secret, after(), self-chain

**Planned 2026-10-12 (FB-42).** Meets M-04 sign-off condition 3 and A-11 (self-chaining).
Task 104 reuses `isAuthorisedTrigger`.

**Files:**
- `app/api/ingest/extract/route.ts` — create. `POST`:
  - a constant-time compare of `Authorization: Bearer <INGEST_TRIGGER_SECRET>`, otherwise 401
  - respond 202, and run the batch in `after()`
  - if rows remain, `fetch` its own origin once (A-11)
  - `export const maxDuration = 60` (M-04 condition 3)
- `lib/ingest/trigger-auth.ts` — create. `isAuthorisedTrigger(request, secret)`
- `next.config.js` — `serverExternalPackages: ['pdfjs-dist', '@napi-rs/canvas']` (A-14)

**Acceptance criteria:**
- [ ] A missing or wrong secret → 401 with no DB access; an unset env secret → 500, logged, never "open"
- [ ] A valid request → 202 immediately; the batch runs after the response (tested with `after` mocked)
- [ ] The self-chain fires only when `drainExtractionBatch` reports rows remaining, and at most once
- [ ] No `'use server'`; the secret is never logged (SEC-01/05)
- [ ] The `proxy.ts` matcher does not block the route (no session required), tested
- [ ] Local end-to-end: stage a PDF and POST the route; the row reaches `pending_review` with
      `extracted` and `check_results.customerMatch`. Manual check in Studio, confirmed by the builder.
- [ ] CQ-01/02; full suite green; `tsc` and `eslint` clean

**Tests required:** auth helper (match, mismatch, length mismatch, unset); route 401 / 500 / 202;
self-chain on and off.

**Risks:** A-11 (Vercel may drop the self-fetch; fallback is an external 5-minute cron). Vercel
deployment protection blocks self-fetch on previews only; check at Task 104.

**Depends on:** Task 115.
**Status:** [ ]
