# Plan: ToteTrack

**Date:** 2026-04-20
**Status:** Approved — Phase 3 complete
**Approved by:** Builder (2026-04-20)
**Total tasks:** 30 (single file — at threshold)

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
