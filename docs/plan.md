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

## Task 52: Calendar server actions

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
- [ ] Every action calls `assertAuthenticated()` first and returns the auth error unchanged
- [ ] Every action validates `id` with `UUID_RE` before any DB access
- [ ] `productionDate` validated against `ISO_DATE_RE` **and** rejected when it falls on a Saturday or Sunday — the no-weekend invariant is enforced server-side, not merely by the absence of weekend columns
- [ ] `cancelled` orders rejected with a clear message; `completed`/`invoiced` also rejected for placement changes, since those cards are not draggable
- [ ] No action writes `requested_delivery_date` on any code path
- [ ] All three call `revalidatePath('/calendar')` and `revalidatePath('/dashboard')` on success (CONSTRAINT-02 — no optimistic-only state)
- [ ] Failures log with context via `console.error` and return `GENERIC_FAILURE_MESSAGE` — never swallowed
- [ ] `lib/actions/calendar.ts` exports async functions only

**Tests required:**
- `lib/actions/__tests__/calendar.test.ts` → `setProductionPlacement writes production_date and sort index` → `expect payload to contain both and NOT requested_delivery_date`
- `lib/actions/__tests__/calendar.test.ts` → `setProductionPlacement rejects a Saturday date` → `expect error`
- `lib/actions/__tests__/calendar.test.ts` → `setProductionPlacement rejects a cancelled order` → `expect error`
- `lib/actions/__tests__/calendar.test.ts` → `clearProductionPlacement nulls both columns` → `expect both set to null`
- `lib/actions/__tests__/calendar.test.ts` → `toggleSameDayDelivery persists the boolean` → `expect update payload`
- `lib/actions/__tests__/calendar.test.ts` → `unauthenticated calls are rejected before any DB access` → `expect auth error, db not called`

**Depends on:** Task 49, Task 50
**Specialist:** @db

**Status:** [ ]

---

## Task 53: Nav entry + `/calendar` route

> Added 2026-07-26 via `@create-plan`. Source: `docs/prd.md` Feature 11 (D16 / CONSTRAINT-19).

**Files:**
- `components/shell/NavDrawer.tsx` — modify
- `app/(app)/calendar/page.tsx` — create
- `components/shell/__tests__/NavDrawer.test.tsx` — modify

**Functions to implement:**
- Add `{ label: 'Calendar', href: '/calendar', icon: CalendarDays }` to `NAV_ITEMS`, between Orders and Leads (7 items total)
- `CalendarPage({ searchParams }: { searchParams: { week?: string } })` — async server component. Parses an optional `?week=YYYY-MM-DD` (validated with `ISO_DATE_RE`, ignored when malformed), computes the fetch range as `CALENDAR_WEEKS_BUFFER` weeks either side, fetches `getCalendarOrders` + `getUnscheduledOrders` in `Promise.all`, returns `<PageTransition><CalendarLayout … /></PageTransition>`

**Acceptance criteria:**
- [ ] Nav drawer shows 7 items with Calendar between Orders and Leads
- [ ] Active state highlights on `/calendar` via the existing `pathname === href || pathname.startsWith(href + '/')` rule
- [ ] Page is a server component — no `'use client'`, no `@dnd-kit` or `framer-motion` import (CONSTRAINT-03)
- [ ] Auth guard and `dynamic = 'force-dynamic'` inherited from `app/(app)/layout.tsx`; the page does not redeclare them
- [ ] Malformed `?week=` is ignored and the page falls back to the current business week rather than erroring
- [ ] Data fetched server-side and passed as props — no client-side fetching

**Tests required:**
- `components/shell/__tests__/NavDrawer.test.tsx` → `renders the Calendar nav item between Orders and Leads` → `expect 7 items in order`
- `components/shell/__tests__/NavDrawer.test.tsx` → `marks Calendar active on /calendar` → `expect active styling`

**Depends on:** Task 51
**Specialist:** @ui-totetrack

**Status:** [ ]

---

## Task 54: `ProductionCard` component

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
- [ ] Card height driven by `--card-h`, identical for every card regardless of content
- [ ] Customer name always reserves exactly 2 lines and truncates past that; mix always reserves exactly 2 lines
- [ ] `--card-h: clamp(80px, calc(25vh - 70px), 104px)`; padding, the 4 row heights and their font sizes interpolate off it so the rows always sum to `--card-h`
- [ ] 5th and 6th combos collapse to `+N more`; a 6-combo order shows 4 combos and `+2 more`
- [ ] Null `requested_delivery_date` renders `—`, matching every other PO list surface
- [ ] Delivery date formatted with `format(parseISO(d), 'MMM d')` → `Jul 31`
- [ ] `completed` / `invoiced` rows render dimmed and expose no drag affordance
- [ ] Prices never appear on the card
- [ ] `BackhaulTag` reused unchanged, not reimplemented
- [ ] Component file under 200 lines (CQ) — formatting logic lives in `productionCardFormat.ts`

**Tests required:**
- `components/calendar/__tests__/ProductionCard.test.tsx` → `renders up to 4 combos then +N more` → `expect "+2 more" for a 6-combo order`
- `components/calendar/__tests__/ProductionCard.test.tsx` → `renders em dash when delivery date is null` → `expect —`
- `components/calendar/__tests__/ProductionCard.test.tsx` → `renders B and SD tags together` → `expect both present`
- `components/calendar/__tests__/ProductionCard.test.tsx` → `built cards are dimmed and not draggable` → `expect no drag handle attrs`

**Depends on:** Task 50
**Specialist:** @ui-totetrack

**Status:** [ ]

---

## Task 55: `CalendarLayout` + `DayColumn` — viewport-locked week strip

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
- [ ] Root is `h-[calc(100vh-0.75rem)]` with `overflow-hidden` — the page never scrolls as a page at 1440×900, 1280×720, 1024×768 or 1280×620
- [ ] Column width 176px so 5 columns + gaps + the 80px pill gutter + 16px fit within 1024px
- [ ] Column height derives from the viewport through a flex chain with `min-h-0`, never a hardcoded pixel height
- [ ] 4 whole cards visible without scrolling at every viewport height down to 600px
- [ ] Below 600px viewport height the card holds its 80px floor and the column scrolls instead
- [ ] Both the horizontal strip and each column render a visible scrollbar — overlay scrollbars explicitly styled against
- [ ] Opens scrolled to the current business week; on Sat/Sun that is the *following* Mon–Fri
- [ ] `Current week` returns to that week; respects `useReducedMotion()` by jumping instead of smooth-scrolling
- [ ] Day header shows weekday and date only — no order count
- [ ] Today's column header filled `bg-primary` with `text-primary-foreground`
- [ ] Past days render identically to future days
- [ ] Empty day shows `Nothing scheduled.` in the existing empty-state style
- [ ] `+ Add order` sits in the column footer, hidden on hover-capable fine-pointer devices only and permanently visible otherwise (`@media (hover: hover) and (pointer: fine)`)
- [ ] Every interactive element ≥44px (iPad touch standard)
- [ ] Each component file under 200 lines (CQ)

**Tests required:**
- `components/calendar/__tests__/CalendarLayout.test.tsx` → `renders five weekday columns per week` → `expect Mon–Fri only, no Sat/Sun`
- `components/calendar/__tests__/CalendarLayout.test.tsx` → `opens on the current business week` → `expect current Monday's group in view`
- `components/calendar/__tests__/CalendarLayout.test.tsx` → `weekend visit targets the following Monday` → `expect next Mon–Fri`
- `components/calendar/__tests__/CalendarLayout.test.tsx` → `empty day renders the empty state` → `expect "Nothing scheduled."`

**Depends on:** Task 54
**Specialist:** @ui-totetrack

**Status:** [ ]

---

## Task 56: `@dnd-kit` wiring — drag between days, reorder, edge auto-scroll

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
- [ ] `@dnd-kit/core` and `@dnd-kit/sortable` added to `package.json`; both are client-only and every file importing them carries `'use client'` (CONSTRAINT-03)
- [ ] Dragging a card to another day calls `setProductionPlacement` with the new date and released index
- [ ] Dragging within a day persists the new sequence, and the order survives a reload
- [ ] Cards land at the exact index released — never appended to the end
- [ ] Holding a dragged card near either edge auto-scrolls the strip, allowing a drop into a different week without releasing
- [ ] `completed` / `invoiced` cards are not draggable
- [ ] Nothing can be dropped on a non-weekday — no weekend drop target exists
- [ ] A tap (movement below the 6px threshold) opens the popup instead of starting a drag
- [ ] On touch, a swipe scrolls the calendar and only a long-press starts a drag
- [ ] Keyboard drag works via `KeyboardSensor` with visible focus
- [ ] `useReducedMotion()` respected — no drop animation when set
- [ ] A failed mutation surfaces a toast and the card returns to its original position — never a silent revert

**Tests required:**
- `components/calendar/__tests__/CalendarDnd.test.tsx` → `drop on another day calls setProductionPlacement with that date` → `expect action called with new date and index`
- `components/calendar/__tests__/CalendarDnd.test.tsx` → `drop at origin does not call the action` → `expect action not called`
- `components/calendar/__tests__/CalendarDnd.test.tsx` → `built cards expose no drag listeners` → `expect disabled sortable`
- `components/calendar/__tests__/CalendarDnd.test.tsx` → `failed placement shows a toast and reverts` → `expect toast and original position`

**Depends on:** Task 52, Task 55
**Specialist:** @ui-totetrack

**Status:** [ ]

---

## Task 57: `UnscheduledCallout` + dropdown drop target

> Added 2026-07-26 via `@create-plan`. Source: `docs/prd.md` Feature 11 (D16 / CONSTRAINT-19).

**Files:**
- `components/calendar/UnscheduledCallout.tsx` — create
- `components/calendar/AddOrderMenu.tsx` — create
- `components/calendar/__tests__/UnscheduledCallout.test.tsx` — create

**Functions to implement:**
- `UnscheduledCallout({ rows, onPlace, onClear })` — `'use client'`. Amber pill (`bg-amber-100 text-amber-800`, `rounded-full`, `min-h-[44px]`) showing the count plus "need a production date". Opens a dropdown of `ProductionCard`s, 4 visible then scroll. Registers as a `@dnd-kit` droppable so a card dragged onto it calls `clearProductionPlacement`.
- `AddOrderMenu({ date, rows, onPick })` — the per-day `+ Add order` list, rendering the same unscheduled set.

**Acceptance criteria:**
- [ ] Count equals `getUnscheduledOrders().length` and decrements when an order is placed
- [ ] Dropdown shows exactly 4 cards before scrolling (`UNSCHEDULED_DROPDOWN_VISIBLE`)
- [ ] Dragging a card out of the dropdown onto a day sets its `production_date`
- [ ] Dragging a card from the calendar onto the callout calls `clearProductionPlacement`
- [ ] The dropdown auto-opens when a card is dragged over the collapsed pill, so the drop target is reachable
- [ ] Per-day `+ Add order` lists exactly the same set as the callout
- [ ] Zero unscheduled orders renders an empty state rather than a bare `0` pill
- [ ] Callout keyboard reachable, `aria-expanded` reflects state, trigger ≥44px
- [ ] A dated order dropped on the callout visibly returns to its default day — expected per CONSTRAINT-19, not treated as a failure

**Tests required:**
- `components/calendar/__tests__/UnscheduledCallout.test.tsx` → `shows the unscheduled count` → `expect count text`
- `components/calendar/__tests__/UnscheduledCallout.test.tsx` → `drop on the callout clears the production date` → `expect clearProductionPlacement called`
- `components/calendar/__tests__/UnscheduledCallout.test.tsx` → `renders empty state when nothing is unscheduled` → `expect empty copy, no pill count`

**Depends on:** Task 51, Task 56
**Specialist:** @ui-totetrack

**Status:** [ ]

---

## Task 58: `ProductionCardDialog` — read-only popup

> Added 2026-07-26 via `@create-plan`. Source: `docs/prd.md` Feature 11 (D16 / CONSTRAINT-19).

**Files:**
- `components/calendar/ProductionCardDialog.tsx` — create
- `components/calendar/__tests__/ProductionCardDialog.test.tsx` — create

**Functions to implement:**
- `ProductionCardDialog({ open, row, onClose, onToggleSameDay, onRemove })` — `'use client'`. Reuses the `CancelOrderDialog` shell exactly: `fixed inset-0 z-50 bg-black/40` backdrop, `bg-card rounded-xl shadow-lg max-w-md w-full p-6 space-y-4` panel, `modalVariants` from `lib/animations`, Escape-to-close, backdrop-click-to-close.
- Body: PO number + `OrderStatusBadge`, same-day toggle row, customer, `<QtyGrid mode="display" values={…} unitPrices={…} />`, derived total, production date, requested delivery date, backhaul, notes.
- Footer: `Remove from calendar` (ghost) + `Open in Orders` (primary) linking to `/orders?id=[uuid]`.

**Acceptance criteria:**
- [ ] Reuses `QtyGrid` display mode with `unitPrices` so filled cells render `qty / $unit`, matching PO detail since Feature 10
- [ ] Orders with NULL unit prices (legacy multi-combo, e.g. `MAn00003239`) fall back to bare quantities without crashing or rendering `$null`
- [ ] Total shows the derived `price`, formatted with the shared currency formatter
- [ ] Same-day toggle is the **only** writable control; it calls `toggleSameDayDelivery` and the card's `SD` tag updates
- [ ] No control on the dialog can edit any other order field
- [ ] `Remove from calendar` calls `clearProductionPlacement` and closes the dialog
- [ ] `Open in Orders` navigates to `/orders?id=[uuid]`
- [ ] Escape and backdrop click close; focus trapped while open and restored to the card on close
- [ ] Respects `useReducedMotion()` via the shared `modalVariants`
- [ ] File under 200 lines (CQ) — split a `ProductionCardDialogParts.tsx` if not

**Tests required:**
- `components/calendar/__tests__/ProductionCardDialog.test.tsx` → `renders qty / $unit for priced cells` → `expect formatted string`
- `components/calendar/__tests__/ProductionCardDialog.test.tsx` → `falls back to bare quantities when unit prices are null` → `expect no $ rendered, no crash`
- `components/calendar/__tests__/ProductionCardDialog.test.tsx` → `same-day toggle calls the action` → `expect toggleSameDayDelivery called with next value`
- `components/calendar/__tests__/ProductionCardDialog.test.tsx` → `remove calls clearProductionPlacement and closes` → `expect action called and onClose fired`

**Depends on:** Task 52, Task 54
**Specialist:** @ui-totetrack

**Status:** [ ]

---

## Task 59: Dashboard Production widget

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
- [ ] Shows the next 2 **business** days — on Friday that is Fri + Mon; on Sat/Sun it is Mon + Tue
- [ ] Group labels read `Today` / `Tomorrow` only when literally true, otherwise the real weekday and date
- [ ] Up to 3 rows per group, remainder shown as `+ N more`
- [ ] `B` and `SD` tags sit immediately **after the customer name**, mirroring how Open Orders places them after the PO number
- [ ] Footer shows the unscheduled count as an amber pill and a `View calendar` link to `/calendar`
- [ ] Empty day renders an empty state, not a blank group
- [ ] Rows ≥44px and link to `/orders?id=[uuid]` consistent with the other widgets
- [ ] Header, divider and footer treatment match the other dashboard widgets exactly

**Tests required:**
- `components/dashboard/__tests__/ProductionWidget.test.tsx` → `renders two business-day groups` → `expect 2 group headings`
- `components/dashboard/__tests__/ProductionWidget.test.tsx` → `on Friday the second group is Monday` → `expect Mon label`
- `components/dashboard/__tests__/ProductionWidget.test.tsx` → `caps at 3 rows and shows the remainder` → `expect "+2 more"`
- `components/dashboard/__tests__/ProductionWidget.test.tsx` → `shows the unscheduled count` → `expect amber pill text`

**Depends on:** Task 51
**Specialist:** @ui-totetrack

**Status:** [ ]

---

## Task 60: Documentation sync

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
- [ ] Stack table lists `@dnd-kit` with its role
- [ ] `founder-brief.md` gains FB-11 covering the `@dnd-kit` addition — `architecture.md` must not ship changed without it
- [ ] Component boundary rule names all three client-only libraries, so no future task imports `@dnd-kit` into a server component
- [ ] CONSTRAINT-03 and the architecture boundary rule agree word for word on the library list
- [ ] `data-model.md` documents `production_date`, `same_day_delivery`, `production_sort_index` with nullability and defaults
- [ ] No doc still refers to the Production Calendar as "Feature 10" or to migration `0009`

**Tests required:**
- None — documentation only. Verified by review against the shipped code.

**Depends on:** Tasks 49–59

**Status:** [ ]
