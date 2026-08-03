# Architecture: ToteTrack

**Date:** 2026-04-20
**Status:** Approved — Phase 2 complete
**Approved by:** Builder (2026-04-20)

> See `docs/data-model.md` for complete entity definitions.
> See `docs/api-spec.md` for all operation signatures.
> See `docs/founder-brief.md` for rationale behind each significant decision.

---

## Stack

| Layer | Technology | Version target |
|-------|-----------|---------------|
| Framework | Next.js App Router | 14+ |
| Database | Supabase (PostgreSQL) | Free tier |
| Auth | Supabase Auth | Free tier |
| File storage | Supabase Storage | Free tier (1GB) |
| ORM | Drizzle ORM | Latest |
| UI components | shadcn/ui + Tailwind CSS | Latest |
| Animation | Framer Motion | Latest |
| Charts | Recharts | Latest |
| Drag and drop | @dnd-kit/core + @dnd-kit/sortable | Latest |
| Forms | react-hook-form + Zod | Latest |
| Hosting | Vercel | Free tier |

---

## Data Model

9 entity types with relationships → full spec in `docs/data-model.md`.

**Entity overview:**

| Entity | Purpose |
|--------|---------|
| `customers` | Customer companies. `default_delivery_address` is DEPRECATED (Feature 14, 2026-07-28) — column retained in DB, unused by app code; drop deferred |
| `customer_addresses` | Saved delivery addresses per customer (Feature 14, migrations 0012/0013) — MRU via `last_used_at`, `UNIQUE (customer_id, address)`; orders still store `delivery_address` as a text snapshot |
| `customer_contacts` | Individual contacts per customer (1+ per customer); email + phone both optional |
| `orders` | Purchase orders; `requested_delivery_date` is nullable. Also carries the production-calendar columns `production_date` / `same_day_delivery` / `production_sort_index` (migration `0010`) |
| `leads` | Prospective customers; email + phone both optional |
| `lead_notes` | Append-only note log per lead |
| `invoices` | Month-level invoices (v3 — no customer association, no status) |
| `support_tickets` | Bug/feature requests from salesperson to developer |
| `support_attachments` | File attachments per support ticket |

**PO state machine (CONSTRAINT-15 + CONSTRAINT-16):**
```
[New] → scheduled → completed → (auto on invoice) invoiced
              ↑   ↘ cancelled
              ↑     ↑
              └─────┘  (revertOrderToScheduled — terminal → scheduled, FB-08)
```
- `pending` value dropped from the `po_status` enum
- `invoiced` is a sub-state of "delivered" — every stats/aggregation query (volume averages, last-sale date, contact frequency, completed-order count) matches `status IN ('completed', 'invoiced')`
- `getInvoiceableOrders` stays strict: `status = 'completed' AND invoice_id IS NULL`
- Mark Complete on an undated order auto-sets `requested_delivery_date` to `CURRENT_DATE` via `COALESCE` (CONSTRAINT-16)

**Production date vs delivery promise (CONSTRAINT-19, FB-11):**
- `production_date` is the build day and is **separate** from `requested_delivery_date`, the customer-facing promise. Calendar code reads and writes only the production columns — it must never write the delivery date.
- **A PO's calendar position IS its `production_date`** — nothing is derived at read time (revised 2026-07-27, migration `0011`). `production_date IS NULL` means unscheduled, and the order sits in the callout whatever its delivery date. The delivery date seeds the column **once**, at creation, via `defaultProductionDate` in `lib/actions/orders.internal.ts` — the only caller of `prevBusinessDay`. The former two-implementation rule (`effectiveProductionDate` + `EFFECTIVE_PRODUCTION_DATE`) was **deleted**, and with it the risk of a card being filtered into one column and drawn in another.
- `prevBusinessDay` is weekends-only — no holiday calendar exists or is planned. Mon, Sat and Sun delivery dates all resolve to the prior Friday.
- The no-weekend invariant is enforced **on write** (the Task 52 server actions reject a Saturday/Sunday `production_date`), never on read. Read paths pass a stored `production_date` through verbatim rather than silently relocating it.

**Invoice model v3 (CONSTRAINT-17, FB-07):**
- One invoice per calendar month covers every customer's eligible POs
- `customer_id` and `status` columns dropped (migration `0007`)
- Existing-month invoice triggers an Overwrite confirmation; confirming detaches old orders + deletes the old invoice + creates a fresh INV-####
- Customer column lives on each PO row in the detail view, not on the invoice itself

---

## API Structure

**Pattern:** Next.js Server Actions for all mutations. Server Components for all data fetching. No separate REST API layer.

> **Revalidation is multi-surface as of Feature 12.** An order write is no longer the Orders tab's business alone — the same row is drawn by `/calendar` and by the dashboard production widget. `createOrder`, `updateOrder`, `updateOrderStatus` and `revertOrderToScheduled` therefore revalidate `/orders`, `/calendar` **and** `/dashboard` via named path constants. None of them did before Feature 12, which meant a cancelled order stayed visible on the calendar until a hard reload; `updateOrder` joined the set in the 2026-07-27 code-review fix pass — an edit can change backhaul, the delivery date, or the quantity mix, all drawn on calendar cards. Use `/dashboard`, never `/` — `app/page.tsx` is a bare `redirect('/dashboard')`, so revalidating `/` is a no-op.

- **Server Components** (in `app/(app)/[screen]/page.tsx`): fetch data server-side, pass as props to client components. Faster first paint; no client-side loading states for initial render.
- **Server Actions** (in `lib/actions/[domain].ts`): handle all create/update/delete operations. Called from client components via event handlers. Type-safe. No HTTP boilerplate.
- **Queries** (in `db/queries/[domain].ts`): read-only DB functions, called from server components or server actions.

38 total operations → full spec in `docs/api-spec.md`.

---

## Component Architecture

### Routing Structure

```
app/
  (auth)/
    login/
      page.tsx              ← server component — renders LoginForm
  (app)/
    layout.tsx              ← server component — session guard, renders AppShell
    dashboard/
      page.tsx              ← server component — fetches stats, passes to DashboardView
    customers/
      page.tsx              ← server component — fetches customer list
    orders/
      page.tsx              ← server component — fetches order list
    calendar/
      page.tsx              ← server component — parses ?week=, fetches calendar + unscheduled rows (Feature 11)
    leads/
      page.tsx              ← server component — fetches lead list
    invoices/
      page.tsx              ← server component — fetches initial invoice data
    support/
      page.tsx              ← server component — fetches tickets
```

**URL pattern for detail selection:** `?id=[uuid]` query param on list pages (e.g., `/customers?id=abc123`). Server component reads this param and fetches detail data server-side.

### Component Tree

```
components/
  auth/
    LoginForm.tsx           ← 'use client'
  shell/
    AppShell.tsx            ← 'use client' — owns drawer state; mounts PillHamburger + NavDrawer; wraps children in DrawerStateProvider so descendants can read drawer-open state without prop drilling
    PillHamburger.tsx       ← 'use client' — sole chrome element on authenticated routes; 44×44 white pill, fixed top-left at top-6 left-6 (FB-09)
    NavDrawer.tsx           ← 'use client' — Framer Motion slide-over (left); 6 nav items + Sign Out at bottom (FB-09)
    drawer-state.tsx        ← 'use client' — Context provider + useAppShellDrawerState hook (shared signal for components like QuickAddFab that need to react to drawer open/close) (FB-09)
    DetailDrawer.tsx        ← 'use client' — CSS-only responsive right-panel wrapper (FB-06). Optional `alwaysOverlay` (Feature 12) keeps the fixed-overlay classes at every breakpoint instead of docking inline at `lg:` — required by `/calendar`, whose root is `overflow-hidden` and must never scroll as a page (CONSTRAINT-19). Default is unchanged, so Orders/Customers/Leads/Invoices keep docking
    PageTransition.tsx      ← 'use client' — Framer Motion page fade
    ToastProvider.tsx       ← 'use client' — toast queue management
  dashboard/
    DashboardView.tsx       ← 'use client' — period toggle state; mounts QuickAddFab
    QuickAddFab.tsx         ← 'use client' — speed-dial FAB (Purchase Order / Customer / Lead options), navigates to destination with ?new=1 deep link; hides when drawer is open (FB-09)
    HeroCards.tsx           ← 'use client'
    NeedToContactWidget.tsx ← 'use client'
    OpenOrdersWidget.tsx    ← 'use client' — was PendingOrdersWidget; renamed in PO model v2
    LeadsFollowUpWidget.tsx ← 'use client'
    RevenueChart.tsx        ← 'use client' — Recharts (renamed from InvoiceChart 2026-07-29; charts order revenue)
    ProductionWidget.tsx    ← 'use client' — next 2 business days + unscheduled count (Feature 11)
  customers/
    CustomerLayout.tsx      ← 'use client' — two-panel state
    CustomerList.tsx        ← 'use client'
    CustomerDetail.tsx      ← 'use client'
    CustomerForm.tsx        ← 'use client'
    CustomerContactCard.tsx ← 'use client' — Text/Email action buttons per contact
    VolumeOverview.tsx      ← 'use client'
  orders/
    OrderLayout.tsx         ← 'use client' — two-panel state
    OrderTable.tsx          ← 'use client'
    OrderDetail.tsx         ← 'use client'
    OrderForm.tsx           ← 'use client' — auto-fills delivery address from customer default
    useOrderForm.ts         ← 'use client' — form state + submit flow behind OrderForm (extracted 2026-07-27 at the 200-line cap)
    OrderStatusActions.tsx  ← 'use client' — fwd (Mark Complete / Cancel) + revert flows
    useStatusActions.ts     ← 'use client' — mutation state/handlers behind OrderStatusActions (extracted 2026-07-27; rejection-safe confirm handlers)
    CancelOrderDialog.tsx   ← 'use client'
    RevertOrderDialog.tsx   ← 'use client' — status-aware copy for invoiced revert
    PODocumentUpload.tsx    ← 'use client' (placeholder — Tasks 19/33 cut)
  calendar/                 ← Feature 11 — every file is 'use client' (@dnd-kit + Framer Motion)
    CalendarLayout.tsx      ← composition root; hosts the DnD context, the strip and the card dialog
    calendarScroll.ts       ← useWeekScroll — strip scroll position + the viewer's local "today"
    calendarWeeks.ts        ← buildWeekGroups + groupRowsByDay (keys cards by production_date)
    WeekStrip.tsx           ← week groups with a 2px Fri│Mon divider
    DayColumn.tsx           ← one weekday; droppable + SortableContext
    DayColumnParts.tsx      ← DayHeader / ColumnBody / ColumnFooter (line-cap split)
    ProductionCard.tsx      ← presentational card, context-free
    productionCardStatus.ts ← isBuiltStatus + built/active surface classes, shared with the dashboard widget (extracted 2026-07-27 at the 200-line cap)
    productionCardFormat.ts ← formatProductionMix (the `12×275 REC` line)
    productionCardColors.tsx ← COMBO_CLASS + ColoredMix — the mix line's size/type coloring (line-cap split)
    SortableProductionCard.tsx ← drag wrapper; the tap target that opens the popup, arms on touch long-press (Task 68)
    CalendarDndContext.tsx  ← sensors (mouse/pen + keyboard — touch deliberately has none), collision detection, auto-scroll, DragOverlay
    calendarDnd.ts          ← pure drop resolution + sensor constants (type-only @dnd-kit import)
    armPlacement.ts         ← Task 68 — pure tap resolution + arming constants; the touch counterpart of calendarDnd.ts
    useLongPressArm.ts      ← Task 68 — still-finger long-press detection, touch events only
    armMode.tsx             ← Task 68 — armed-card context + tap routing into the placement mutations
    cardSelection.tsx       ← context carrying "open this card's popup" to the card wrapper
    calendarLayoutHooks.ts  ← useCalendarActions / useNewOrderDay (line-cap split from CalendarLayout)
    useProductionPlacement.ts ← the four calendar mutations + toast/refresh
    UnscheduledCallout.tsx  ← amber count pill, dropdown, and drop-target for unscheduling
    AddOrderMenu.tsx        ← the per-day `+ Add order` pick list
    ProductionCardDialog.tsx ← the card popup. **No longer read-only** (Feature 12) — writes `same_day_delivery`, `backhaul` and status
    ProductionCardDialogParts.tsx / productionCardDialogHooks.ts ← line-cap splits; the hooks file holds the project's only focus trap + the nested-dialog Escape gate
    ProductionCardDialogControls.tsx ← the two pill toggles + the status section (Feature 12)
    newOrderDay.tsx      ← context carrying "start a new order on this day" up to the layout, mirroring cardSelection.tsx
    NewOrderDrawer.tsx   ← DetailDrawer + OrderForm mode="create", hosted on /calendar (Feature 12)
  leads/
    LeadLayout.tsx          ← 'use client' — two-panel state
    LeadList.tsx            ← 'use client'
    LeadDetail.tsx          ← 'use client' — Text + Email + Edit + Convert action buttons
    LeadForm.tsx            ← 'use client'
  invoices/
    InvoiceLayout.tsx       ← 'use client' — two-panel state (drawer-based ledger below lg)
    GenerateInvoice.tsx     ← 'use client' — month-only picker (v3 — no customer dropdown)
    InvoiceLedger.tsx       ← 'use client' — chronological list (v3 — no filters/status)
    OverwriteInvoiceDialog.tsx ← 'use client' — confirm replacing an existing month invoice
  support/
    SupportLayout.tsx       ← 'use client' — two-panel state
    NewTicketForm.tsx       ← 'use client'
    TicketList.tsx          ← 'use client'
    TicketDetail.tsx        ← 'use client'
  shared/
    QtyGrid.tsx             ← 'use client' — reusable 2×3 size×type grid (display + input modes); used by OrderForm and OrderDetail (FB-10 / Feature 9 / CONSTRAINT-18)
    BackhaulTag.tsx         ← 'use client' — compact `B` tag for any PO list surface (created in Task 42)
    SameDayTag.tsx          ← 'use client' — compact amber `SD` tag mirroring BackhaulTag; used by the calendar card and the dashboard production widget (moved here 2026-07-27)
  ui/                       ← shadcn/ui generated components
```

### ⚠ Component Boundary Rule

**Any file that imports from `framer-motion`, `recharts`, `@dnd-kit/core`, or `@dnd-kit/sortable` must be a client component (`'use client'` at the top of the file).**

All three are browser-only: they touch the DOM, pointer events, or measurement APIs that do not exist on the server. A type-only import (`import type { DragEndEvent } from '@dnd-kit/core'`) is erased at compile time and does **not** require the directive — `components/calendar/calendarDnd.ts` relies on this.

Server components: fetch data only. Never import from animation, chart, or drag-and-drop libraries. Pass fetched data as props to client components.

Client components: render UI, handle interactions, run animations. Never do async data fetching (use props from server parent or server actions for mutations).

Pattern:
```
app/(app)/customers/page.tsx     ← server: fetches customers → passes as props
  └── CustomerLayout.tsx         ← 'use client': two-panel layout, manages selection state
        └── CustomerList.tsx     ← 'use client': renders list with animations
        └── CustomerDetail.tsx   ← 'use client': renders detail with animations
```

---

## Database Layer

```
db/
  schema/
    enums.ts          ← all pgEnum definitions
    customers.ts      ← customers + customer_contacts tables
    orders.ts         ← orders table
    leads.ts          ← leads + lead_notes tables
    invoices.ts       ← invoices table
    support.ts        ← support_tickets + support_attachments tables
    index.ts          ← re-exports all
  queries/
    dashboard.ts      ← getDashboardStats, getNeedToContactList, getRevenueTrendData, etc.
    customers.ts      ← getCustomers, getCustomerDetail, getCustomerOrders, getVolumeOverview
    orders.ts         ← getOrders, getOrderDetail
    calendar.ts       ← getCalendarOrders, getUnscheduledOrders + CalendarOrderRow (Feature 11)
    calendar.constants.ts ← UNSCHEDULED_DROPDOWN_VISIBLE, CALENDAR_WEEKS_BUFFER (client-safe sibling — see Platform-Native Rules)
    production-widget.ts ← getProductionWidgetData — the dashboard's next-2-business-days widget
    production-widget.constants.ts ← productionWidgetDays + row/group types (client-safe sibling)
    customer-overdue.sql.ts ← shared order_stats/auto_freq CTEs + overdue-days fragments — the single source of the overdue-customer rule, composed by customers.sql.ts and dashboard.sql.ts (CQ-07 extraction, 2026-08-02); server-side only
    leads.ts          ← getLeads, getLeadDetail, getLeadNotes
    invoices.ts       ← getInvoiceableOrders, getInvoices, getInvoiceDetail
    support.ts        ← getTickets, getTicketDetail
  index.ts            ← Drizzle client initialization
  migrations/         ← SQL migration files

lib/
  supabase/
    client.ts         ← browser SupabaseClient (createBrowserClient)
    server.ts         ← server SupabaseClient (createServerClient + cookies)
  actions/
    auth.ts           ← signIn, signOut
    auth.guard.ts     ← assertAuthenticated, used by every order + calendar action; re-exports GENERIC_FAILURE_MESSAGE from lib/errors.ts (no 'use server' — helpers here must never become public actions, SEC-08)
    customers.ts     ← createCustomer, updateCustomer, deleteCustomer
    orders.ts        ← createOrder, updateOrder, updateOrderStatus
    orders.revert.ts ← revertOrderToScheduled (FB-08; sibling extracted at the 300-line cap)
    orders.validation.ts ← Zod schemas + helpers + constants for the orders actions (FB-10 / Platform-Native Rule sibling — `'use server'` files export async only)
    calendar.ts      ← setProductionPlacement, clearProductionPlacement, toggleSameDayDelivery, toggleBackhaul (Feature 11–12)
    calendar.validation.ts ← Zod schemas + SORT_INDEX_MAX (Platform-Native Rule sibling)
    dates.validation.ts ← the shared no-weekend `productionDateSchema` + ISO_DATE_RE. Extracted in Feature 12 so `createOrder` and the calendar actions enforce the invariant from ONE rule; a direct re-export between `orders.validation.ts` and `calendar.validation.ts` would have closed an import cycle and left ISO_DATE_RE in the TDZ
    leads.ts         ← createLead, updateLead, addLeadNote, setNextAction, convertLeadToCustomer
    invoices.ts      ← createInvoice (v3; markInvoicePaid removed)
    invoices.constants.ts ← INVOICE_EXISTS_CODE sentinel (Platform-Native Rule sibling)
    support.ts       ← createTicket, uploadTicketAttachment
  hooks/
    useToast.ts       ← toast queue hook
  animations.ts       ← shared Framer Motion variant constants
  calendar-range.ts   ← parseCalendarWeek + buildCalendarRange for the /calendar route's ?week= param
  format-currency.ts  ← shared USD formatter, drops trailing zeros (e.g. 25.50 → $25.5)
  dates.ts            ← DB_DATE_FORMAT + the business-day helpers (isBusinessDay,
                        prevBusinessDay, nextBusinessDay, startOfBusinessWeek,
                        businessWeekDays, parseDbDate). `prevBusinessDay` has
                        exactly one caller — defaultProductionDate at order
                        creation. Nothing derives a card's position at read
                        time (CONSTRAINT-19)
  errors.ts           ← named error classes (DatabaseError, *NotFoundError, InvalidDateError) + GENERIC_FAILURE_MESSAGE (client-safe home of the fallback copy; auth.guard.ts re-exports it for server actions)
```

---

## Infrastructure

| Layer | Service | Tier | Ceiling |
|-------|---------|------|---------|
| Frontend hosting | Vercel | Free | 100GB bandwidth/mo |
| Database | Supabase PostgreSQL | Free | 500MB storage |
| Auth | Supabase Auth | Free (included) | 50k MAU |
| File storage | Supabase Storage | Free | 1GB total |
| Keep-alive cron | cron-job.org | Free | — |

**Deployment:** Push to `main` → Vercel auto-deploys. All environment variables set in Vercel dashboard — never in source.

**Database connection (revised 2026-08-02, FB-20):** `DATABASE_URL` points at Supabase's **session-mode pooler (port 5432)** — a deliberate workaround, not the preferred mode. The transaction pooler (:6543, the correct serverless mode) was losing/misrouting query responses (observed directly; likely fallout from Supabase's Jul 23 pooler maintenance in us-east-2), which hung every authenticated page. Session mode caps total clients at pool_size (15, builder-declined raising); `db/index.ts` therefore holds **max 2 connections per instance** plus `idle_timeout`/`max_lifetime`/`connect_timeout` — all load-bearing, do not remove. Deploy-heavy days can transiently 500 with `EMAXCONNSESSION` until stale instances die. Retest :6543 periodically and switch back once Supabase fixes it.

**Supabase pausing mitigation:** cron-job.org pings `[SUPABASE_URL]/rest/v1/customers?select=id&limit=1` with `apikey` header every 5 days. Prevents 7-day inactivity pause. Setup documented in `README.md`.

**File storage budget:** 1GB free. At 10MB max per PO document, that's ~100 PO docs before limit. Typical PDFs (100KB–500KB) give substantially more headroom.

---

## Security Architecture

### Authentication
Supabase Auth single-user pattern (A-02). Fixed internal email stored as `ADMIN_EMAIL` env var, never shown in UI. Password-only login screen.

**Revised 2026-08-02 (CRIT-01 rotation):** two auth users now exist — the **prod user** (new email, set only in Vercel's `ADMIN_EMAIL`) and the **QA user** (the original email, kept in local `.env` so local dev signs in as it; password in gitignored `testing-setup.md`). The app remains single-user per environment — `signIn` still uses whichever `ADMIN_EMAIL` its environment provides. Both users have identical full RLS access to the one shared DB (CONSTRAINT-20: not a sandbox).

### Authorization
Row Level Security (RLS) on all 8 tables. Policy: `FOR ALL TO authenticated USING (true) WITH CHECK (true)`. Single user — any authenticated session has full access. RLS prevents any unauthenticated query from returning data, even if server-side code has a bug.

Server-side validation: every Server Component and Server Action calls `supabase.auth.getUser()` before any DB operation. Unauthenticated → redirect to `/login` (components) or return error (actions).

### File Access
Both storage buckets (`po-documents`, `support-attachments`) are private. Files never served via public URLs. All downloads use signed URLs generated server-side: 1-hour expiry, require active auth session to generate.

### Input Validation
- Client-side: Zod validation for fast UX feedback
- Server-side: Zod validation in every Server Action before any DB write — client validation is not trusted
- UUIDs: all ID parameters validated as UUID format before DB queries

### Secrets
`SUPABASE_SERVICE_ROLE_KEY` used server-side only (lib/supabase/server.ts). Never imported in any client component. Never exposed via `NEXT_PUBLIC_` prefix. All secrets in environment variables only — never in source.

---

## Platform-Native Rules

Next.js 14 enforces invariants that don't appear in the generic rules files but are binding for any code touching this repo. Surfaced and documented after the first production build (2026-04-22) exposed all three.

### `'use server'` files export async functions only
Files marked `'use server'` (every file under `lib/actions/`) may export **async functions only**. Non-function exports (constants, arrays, unions, enums) fail the production compile with `Only async functions are allowed to be exported in a "use server" file`. Dev mode tolerates this on the initial compile but surfaces the error on per-route cold compiles.

**Pattern:** non-function exports from the action-domain live in sibling `*.constants.ts` files. Precedents:
- `lib/actions/customers.constants.ts` — `MAX_CONTACTS_PER_CUSTOMER`
- `lib/actions/leads.constants.ts` — `NOTE_CONTENT_MAX`
- `lib/actions/support.constants.ts` — `SUPPORT_CATEGORIES`, `SUPPORT_PRIORITIES` + derived types

### Client components must not value-import from `db/queries/*`
`db/queries/*` modules transitively import `db/index.ts`, which imports the `postgres` driver — a Node-only package that references `fs` / `perf_hooks`. A client component that value-imports anything from this tree drags the driver into the browser bundle, breaking the webpack production build with `Module not found: 'fs'`.

**Rule:** client components may `import type { ... }` from `db/queries/*` (types are erased at build time, safe to cross the boundary). Value exports that client components need live in sibling `*.constants.ts` files. Precedent: `db/queries/calendar.constants.ts` holds `UNSCHEDULED_DROPDOWN_VISIBLE` and `CALENDAR_WEEKS_BUFFER` for the calendar client components.

### Authenticated routes opt out of static rendering
Every route that reads session cookies via `supabase.auth.getUser()` must declare `export const dynamic = 'force-dynamic'`. Without it, Next.js attempts to prerender these routes at build time — when no cookies exist — and fails every one of them with `createClient (server): called outside server context`.

Currently applied to:
- `app/(app)/layout.tsx` — forces every authenticated route under `(app)` dynamic
- `app/(auth)/login/page.tsx` — reads cookies to redirect already-logged-in users

### TypeScript CSS side-effect import declaration
`import './globals.css'` in `app/layout.tsx` requires an ambient module declaration because TypeScript doesn't natively recognise CSS side-effect imports. The project ships one at `globals.d.ts` (`declare module '*.css'`). Dev tolerates the missing declaration; `tsc --noEmit` and the production build reject it.

---

## Performance Considerations

- Need-to-Contact calculation: computed at query time via SQL aggregation. Single-user with hundreds of orders — runs in milliseconds. No background job or materialized view needed. A customer with a scheduled order is never overdue (`overdue_days` NULL, excluded from the widget) — an order is already booked, so there is nothing to contact them about (Task 74, 2026-08-02).
- **Calendar range filter is index-backed again (2026-07-27).** `getCalendarOrders` now filters on the bare column (`o.production_date >= from AND <= to`), which is sargable, so `orders_production_date_idx` serves it. The previous `COALESCE(production_date, …)` form forced a sequential scan and was logged as **FI-02**; removing the read-time derivation removed the problem rather than working around it. No functional index is needed.
- Server Components: data fetched before page renders — no client-side loading state for initial content.
- Animations: `useReducedMotion()` checked in all animated components — instant transitions when accessibility preference set.
- Recharts: `animationDuration={0}` when `useReducedMotion()` is true.
