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

## Task 19: PO document upload (Supabase Storage)

**Status:** ~~DEFERRED~~ — permanently out of scope (builder decision 2026-04-22).

**Why:** Originally replaced by Task 33 (Claude vision extraction). Task 33 was subsequently cut because it requires a paid Anthropic API, which conflicts with CONSTRAINT-07 ($0 hosting — Vercel free + Supabase free tiers only). Upload-without-extraction provides no real value on its own (the salesperson would still re-type every field from the PDF), so both Task 19 and Task 33 are out of scope.

**Residual state:** The storage bucket (`po-documents`) and `orders.document_url` column already exist in the DB (Task 3) and stay in place — they're cheap and a future feature may use them. The `PODocumentUpload` placeholder slot in `OrderDetail.tsx` (Task 16 `[~]`) is now a **permanent labeled placeholder** — it will not be replaced by a real component in the v1 scope.

---

## Task 33: PO document extraction + form pre-fill (Claude vision)

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

## Task 34: Remove top bar; ship pill hamburger on authenticated routes

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
