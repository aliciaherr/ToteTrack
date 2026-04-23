# Product Requirements Document: ToteTrack

**Date:** 2026-04-20
**Last updated:** 2026-04-23 — added Cross-cutting: App Shell Chrome, Feature 8 (Quick-Add FAB); D10 + D11 decisions (via @cpo)
**Status:** Approved — Phase 1 complete
**Approved by:** Builder (2026-04-20)

---

## Overview

Single-user sales operations CRM for an IBC tote salesperson. Tracks customers, purchase orders, leads, and invoices — with built-in prompting on who to contact next. Primary platform: iPad landscape. Hosted at $0 on Vercel + Supabase free tiers.

---

## Feature 1: Auth

### User Flow
1. Load any app URL → server checks for valid Supabase session cookie
2. No session → redirect to `/login`
3. `/login` renders: ToteTrack logo/wordmark, single "Password" field (type=password), "Sign In" button — no other fields
4. User enters password → clicks "Sign In" or presses Enter
5. App calls `supabase.auth.signInWithPassword({ email: process.env.ADMIN_EMAIL, password })`
6. Success → session cookie set → redirect to `/dashboard`
7. Failure → inline error shown below the input; password field NOT cleared

### Error States
| Scenario | Message |
|----------|---------|
| Wrong password | "Incorrect password. Please try again." |
| Empty submit | "Please enter your password." (client-side, no network call) |
| Network/unexpected error | "Unable to connect. Check your internet connection." |
| Session expired on protected route | Redirect to `/login` with message: "Your session expired. Sign in again." |

### Exclusions
- No "Forgot password" link — no self-service recovery
- No username or email field visible at any point
- No "Remember me" toggle

### Acceptance Criteria
- [ ] Given no session, loading any protected route redirects to `/login`
- [ ] Given valid password, redirect to `/dashboard` within 2 seconds
- [ ] Given wrong password, inline error shown — field NOT cleared, cursor refocused
- [ ] Given already logged in, visiting `/login` redirects to `/dashboard`
- [ ] Given session expires, next protected route visit redirects to `/login`

---

## Feature 2: Dashboard

### Layout
- App shell chrome applies — see Cross-cutting: App Shell Chrome (pill hamburger only; no top bar)
- Page title: "Command Overview" / subtitle: "Real-time logistics matrix."
- Quick-Add FAB (bottom-right, fixed) — see Feature 8
- Top-right: Monthly | Yearly pill toggle (default: Monthly)
- Row 1: Two hero cards (equal width)
- Row 2: Need-to-Contact (left 50%) + Open Orders (right 50%)
- Row 3: Invoice Trend Chart (full width)
- Row 4: Leads to Follow Up (full width)

### Hero Cards (period toggle affects these only)
**Left — TOTAL INVOICED:**
- Monthly: sum of invoice `total_amount` for current calendar month
- Yearly: sum of invoice `total_amount` for current calendar year (YTD)
- Delta badge: `((current - prior) / prior) * 100` — green if positive, red-orange if negative; "—" if no prior data
- Label: "vs. [Prior Month]" or "vs. [Prior Year]"

**Right — PURCHASE ORDERS:** (per CONSTRAINT-15 — PO model v2)
- Large: `openCount` — live count of orders with status = 'scheduled' (period-agnostic, always current)
- Smaller: `completedInPeriodCount` — count of orders with status IN ('completed', 'invoiced') AND `requested_delivery_date` within the selected period (Monthly or Yearly)
- Arrow button → navigates to `/orders`

### Need-to-Contact Widget
- Top 5 most overdue customers (see cross-cutting: Need-to-Contact Logic)
- Row: teal avatar circle (initials), company name, "X days overdue" badge (red-orange)
- Only customers with ≥2 completed/invoiced orders OR a manual frequency override (per CONSTRAINT-15, "completed" for stats includes the `invoiced` sub-state)
- Empty state: "No customers need contact right now."
- Click row → `/customers?id=[customerId]`

### Open Orders Widget (renamed from Pending Orders — per CONSTRAINT-15)
- All orders with status = 'scheduled' (the `pending` status was dropped in migration 0004)
- Sort: backhaul=true pinned to top (BACKHAUL badge, teal), then by `requested_delivery_date` ASC within each group (NULLS LAST — date is optional per CONSTRAINT-16)
- Up to 5 rows; "View all" → `/orders?status=scheduled`
- Row: PO number, customer name, BACKHAUL badge (if applicable), requested delivery date ("—" when null)
- Empty state: "No open orders."

### Leads to Follow Up Widget
- Leads where `next_follow_up_date ≤ today`
- Sort: `next_follow_up_date ASC` (most overdue first)
- Up to 5 rows; "View all" → `/leads`
- Row: lead name, company, "X days overdue" badge
- Empty state: "No leads to follow up on."

### Invoice Trend Chart
- 4-mode selector (2×2 tab grid): Per Period | Cumulative (columns) × Monthly | Annual (rows)
  - Per-Period Monthly: rolling last 12 months, one bar/month, Y-axis = $ invoiced that month
  - Per-Period Annual: all years with data, one bar/year
  - Cumulative Monthly: rolling last 12 months, running total
  - Cumulative Annual: running total per year
- Hover tooltip: period label + formatted $ amount
- No data: "No invoice data yet." centered in chart area

### Exclusions
- Monthly/Yearly toggle affects hero cards only — not chart, Need-to-Contact, Leads, or Open Orders
- No real-time push updates — data loads on page mount

---

## Feature 3: Customers

### Layout
Two-panel: customer list (left ~35%) + customer detail (right ~65%)

### Customer List Panel
- Search bar (top): case-insensitive contains match on company name
- Active | Inactive toggle (default: Active)
- Sort dropdown: Alphabetical (default) | Order Count (desc) | Need-to-Contact (most overdue first)
- "+ New Customer" button (top right) → opens CustomerForm in right panel
- Customer rows: avatar initials, company name, primary contact name + role, last sale date, "CONTACT NEEDED" badge (red-orange, when overdue > 0 days)
- Click row → URL `/customers?id=[uuid]`, right panel loads detail
- Empty (no customers): "No customers yet. Add your first customer."
- Empty (search): "No customers match that search."

### Customer Detail Panel
- No customer selected → "Select a customer to view details."
- Header: company name (large), "Edit" button, "+ New Order" button → `/orders?new=1&customerId=[id]`
- **Contact card:** primary contact — name, role, email, phone; "Last order X days ago — Contact Recommended" (only if overdue)
- Multiple contacts: primary in card, additional in collapsible "More contacts" section (Framer Motion height expand, 200ms ease-in-out)
- **Frequency display:** "Auto (X days avg)" if no manual override; "Every X days (manual)" if override set
- **Order History tabs:** 1M | 3M | 6M | 1Y | YTD — windows: 30d / 90d / 180d / 365d / Jan 1 to today; table: PO#, date, qty, size, type, status badge, price; sorted by `requested_delivery_date DESC NULLS LAST` (dates are optional per CONSTRAINT-16 — null-date rows are naturally excluded from time-window filters)
- **Volume Overview:** average totes per completed PO by size (275/330) and type (Rebottled/Reconditioned/Brand New) as progress bars — see Feature: Volume Overview

### New Customer Form (modal)
Required: company name, primary contact (name + at least one of email/phone)
Optional: role, additional contacts (max 5 total), contact frequency override (days), notes, status (Active default)

### Edit Customer Form
Same fields, pre-filled; "Add another contact" adds additional contact rows; "Delete customer" button (confirmation required)

### Error States
- Company name empty → "Company name is required."
- No email AND no phone on primary contact → "At least one email or phone is required."
- Delete customer with ANY order history → "Cannot delete a customer with order history. Set them to Inactive instead." (per CONSTRAINT-13 — hard-delete requires zero orders regardless of status; use the Active/Inactive toggle to archive customers with history)

### Exclusions
- No bulk import
- No duplicate merge
- No customer activity log beyond order history

---

## Feature 4: Orders

### Layout
Two-panel: order table (left ~40%) + order detail (right ~60%)

### Order Table (left)
- Filter tabs: All | Scheduled | Completed | Cancelled (per CONSTRAINT-15 — `pending` removed; `Completed` tab matches status IN ('completed', 'invoiced'); no standalone `Invoiced` tab)
- Columns: PO#, Customer (avatar initial + name), Qty/Size, Type badge, Status badge, Req. Date ("—" when null per CONSTRAINT-16), Price
- BACKHAUL badge (teal) on rows where `backhaul = true`
- Type badge colors: Rebottled = blue-tinted, Reconditioned = teal-tinted, Brand New = dark/inverted
- Default sort: scheduled first (req date ASC NULLS LAST), then completed/invoiced/cancelled (req date DESC NULLS LAST)
- Pagination: 20 rows/page; "Showing X–Y of Z orders"
- "+ New Order" button top right → OrderForm
- Click row → URL `/orders?id=[uuid]`, right panel loads

### Order Detail Panel (right)
- No order selected → "Select an order to view details."
- All fields: PO#, customer (linked), status badge, container size, container type, quantity, price, pickup-only (Y/N), delivery address (hidden if pickup-only = true), requested delivery date, backhaul (Y/N), notes
- Status section → OrderStatusActions component (see state machine; manual transitions: `scheduled → completed`, `scheduled → cancelled`; terminal states may be reverted to `scheduled` via "Revert to Scheduled" per FB-08)
- Document section → permanent labeled placeholder (Task 19 + Task 33 cut 2026-04-22; `orders.document_url` column and `po-documents` Supabase Storage bucket retained for potential future revival)

### New/Edit Order Form
Fields: PO number (manual, unique), customer (searchable dropdown), container size (275 | 330), container type, quantity, price, pickup-only checkbox, delivery address (conditional; auto-fills from customer's `default_delivery_address`), requested delivery date (optional per CONSTRAINT-16 — stored NULL if omitted; form label shows "(optional)"), backhaul checkbox, notes.

Status at creation is fixed as `scheduled` (not user-selectable) per CONSTRAINT-15. No PO document field (upload cut from v1 scope — see below).

### PO Document Upload — CUT FROM v1 (2026-04-22)
- Originally specced as Task 19 (upload) + Task 33 (Claude vision extraction)
- Task 33 cut: Anthropic Claude API is a paid service, conflicting with CONSTRAINT-07 ($0 hosting). Upload-without-extraction provides no real value (salesperson would still re-type every field), so Task 19 cut as well
- Residual state: `orders.document_url` column and `po-documents` Supabase Storage bucket exist but are unused. `PODocumentUpload` component in OrderDetail.tsx is a permanent labeled placeholder
- Reviving this feature requires: (1) CONSTRAINT-07 amendment allowing the paid API, (2) `@assumptions` spike with 3–5 real PO samples to validate extraction accuracy, (3) fresh `@plan` task with updated acceptance

### Error States
- Duplicate PO number → "PO number already exists."
- Delivery address empty when pickup-only = false → "Delivery address is required unless pickup-only."
- Quantity < 1 → "Quantity must be at least 1."
- Price ≤ 0 → "Price must be greater than $0."

### Exclusions
- No auto-generated PO numbers
- `invoiced` status is not manually selectable — auto-set by invoice generation
- No `pending` status (removed per CONSTRAINT-15, migration 0004)
- No bulk status update
- No supplier fields
- No PO document upload or extraction (Task 19 + Task 33 cut 2026-04-22 — see section above)

---

## Feature 5: Leads

### Layout
Two-panel: lead list (left ~40%) + lead detail (right ~60%)

### Lead List Panel
- Filter tabs: All | Hot | Warm | Cold (converted leads never shown)
- Sort: `next_follow_up_date ASC`, nulls last
- Search: name or company (case-insensitive contains)
- Status badges: Hot = red-orange, Warm = amber, Cold = slate
- "+ New Lead" button → LeadForm in right panel
- Click row → URL `/leads?id=[uuid]`, right panel loads
- Empty state: "No leads yet. Add your first lead."

### Lead Detail Panel
- No lead selected → "Select a lead to view details."
- Header: name (large), title, company; "Edit" button; "Convert to Customer" button (teal, prominent)
- Contact info: email, phone
- Engagement section: Last Contact date (display), Lead Source (display), Status badge
- Next Action panel: date picker, time input, Action Type dropdown (Call | Email | Visit | Other), "Save Reminder" button → sets `next_follow_up_date` and `next_action_type`
- Notes section: append-only, date-stamped entries (oldest top); "Add Note" textarea + "Save Note"; empty: "No notes yet."
- Notes are not editable after save

### New/Edit Lead Form
Required: name, at least one of email/phone, status (default: Warm)
Optional: company, role, lead source (freeform text), notes

### Conversion Flow
1. "Convert to Customer" → confirmation: "Convert [name] to a customer? This will create a new customer record and archive this lead."
2. Confirm → atomic: create customer record (lead's data pre-filled) + set lead status = 'converted' + set `converted_customer_id`
3. Redirect → `/customers?id=[newCustomerId]`
4. Soft warning if same company already exists (not a block)

### Error States
- Name empty → "Name is required."
- No email AND no phone → "At least one contact method is required."
- Note save with empty content → "Note cannot be empty." (client-side)

### Exclusions
- No email send from leads (out of scope)
- No push/email reminders — dashboard widget only

---

## Feature 6: Invoices

> Invoice model v3 per CONSTRAINT-17 (locked 2026-04-22). Supersedes the original per-customer + draft/paid model. Key changes: one invoice per calendar month covers all customers; no status column; overwrite-via-modal replaces multi-draft-per-month flow. Migration `0007` dropped `invoices.customer_id` and `invoices.status` plus the `invoice_status` enum.

### Layout
Two-panel: Generate Invoice (left ~45%) + Invoice Ledger (right ~55%). Below the `lg` breakpoint, the ledger collapses into a drawer-based slide-out to preserve generator visibility on smaller viewports.

### Generate Invoice Panel (left)
- Billing month picker: month + year, default current month (**no customer selector** — one invoice per month covers every customer)
- Table auto-populates: all orders with status = 'completed' AND `invoice_id IS NULL` AND `requested_delivery_date` within the selected calendar month
- Table columns: ☐ | PO# | Customer | Qty + Size + Type | Price — all rows pre-checked
- Per-row checkbox retained as a manual-exclusion override (e.g., a disputed PO left off this month's run)
- Unchecking rows updates "Draft Total: $X,XXX.XX" in real-time (client-side)
- "Create Invoice" button: disabled when 0 rows selected
- No eligible orders → "No completed orders for this period." (no button shown)

### Overwrite Flow
If an invoice already exists for the selected billing month:
1. `createInvoice` returns a sentinel `{ code: INVOICE_EXISTS_CODE, existingInvoiceNumber }` instead of an error (first call; `overwrite: false` by default)
2. Client surfaces `OverwriteInvoiceDialog` showing the existing invoice number: "INV-XXXX already covers this month — overwrite?"
3. On confirm: client re-calls `createInvoice` with `overwrite: true`. Server deletes the existing invoice (its orders detach back to status='completed', invoice_id=null) and creates a fresh INV-#### with the currently-selected POs
4. The deleted invoice number is retired forever — never reused. Acceptable for an internal draft-only invoice system; NOT safe for systems emitting formally sequential invoices to external parties

### Invoice Ledger Panel (right)
- Chronological flat list — no filter pills, no status
- Sort: `billing_month DESC`, then `invoice_number DESC`
- Table: Invoice # | Period (Month YYYY) | Amount (no Customer column; no Status column)
- Click row → detail view (read-only)
- Empty state: "No invoices generated yet."

### Invoice Detail View (read-only)
- Header: `{invoice_number}` + `{billing_month}` formatted as "Month YYYY"
- PO rows table: PO# | Customer | Qty + Size + Type | Price — Customer lives on each row since the invoice itself has no customer association
- Total amount at the bottom

### Invoice Creation Logic (atomic, single DB transaction)
1. Validate all selected `orderIds`: status = 'completed' AND `invoice_id IS NULL`
2. Check for an existing invoice with the selected `billing_month`:
   - Exists AND caller did not pass `overwrite: true` → return `{ code: INVOICE_EXISTS_CODE, existingInvoiceNumber }`, no DB mutation
   - Exists AND `overwrite: true` → delete existing invoice + detach its orders (`status='completed'`, `invoice_id=null`)
   - Does not exist → proceed
3. Sum `total_amount` across selected orders
4. Auto-generate `invoice_number` (INV-0001 format, global monotonic sequence, never reused)
5. Insert invoice row (no status column, no customer_id column per CONSTRAINT-17)
6. Update all selected orders: `status='invoiced'`, `invoice_id=[new invoice id]`

### Error States
- No billing month selected → "Select a billing month to continue."
- Zero POs selected → "Create Invoice" button disabled
- Any selected order turned out to be already invoiced (race condition) → "Order [PO#] is already invoiced." — transaction rollback, full cleanup
- Overwrite declined → no DB change, dialog closes

### Exclusions
- No invoice status field (no draft/paid — CONSTRAINT-17)
- No "Mark as Paid" action
- No per-customer invoice generation (CONSTRAINT-17 — one invoice per month, all customers)
- No filter pills on the ledger (no status to filter by)
- No customer column on the ledger table
- No invoice editing after creation — to change POs on an invoice, overwrite via the Generate Invoice flow for the same month
- No invoice delete UI (overwrite is the only replacement path)
- No PDF export
- No email delivery
- No line item addition outside of PO selection

---

## Feature 7: Support

### Layout
Two-panel: issues list (left ~40%) + Log New Issue form (right ~60%)

### Issues List (left)
- Rows: title, category badge, priority badge (Critical/High/Standard/Low), status pill (Open/In Progress/Resolved/Closed)
- Sort: `created_at DESC`
- Click row → detail view (read-only) in right panel
- Empty state: "No issues submitted yet."

### Log New Issue Form (right)
Fields: Issue Title (required), Category dropdown (Bug | Feature Request | Question | Other), Priority (Low | Standard | High | Critical), Detailed Description (required), Attachments (PNG/JPG/PDF, max 5MB each, max 3 files)

### Submission Flow
1. Create ticket record (status = 'Open')
2. Upload attachments to Supabase Storage → insert attachment records
3. If ticket created but attachment fails: ticket stands; error toast notes attachment failure

### Detail View
Title, category, priority, description, status, developer_notes (read-only; blank if not set), attachment list with download links (signed URLs, 1hr)

### Developer Access
No developer UI in app. Developer views and updates tickets directly in Supabase dashboard (table view). Status and `developer_notes` updated by developer in Supabase; reflected in salesperson's app on next page load.

### Error States
- Title empty → "Issue title is required."
- Description empty → "Description is required."
- File > 5MB → "File too large. Maximum 5MB per file."
- Wrong file type → "Only PNG, JPG, and PDF files are accepted."
- > 3 files → "Maximum 3 attachments per ticket."

### Exclusions
- No email notification on status change
- No reply thread — developer_notes field only

---

## Feature 8: Quick-Add FAB (Dashboard)

### Problem Statement
The salesperson uses the dashboard as their home screen. Adding a new customer, purchase order, or lead currently requires opening the nav drawer, navigating to the target screen, and tapping "+ New X". For a daily driver, that's three taps of friction per entity added. A dashboard-level quick-add shortcut compresses this to two taps while preserving the canonical create flow.

### User Story
As the salesperson on the dashboard, I want to tap a floating button to start adding a new customer, PO, or lead in one gesture, so that I can capture data without losing my place reviewing the dashboard overview.

### User Flow
1. Salesperson is on `/dashboard`
2. Floating "+" button visible in bottom-right corner, fixed to viewport (does not scroll with content), 24px margin from edges
3. Tap "+" → button rotates 45° to "×"; three option buttons fan vertically upward with staggered animation. Order top-to-bottom: Purchase Order, Customer, Lead. Each option shows an icon + label pill ("Add Purchase Order" / "Add Customer" / "Add Lead")
4. Salesperson taps an option → app navigates to the respective screen with the corresponding "New X" form pre-opened in the right panel
5. Alternative close: tap "×" again OR tap anywhere outside the expanded option column → options fan back in, "×" rotates back to "+"

### Business Logic
- FAB renders only on `/dashboard`. Other screens have scoped "+ New X" buttons already and do not get a FAB
- FAB is `position: fixed` to viewport — stays visible while dashboard scrolls
- FAB hides when the Nav Drawer is open (drawer takes focus)
- Tapping an option sets a URL param on the destination route that signals the screen to open its New X form on mount:
  - "Add Customer" → `/customers?new=1`
  - "Add Purchase Order" → `/orders?new=1` (existing param, passed without `customerId`)
  - "Add Lead" → `/leads?new=1`
- `?new=1` clears any concurrent `?id=[uuid]` on the destination (cannot view existing and create new simultaneously)
- Destination screens reuse their existing "+ New X" form rendering — no separate code path
- Tap-outside-to-close does NOT simultaneously activate the tapped element. First tap dismisses FAB; second tap activates the element
- `useReducedMotion` respected: expand/collapse animation replaced with instant show/hide of options

### Acceptance Criteria
- [ ] FAB visible only on `/dashboard` — never on Customers, Orders, Leads, Invoices, Support, or Login
- [ ] FAB collapsed state: "+" icon, teal primary color, 52×52px, bottom-right, 24px margin from viewport edges, fixed to viewport
- [ ] FAB expanded state: "+" rotates to "×"; three options fan upward with 30ms stagger, 150ms scale 0.8→1 + upward translate per option
- [ ] Option order top-to-bottom: Purchase Order, Customer, Lead
- [ ] Each option: 44×44px circular icon button + label pill to its left
- [ ] Tap option navigates to destination; destination opens its New X form on mount when `?new=1` is present
- [ ] Tap "×" or tap-outside → collapse animation, 130ms reverse
- [ ] Tap-outside dismisses FAB without activating the tapped element
- [ ] FAB hidden while Nav Drawer is open
- [ ] All touch targets ≥44px (FAB, options, label pills combined tap area)
- [ ] `useReducedMotion` respected — instant show/hide
- [ ] Keyboard accessible: Tab focuses FAB; Enter/Space opens; Tab or Arrow keys cycle options; Enter activates; Esc closes; focus trap while open; focus returns to FAB on close
- [ ] Screen-reader labeled (aria-expanded, aria-haspopup; options grouped as menu; exact ARIA pattern at implementation discretion)

### Edge Cases
- Dashboard content scrolls below fold: FAB stays pinned (position-fixed)
- Nav drawer opens while FAB is expanded: FAB collapses, then hides
- User taps FAB, mid-fan-out taps outside: animation reverses from current frame — no visual glitch
- InvoiceChart expanded + FAB expanded: FAB options render above chart (correct z-index stacking)
- User is already on destination screen with `?id=[uuid]` selected, then uses dashboard FAB → destination clears `?id`, opens New X form
- Customers and Leads screens do not currently handle `?new=1` — param support added as part of this feature
- Orders already supports `?new=1&customerId=[id]`; FAB omits `customerId` — existing param handling must tolerate its absence
- Very low viewport height (<600px): expanded options may overlap bottom dashboard content — acceptable (options are dismissible)

### Out of Scope
- FAB on any non-dashboard screen (by design — list screens already have "+ New X" buttons)
- Quick-add for invoice or support ticket (not daily-frequency actions)
- Global keyboard shortcut (e.g., Cmd+K) — deferred
- Modal / overlay add flow — FAB navigates, does not open modals in place
- Persisting partially-filled form state across navigation
- Customizing option order or set per user

### Success Metric
The salesperson adopts the FAB as the primary path to create new customers / POs / leads within 2 weeks of ship. Self-reported at a post-ship check-in. No analytics instrumentation in v1 (single-user, $0 tooling constraint).

---

## Cross-cutting: Need-to-Contact Logic

### Calculation
- **Auto-calculated frequency** (requires ≥2 completed/invoiced orders — per CONSTRAINT-15, "completed" for stats purposes includes the `invoiced` sub-state):
  - Average of all consecutive intervals between order `requested_delivery_date` values for orders with status IN ('completed', 'invoiced'). Orders with NULL dates are excluded from the interval calculation (per CONSTRAINT-16, date is optional)
- **Manual override:** `customers.contact_frequency_days` — overrides auto-calc when set
- **Effective frequency:** `COALESCE(manual_override, auto_calculated)`
- **Overdue days:** `(today − last_completed_or_invoiced_order_date) − effective_frequency_days`
  - Positive = overdue; negative = not yet due

### Eligibility
- Customer status = 'active' AND (manual override set OR ≥2 completed/invoiced orders)
- Customers with 0 or 1 completed/invoiced orders and no manual override: excluded
- Inactive customers: excluded

### Sort
Overdue days descending (most overdue first). Used in: dashboard Need-to-Contact widget (top 5) and customer list "Need-to-Contact" sort option.

---

## Cross-cutting: PO Status State Machine

> Per CONSTRAINT-15 (PO model v2, locked 2026-04-22). Supersedes the original 5-state model that included `pending`. Migration `0004` dropped the `pending` enum value; any existing pending rows were rewritten to `scheduled`.

```
[Created] → scheduled
scheduled → completed      (manual: "Mark as Complete" button)
scheduled → cancelled      (manual: "Cancel Order" + confirmation)
completed → invoiced       (automatic: set when invoice includes this PO)
{any terminal} → scheduled (manual: "Revert to Scheduled" — FB-08)
```

- States: `scheduled`, `completed`, `cancelled`, `invoiced` (4 total; `pending` removed)
- `invoiced` is a sub-state of "delivered". Every stats/aggregation query uses `status IN ('completed', 'invoiced')` — volume averages, last-sale date, contact-frequency calculation, completed-order count, Dashboard hero's `completedInPeriodCount`, Customer Order History, Orders "Completed" filter tab. Single exception: `getInvoiceableOrders` stays strict (`status = 'completed' AND invoice_id IS NULL`) — invoiced rows must never re-enter the invoice generation panel
- `invoiced` is auto-set only — not manually selectable
- Forward manual transitions only: `scheduled → completed`, `scheduled → cancelled`. No manual path into `invoiced`
- Revert: any terminal state → `scheduled` via "Revert to Scheduled" (FB-08). When reverting an `invoiced` order, the invoice detaches as part of the same flow
- Mark-as-Complete on an order whose `requested_delivery_date` is NULL auto-sets the date to `CURRENT_DATE` via `COALESCE(requested_delivery_date, CURRENT_DATE)` in the same UPDATE (per CONSTRAINT-16) — no extra prompt; salesperson can edit the date afterward if the actual delivery was earlier
- No automated "delivery date passed" → `completed` transition — manual Mark Complete only (Supabase free has no `pg_cron`)

---

## Cross-cutting: App Shell Chrome

### Applies to
All authenticated screens under `app/(app)/*` — Dashboard, Customers, Orders, Leads, Invoices, Support. Excludes `/login`.

### Layout
- **No top bar.** No logo, global search, notification bell, or user avatar in page chrome on any authenticated screen
- **Pill hamburger:** button contained in a white pill (subtle shadow matching card elevation), ~44×44px, positioned top-left of viewport, aligned with page content gutter (~24px from edges), `position: fixed` to viewport (does not scroll with content)
- **Tap hamburger** → opens the Nav Drawer (Framer Motion slide-over from left with backdrop fade — see Animation Specs in `docs/design-decisions.md`)
- **Nav Drawer internals unchanged:** 6 nav items (Dashboard, Customers, Orders, Leads, Invoices, Support) + Sign Out button at bottom. Active nav item has teal left-border + bold label. Drawer closes on nav item tap or tap-outside
- **Login screen (`/login`) is exempt** — renders logo + password field + Sign In button only. No hamburger, no chrome.

### Page Orientation
No page title row is added to chrome. Authenticated screens orient the user via:
- The Nav Drawer's active-state indicator (teal left-border on active item when drawer is open)
- Content self-titling where it already exists: Dashboard shows "Command Overview"; Orders shows "Active Shipments"
- Panel headings and empty-state copy on screens without explicit titles: Customers/Leads/Invoices/Support rely on panel headings ("Invoice Ledger", "Generate Invoice", etc.) and empty-state messages (e.g. "No leads yet. Add your first lead.")

### Acceptance Criteria
- [ ] No top bar rendered on any authenticated screen — no logo, search, notifications, or avatar in chrome
- [ ] Pill hamburger renders top-left of viewport on every authenticated screen, fixed to viewport
- [ ] Hamburger touch target ≥44×44px
- [ ] Tap hamburger opens Nav Drawer with existing slide-over animation
- [ ] Nav Drawer contents unchanged — 6 nav items + Sign Out button
- [ ] `/login` shows logo + password field + Sign In button only — no hamburger, no chrome
- [ ] `TopBar.tsx` component is removed from the codebase (or retained only as a no-op wrapper if removing breaks imports — preferred: delete)
- [ ] No FAB on any screen other than Dashboard

### Out of Scope
- Global search (removed — per-screen scoped search exists on Customers, Orders, Leads)
- Notification system (no multi-user interactions to notify on)
- User avatar / profile menu (single-user tool)
- Universal page-title row in chrome or content
- Breadcrumb navigation (single-level app, no nesting depth)
- Dark mode toggle or any theme switcher (design-decisions.md: light mode only)

---

## Decisions Log

| # | Decision | Resolution |
|---|----------|-----------|
| D1 | Session duration | Supabase default (1hr access token, rolling refresh) |
| D2 | Orders screen layout | Two-panel (list left, detail right) — matches Customers pattern |
| D3 | PO status transition UX | Labeled action buttons (not dropdown) |
| D4 | Lead source field | Freeform text input |
| D5 | Invoice — which POs shown | Completed POs only, not yet invoiced, within selected month |
| D6 | ~~Invoice statuses~~ | ~~Draft + Paid only ("Sent" excluded — no send capability)~~ — **SUPERSEDED by D14 / CONSTRAINT-17 (2026-04-22)**: `status` column and `invoice_status` enum dropped in migration `0007`. Invoices have no status field |
| D7 | Developer ticket access | Supabase dashboard directly (no developer UI in app) |
| D8 | Purchase frequency unit | Days |
| D9 | Container sizes/types | Fixed enums — 275/330 gal, Rebottled/Reconditioned/Brand New |
| D10 | Remove global top bar; pill hamburger only | No logo/search/notifications/avatar in chrome on authenticated routes; pill-contained hamburger fixed top-left; page orientation via drawer active-state + content self-titling; login screen exempt |
| D11 | Dashboard-only quick-add FAB, navigate-not-modal | FAB on `/dashboard` only (dashboard-only by design, no expansion to other screens); tapping options navigates to destination with New X form pre-opened via `?new=1` URL param; no modal overlay |
| D12 | PO model v2 (Bundle D, 2026-04-22) → CONSTRAINT-15 | Drop `pending` status; 4 states (`scheduled`, `completed`, `cancelled`, `invoiced`); `invoiced` is a sub-state of `completed` for stats; `Completed` filter tab matches `status IN ('completed', 'invoiced')`; manual transitions only `scheduled → completed` and `scheduled → cancelled`; terminal → `scheduled` via Revert (FB-08). Migration `0004` |
| D13 | Optional `requested_delivery_date` (Bundle E, 2026-04-22) → CONSTRAINT-16 | Date column is nullable; new-order form marks it (optional); Mark-as-Complete on an undated order auto-sets `CURRENT_DATE` via `COALESCE`; all sorts use `NULLS LAST`; period-window filters naturally exclude NULL-dated rows |
| D14 | Invoice model v3 (Bundle H, 2026-04-22) → CONSTRAINT-17 | One invoice per calendar month covers all customers; no `customer_id` column on invoices; no status column (no draft/paid); "Mark as Paid" removed; existing-month invoice creation triggers `OverwriteInvoiceDialog`; retired invoice numbers never reused; ledger is flat chronological. Migration `0007` |
