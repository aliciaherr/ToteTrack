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
- ~~Columns: PO#, Customer (avatar initial + name), Qty/Size, Type badge, Status badge, Req. Date ("—" when null per CONSTRAINT-16), Price~~ — **SUPERSEDED by D15 / Feature 9 (2026-04-24):** Columns are PO#, Customer (avatar initial + name), 275 (total qty), 330 (total qty), Status badge, Req. Date ("—" when null per CONSTRAINT-16), Price, B-tag (backhaul). Empty size totals render as `—`.
- ~~BACKHAUL badge (teal) on rows where `backhaul = true`~~ — **SUPERSEDED by D15 / Feature 9 (2026-04-24):** Compact `B` tag rendered after Price column when `backhaul = true`.
- ~~Type badge colors: Rebottled = blue-tinted, Reconditioned = teal-tinted, Brand New = dark/inverted~~ — **SUPERSEDED by D15 / Feature 9 (2026-04-24):** Type badges removed from list view; type information now visible only in PO detail's 2×3 mix grid.
- Default sort: scheduled first (req date ASC NULLS LAST), then completed/invoiced/cancelled (req date DESC NULLS LAST)
- Pagination: 20 rows/page; "Showing X–Y of Z orders"
- "+ New Order" button top right → OrderForm
- Click row → URL `/orders?id=[uuid]`, right panel loads

### Order Detail Panel (right)
- No order selected → "Select an order to view details."
- ~~All fields: PO#, customer (linked), status badge, container size, container type, quantity, price, pickup-only (Y/N), delivery address (hidden if pickup-only = true), requested delivery date, backhaul (Y/N), notes~~ — **SUPERSEDED by D15 / Feature 9 (2026-04-24):** All fields: PO#, customer (linked), status badge, **2×3 quantity mix grid** (replaces single container_size + container_type + quantity — reuses Customer Volume Overview component, displays actual qty per cell or `—` for empty), price (total, user-entered), pickup-only (Y/N), delivery address (hidden if pickup-only = true), requested delivery date, backhaul (Y/N), notes.
- Status section → OrderStatusActions component (see state machine; manual transitions: `scheduled → completed`, `scheduled → cancelled`; terminal states may be reverted to `scheduled` via "Revert to Scheduled" per FB-08)
- Document section → permanent labeled placeholder (Task 19 + Task 33 cut 2026-04-22; `orders.document_url` column and `po-documents` Supabase Storage bucket retained for potential future revival)

### New/Edit Order Form
~~Fields: PO number (manual, unique), customer (searchable dropdown), container size (275 | 330), container type, quantity, price, pickup-only checkbox, delivery address (conditional; auto-fills from customer's `default_delivery_address`), requested delivery date (optional per CONSTRAINT-16 — stored NULL if omitted; form label shows "(optional)"), backhaul checkbox, notes.~~ — **SUPERSEDED by D15 / Feature 9 (2026-04-24):** Fields: PO number (manual, unique), customer (searchable dropdown), **2×3 quantity grid** (rows: 275 gal / 330 gal; columns: Reconditioned / Rebottled / Brand New — replaces single container_size + container_type + quantity), price (total, user-entered), pickup-only checkbox, delivery address (conditional; auto-fills from customer's `default_delivery_address`), requested delivery date (optional per CONSTRAINT-16 — stored NULL if omitted; form label shows "(optional)"), backhaul checkbox, notes.

Status at creation is fixed as `scheduled` (not user-selectable) per CONSTRAINT-15. No PO document field (upload cut from v1 scope — see below).

### PO Document Upload — CUT FROM v1 (2026-04-22)
- Originally specced as Task 19 (upload) + Task 33 (Claude vision extraction)
- Task 33 cut: Anthropic Claude API is a paid service, conflicting with CONSTRAINT-07 ($0 hosting). Upload-without-extraction provides no real value (salesperson would still re-type every field), so Task 19 cut as well
- Residual state: `orders.document_url` column and `po-documents` Supabase Storage bucket exist but are unused. `PODocumentUpload` component in OrderDetail.tsx is a permanent labeled placeholder
- Reviving this feature requires: (1) CONSTRAINT-07 amendment allowing the paid API, (2) `@assumptions` spike with 3–5 real PO samples to validate extraction accuracy, (3) fresh `@plan` task with updated acceptance

### Error States
- Duplicate PO number → "PO number already exists."
- Delivery address empty when pickup-only = false → "Delivery address is required unless pickup-only."
- ~~Quantity < 1 → "Quantity must be at least 1."~~ — **SUPERSEDED by D15 / Feature 9 (2026-04-24):** All 6 quantity cells = 0 → "At least one quantity is required."
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

## Feature 9: PO Multi-Combo Restructure

### Problem Statement
Real-world purchase orders contain any combination of the 6 size×type tote options (275 or 330 gal × Reconditioned, Rebottled, or Brand New). Most POs include 2–3 combos. The current single-combo model forces the salesperson to either fragment one real PO into multiple app POs (corrupting customer-level frequency, last-sale, and volume analytics) or to lose data fidelity by entering only one combo. Daily friction that compounds — every multi-combo PO entered today degrades downstream analytics tomorrow.

### User Story
As the salesperson, I want to enter a PO with any mix of the 6 size×type combos in a single record, so my data matches reality and downstream analytics (contact frequency, volume averages, invoice totals) are accurate.

### User Flow

**Creating a new PO:**
1. Open New PO form (entry points unchanged: + New Order button, Quick-Add FAB → Add Purchase Order)
2. Enter PO number, customer, delivery date (optional), pickup/backhaul flags, address, notes — same as today
3. Fill quantities for any subset of the 6 combos in a 2×3 grid (rows: 275 gal / 330 gal; columns: Reconditioned / Rebottled / Brand New). Empty cells = 0.
4. Enter total PO price (user-entered single value, unchanged)
5. Save — at least one cell must be > 0

**Orders table row:**
PO# | Customer | 275 | 330 | Status | Req Date | Price | B (compact backhaul tag, only when true)
- Empty size totals render as `—`
- Type column and Qty/Size column removed

**PO detail view:**
- Header: PO#, Customer, Status badge
- 2×3 mix grid (same component as Customer Volume Overview) — cells show actual quantities, `—` for empty
- Total price displayed prominently
- All other fields unchanged (delivery date, pickup-only, address, backhaul, notes)
- Action buttons unchanged (Mark as Complete, Cancel Order, Revert to Scheduled, Edit) — subject to edit lock

**Editing a PO:**
- Same 2×3 grid as the new PO form
- Edit lock by status: `scheduled` and `completed` permit quantity + price edits; `invoiced` and `cancelled` block both. Invoiced corrections require revert-to-scheduled first (existing FB-08 flow).

### Business Logic
- **Schema change:** drop `container_size`, `container_type`, `quantity` from `orders`. Add 6 columns: `qty_275_recon`, `qty_275_rebot`, `qty_275_new`, `qty_330_recon`, `qty_330_rebot`, `qty_330_new` (integer, NOT NULL, default 0). Keep existing `price` column unchanged (user-entered total).
- **Validation:** sum of all 6 qty cells must be > 0; each cell ≥ 0. Enforced both client-side (Zod + inline error) and server-side (Zod in `createOrder` / `updateOrder`).
- **Backfill migration:** for each existing order row, set the matching `qty_size_type` column to the prior `quantity`; the other 5 columns = 0. Legacy 3 columns dropped after backfill.
- **Completion semantics:** Mark Complete remains atomic at PO level. All combos in a PO ship together. No per-combo state.
- **Display consistency:** `275 | 330` totals pattern + compact `B` backhaul tag used in all 4 PO list surfaces — orders table, dashboard Open Orders widget, customer Order History rows, invoice detail PO rows.
- **Customer Volume Overview formula:** unchanged — "average qty per PO that included this combo." Multiple combos per PO now contribute to multiple averages, which is correct under the new model.

### Acceptance Criteria
- [ ] Migration adds 6 qty columns, drops the 3 legacy columns, backfills existing rows lossless
- [ ] New PO form renders 2×3 quantity grid + total price field + existing fields
- [ ] Saving a PO with all 6 cells = 0 fails client-side AND server-side with a clear error
- [ ] Saving a PO with at least one cell > 0 succeeds
- [ ] PO detail shows 2×3 mix grid with actual quantities, `—` for empty cells
- [ ] Orders table shows `275 | 330` totals + `B` tag, no Type / Qty/Size columns
- [ ] Empty size totals in any list surface render as `—`
- [ ] Editing a `scheduled` or `completed` PO permits quantity + price changes
- [ ] Editing an `invoiced` or `cancelled` PO blocks quantity + price changes
- [ ] Customer Volume Overview displays correct averages under the new schema
- [ ] Dashboard Open Orders widget, Customer Order History, and Invoice detail PO rows all use the `275 | 330` totals pattern
- [ ] Existing single-combo POs post-migration display correctly (one cell populated, rest `—`)

### Edge Cases
- **PO with one combo only** — valid. Displays `275: 25 | 330: —` (or vice versa).
- **PO with one whole size = 0** — that size column renders `—`.
- **Existing single-combo PO post-migration** — visually indistinguishable from a new PO with one cell filled.
- **Edit attempt on invoiced PO** — blocked at action layer with a message pointing to revert-to-scheduled.
- **Reverting an invoiced PO via FB-08** — PO returns to scheduled with quantities intact and editable.

### Out of Scope
- OCR / PDF upload (deferred — separate decision)
- PO carry-over / "Duplicate this PO" (rejected — adds delete-friction in the form)
- Per-combo unit pricing (rejected in v1 — **superseded by Feature 10**)
- Settings / global pricing table (rejected)
- Per-PO unit price overrides (total override still rejected; per-combo unit prices added in **Feature 10**)
- Per-combo state machine / partial fulfillment (rejected — atomic PO completion only)
- Retroactive merging of historical single-combo POs into multi-combo POs (manual user action only if desired)
- Sortable columns on the orders table (none today, none added)

### Success Metric
- Salesperson stops creating duplicate POs to represent a single real-world PO
- Customer Volume Overview averages reflect actual purchase mix
- New PO entry time stays within 30 seconds for typical 2-combo POs

---

## Feature 10: PO Per-Combo Unit Pricing

> Supersedes Feature 9's "user-entered total" pricing. `price` is now derived, not typed.

### Problem Statement
F9 tracks quantities per combo but prices the whole PO as one hand-keyed total, so per-tote economics are invisible and totals are error-prone.

### User Story
As the salesperson, I want a unit price per combo so the PO total auto-calculates and I can see what each tote type costs.

### User Flow
- **New/Edit PO:** each of the 6 grid cells takes a quantity **and** a unit price ($). Total Price is read-only, live-calculated as Σ(qty × unit price).
- **PO detail:** each filled cell shows `qty / $unit` (e.g. `60 / $105`); empty cells show `—`. Total price displayed as today.

### Business Logic
- **Schema:** add 6 nullable `numeric(10,2)` columns `unit_price_{275,330}_{recon,rebot,new}`. `price` retained as the **derived** total (no longer user-entered).
- **Derivation:** `price = Σ(qty × unit price)`; total is not manually editable.
- **Unit price rules:** required and > 0 when its qty > 0; NULL when qty = 0.
- **Edit lock:** unit-price edits follow F9's status lock (`scheduled`/`completed` editable; `invoiced`/`cancelled` blocked).
- **Backfill (done 2026-07-25):** legacy `price` was a unit price → set on the single non-zero combo, `price` recomputed to qty × unit. Multi-combo/zero-qty orders skipped for manual entry (1: `MAn00003239`).

### Acceptance Criteria
- [ ] Schema adds 6 nullable unit-price columns
- [ ] Form shows a unit-price input per combo cell; Total Price is read-only and live-calculates Σ(qty × unit price)
- [ ] Saving with qty > 0 and unit price blank or ≤ 0 fails client- and server-side with a clear error
- [ ] Unit price persists only where qty > 0; qty = 0 stores NULL
- [ ] Server computes/stores `price`; client-sent totals ignored
- [ ] PO detail shows `qty / $unit` for filled cells, `—` for empty
- [ ] Editing an `invoiced`/`cancelled` PO blocks unit-price changes

### Edge Cases
- **qty > 0, unit price blank** → validation error (both layers).
- **qty = 0 with unit price entered** → cleared to NULL on save.
- **Multi-combo legacy order (`MAn00003239`)** → unit prices NULL; filled manually.

### Out of Scope
- Manual total override (rejected — total is strictly derived)
- Auto-assigning unit prices to multi-combo legacy orders (manual only)

### Success Metric
Salesperson never hand-keys totals; PO total always equals Σ(qty × unit price).

---

## Feature 11: Production Calendar

### Problem Statement
Orders carry only `requested_delivery_date` — a customer-facing promise, not a build instruction. Deciding which orders the production team builds on which day happens entirely outside the app, so the schedule lives in one person's head and the floor works from verbal direction.

### User Story
As the production director, I want a weekday calendar of active orders positioned on their build day, with drag-and-drop to move and sequence them, so the production team knows exactly what to build each day without me telling them.

### User Flow
1. Nav drawer → **Calendar** (`/calendar`). Opens on the current week.
2. Each Mon–Fri column lists that day's order cards, top-to-bottom in build sequence.
3. Drag a card to another day → sets its `production_date`. Drag within a day → sets its build sequence.
4. Click a card → read-only popup with full PO details, a same-day-delivery toggle, and `Remove from calendar`.
5. Top-right callout shows the count of active orders that have no date at all. Click → dropdown of those cards; drag one onto a day to schedule it, or drag a card back onto the callout to clear its date.
6. Hover a day column (or always, on touch) → `+ Add order` listing the same undated orders; pick one to place it on that day.
7. Scroll horizontally for past/future weeks; **Current week** returns to today's week.

### Business Logic

**Schema** (migration `0010`) — 3 new columns on `orders`:

| Column | Type | Purpose |
|---|---|---|
| `production_date` | `date` NULL | Explicit build day. Written only by the calendar. |
| `same_day_delivery` | `boolean NOT NULL DEFAULT false` | Visual marker; toggled only from the calendar popup. |
| `production_sort_index` | `integer` NULL | Build sequence within a day. |

**Positioning** — a card's column **is** its `production_date`. Nothing is derived at read time. An order with no production date is not on the calendar; it sits in the unscheduled callout, whatever its delivery date. The delivery date seeds `production_date` **once**, at order creation (`prevBusinessDay(requested_delivery_date)`), so new POs appear without being dragged in.

**`prevBusinessDay(d)`** — the last Mon–Fri strictly before `d`. Sat, Sun, and Mon delivery dates all resolve to the prior Friday. Weekends only; holidays are not modelled.

**Invariant** — no production date ever falls on a weekend. There are no Sat/Sun columns and nothing can be dropped there.

**Delivery date is never written by this feature.** `requested_delivery_date` remains editable only in the Orders tab. Once `production_date` is explicitly set, later changes to `requested_delivery_date` do not move the card and produce no warning.

**Eligibility** — `status <> 'cancelled'`. `completed` and `invoiced` cards render dimmed, are not draggable, and keep their `production_sort_index` slot interleaved with scheduled cards.

**Unscheduled set** — `status <> 'cancelled' AND production_date IS NULL`. This is the single source for the top-right callout, its dropdown, and every per-day `+` list.

**Drag semantics** — a drop writes `production_date` and `production_sort_index` in one action. Cards land at the exact index released, not appended. Mutations go through a server action + `revalidatePath` per the existing pattern; no optimistic-only state.

**Cross-week dragging** — while a drag is active, holding the card within ~80px of either edge of the scroll strip auto-scrolls it continuously (speed proportional to edge proximity), so a card can be carried into any week without dropping it first. Provided by `@dnd-kit`'s auto-scroll activator.

**Dragging back to unscheduled** — the callout and its dropdown are also a drop target. Dropping a card there clears `production_date` and `production_sort_index`, identically to the popup's `Remove from calendar`, and the order **stays** in the dropdown until someone gives it a build day. A delivery date does not pull it back onto the calendar: the two dates are separate, and production may legitimately fall after delivery when work slips. A delivery date can therefore move under a placed card unnoticed, in either direction, and nothing flags it. Accepted: the calendar is reviewed daily and production scheduling is a deliberate act, so a stale build day surfaces in normal use.

**Card anatomy** — no tag rail. Top line: PO number (muted) with the `B` (backhaul) and `SD` (same-day) tags right-aligned on the same line. Then customer name (always 2 lines tall, truncated past that), product mix (always 2 lines tall), and `requested_delivery_date` bottom-right (`—` when NULL). `B` reuses the existing circular `BackhaulTag`; `SD` is a two-character `rounded-md` pill in the `bg-amber-100 / text-amber-800` pair already used by the Leads widget.

**Product mix string** — `{qty}×{size} {CODE}`, comma-separated, where `CODE` is `REC` (recon), `REB` (rebot), `NEW`. Max 4 combos across 2 lines; a 5th or 6th becomes `+N more`. Full mix is visible in the popup. Unit prices never appear on the card — the card is a build instruction, not a commercial document.

**Popup** — reuses the `CancelOrderDialog` shell (`bg-card rounded-xl shadow-lg max-w-md p-6`). Read-only apart from the same-day toggle. The mix grid is `<QtyGrid mode="display">` **with `unitPrices` supplied**, so filled cells render `qty / $unit` exactly as PO detail does since Feature 10, plus the derived `price` total. Editing any order field remains exclusive to the Orders tab; the footer offers `Open in Orders` rather than a save action.

**The page never scrolls as a page.** The screen is exactly one viewport tall — `h-[calc(100vh-0.75rem)]` with `overflow-hidden`, the same idiom `OrderLayout` already uses — and only the horizontal strip and individual day columns scroll. This holds on every supported device.

**Layout** — 176px weekday columns. Five columns plus four gaps, the 80px pill gutter, and 16px of right padding total 1008px, so a full Mon–Fri fits inside iPad landscape's 1024px. Continuous smooth horizontal scroll (not week-snapped), with a 2px rule at every Fri│Mon boundary and a week-range label above each week's own columns. Today's column header is filled with `bg-primary`. `Current week` scrolls to the Mon–Fri week containing today; on Sat/Sun it targets the next Mon–Fri. Both the strip and each column must render a visible scrollbar — overlay scrollbars hide the fact that they scroll at all. Day column headers show weekday and date only, with no order count.

**Card height scales to the viewport; the visible count does not.** The target is fixed — **4 cards always visible without scrolling** — and the card shrinks to honour it: `--card-h: clamp(80px, calc(25vh - 70px), 104px)`, derived from `(viewportHeight − 281px) ÷ 4` where 281px is the fixed chrome above and below the stack. That yields 104px from ~700px of viewport height upward, 92px at 650px, and 80px at 600px. Every other card metric (padding, the four row heights, and their font sizes) interpolates linearly between the 80px floor and the 104px ceiling, so the rows always sum to exactly `--card-h` and all cards stay uniform at any size.

**Two floors, in priority order.** Below ~600px of viewport height the 80px card floor holds rather than shrinking further, because the product-mix line reaches ~10px and stops being readable on a shop floor; the column scrolls instead and fewer than 4 are visible. The page still never scrolls. Priority is therefore: never scroll the page → keep text legible → show 4 cards.

**Per-day `+`** — sits in the column footer, in the same slot and `text-primary` link style as the widgets' "View all". Hidden until column hover **only** on devices matching `(hover: hover) and (pointer: fine)`; always visible otherwise, so it is permanently present on iPad and any touch device.

**Dashboard widget** — the next 2 business days as **two side-by-side columns**, up to **4 rows each** (an 8-order snapshot), plus the unscheduled count and a link to `/calendar`. Column widths and the widget's outer height match the neighbouring dashboard widgets. Each column is headed with the **real weekday and date** — `Today` / `Tomorrow` are deliberately not used, because the label would hold for at most one column and on a Friday or weekend for neither. Friday shows Fri + Mon; Sat/Sun shows Mon + Tue. Rows put the `B` / `SD` tags immediately after the customer name, mirroring how Open Orders places them after the PO number; long customer names truncate. Revised 2026-07-27 after the first visual review — the original stacked single-column list read as one continuous list with no clear break between the two days.

**Drag-and-drop** — `@dnd-kit/core` + `@dnd-kit/sortable`, **desktop mouse and keyboard only**. Touch drag was cut after failing on a real iPad (A-05 contingency fired 2026-07-27). On touch devices a ≈350ms still-finger long-press instead **arms** the card (shake + bold outline), and a tap then places it: tap another card to insert at its position (cards below shift down), tap empty column space to append to that day, tap the unscheduled callout to unschedule, tap anything else — including the armed card — to cancel. The strip stays freely scrollable while armed, so any week is reachable before placing. A plain tap still opens the popup; a swipe still scrolls. Spec: Feature 13, Task 68. All drag/arm affordances respect `useReducedMotion()`. `@dnd-kit` is client-only and therefore falls under CONSTRAINT-03 alongside `framer-motion` and `recharts`.

### Acceptance Criteria
- [ ] Migration `0010` adds the 3 columns; existing rows get `production_date` NULL, `same_day_delivery` false, `production_sort_index` NULL
- [ ] `/calendar` renders 5 weekday columns and opens scrolled to the current week
- [ ] An order with a delivery date and no production date appears on `prevBusinessDay(delivery_date)`
- [ ] Mon, Sat, and Sun delivery dates all place the card on the prior Friday
- [ ] Dragging a card to another day writes `production_date` and leaves `requested_delivery_date` unchanged
- [ ] Dragging within a day persists the new sequence across a page reload
- [ ] `completed` and `invoiced` cards render dimmed and cannot be dragged
- [ ] `cancelled` orders never appear on the calendar or in any undated list
- [ ] Card shows PO#, customer (≤2 lines, truncated), ≤4 combos over 2 lines with `+N more`, and delivery date or `—`
- [ ] Every card renders at an identical height regardless of name length or combo count
- [ ] The `/calendar` page never scrolls vertically as a page at any tested size (1440×900, 1280×720, 1024×768, 1280×620)
- [ ] A full Mon–Fri is visible without horizontal scrolling at 1024px wide
- [ ] 4 whole cards are visible without scrolling at every viewport height down to 600px, the card shrinking as needed
- [ ] Card height never drops below 80px; below 600px viewport height the column scrolls rather than shrinking further
- [ ] Day column header shows weekday and date only — no order count
- [ ] Past days render identically to future days and accept drops
- [ ] A column holding more cards than fit scrolls vertically, with a visible scrollbar
- [ ] The week strip scrolls horizontally across at least several weeks either side of today, with a visible scrollbar
- [ ] Holding a dragged card near either edge of the strip auto-scrolls it, allowing a drop into a different week without releasing
- [ ] Clicking a card opens a read-only popup; no field on it can edit the order
- [ ] The popup mix grid renders `qty / $unit` for filled cells and the derived total, matching PO detail
- [ ] The popup's same-day toggle persists `same_day_delivery` and the card's `SD` tag reflects it
- [ ] `Remove from calendar` clears both production columns
- [ ] Dropping a card onto the unscheduled callout or its dropdown clears `production_date` and `production_sort_index`
- [ ] Top-right callout count equals the unscheduled set and drops by one when such an order is placed
- [ ] Dragging a card out of the callout dropdown onto a day sets its `production_date`
- [ ] Callout dropdown shows 4 cards then scrolls
- [ ] Per-day `+` lists exactly the unscheduled set and is permanently visible on touch devices
- [ ] `Current week` returns to today's week; on Sat/Sun it lands on the next Mon–Fri
- [ ] Week-range labels and Fri│Mon dividers make the week boundary unambiguous while free-scrolling
- [ ] Dashboard widget shows the next 2 business days, ≤3 rows each, plus the unscheduled count
- [ ] ~~Touch drag works on a tablet without hijacking horizontal scroll~~ **Superseded 2026-07-27:** touch drag failed on a real iPad (A-05); touch now uses long-press-to-arm + tap-to-place — acceptance moved to Task 68
- [ ] Nav drawer shows **Calendar** between Orders and Leads with correct active state

### Edge Cases
- **No delivery date and no production date** — not on the calendar; lives in the callout only.
- **Production date set but delivery date NULL** — valid. Card sits on its production date with `—` as the delivery date.
- **Delivery date changed after an explicit drag** — card stays put, silently. Only the printed delivery date updates.
- **Production date on or after the delivery date** — allowed, unflagged.
- **Undated order marked complete** — `CONSTRAINT-16` stamps `requested_delivery_date`, but production placement is untouched: the order stays in the unscheduled callout until someone gives it a build day. Accepted.
- **`Remove from calendar` on a dated order** — the card leaves the calendar and appears in the unscheduled callout, whatever its delivery date.
- **More than 4 cards in a day** — column scrolls vertically; the day header and footer stay fixed.
- **6-combo order** — 4 combos shown plus `+2 more`; full mix in the popup.
- **Order with NULL unit prices** (legacy multi-combo, per Feature 10) — popup grid falls back to bare quantities for those cells; the card is unaffected since it never shows prices.
- **Customer name longer than 2 lines** — truncated with an ellipsis; full name in the popup.
- **Weekend visit** — calendar still opens on the current Mon–Fri week; `Current week` targets the next one.
- **Viewport shorter than 600px** — card stays at its 80px floor, fewer than 4 are visible, column scrolls. Page still does not scroll.
- **Scrolled into the past** — past columns look identical to future ones and accept drops; nothing is blocked or dimmed by date.

### Out of Scope
- Holiday calendar / non-working-day configuration
- Late-build warnings or any validation of production date against delivery date
- Flagging cards whose delivery date changed after placement
- Phone layout (desktop + tablet only)
- Editing any order field from the calendar, including unit prices
- Creating a new order from the calendar
- Per-combo or partial production tracking, and any "in progress" state
- Capacity limits, per-day tote totals, or load balancing
- Multi-user realtime sync (follows the existing revalidate-on-mutation model)
- Month view, day view, printing, or external calendar export

### Success Metric
- Production sequence lives in the app rather than in verbal direction
- Every active order is either placed on a day or visibly counted as unscheduled — none invisible
- Reordering a week takes seconds, without touching the Orders tab

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
| D15 | PO multi-combo restructure (2026-04-24) → Feature 9 | Single-combo PO model replaced with 6-quantity wide-row schema. Drop `container_size`, `container_type`, `quantity` columns; add 6 typed quantity columns (`qty_275_recon`, `qty_275_rebot`, `qty_275_new`, `qty_330_recon`, `qty_330_rebot`, `qty_330_new`). Total `price` stays as user-entered single value (no per-unit pricing, no settings, no per-PO overrides). Mark Complete remains atomic at PO level. New 2×3 grid display in PO detail (reuses Customer Volume Overview component); orders table shows `275` / `330` totals + compact `B` backhaul tag. Edit lock: `scheduled`/`completed` editable; `invoiced`/`cancelled` locked. Affects Feature 4 (Order Table, Detail Panel, Form, Error States) |
| D16 | Production Calendar (2026-07-26) → Feature 11, CONSTRAINT-19 | Build day is a **separate** concept from the customer promise: new nullable `production_date` column, never `requested_delivery_date`. Default position = `prevBusinessDay(requested_delivery_date)` (Mon/Sat/Sun → prior Friday); weekends-only business-day math, no holiday calendar. Mon–Fri 176px columns sized so a full work week fits iPad landscape; page never scrolls, card height scales via `clamp()` to keep 4 visible. All non-cancelled orders shown; `completed`/`invoiced` dimmed and locked. Manual intra-day sequence persisted in `production_sort_index`. New `same_day_delivery` boolean toggled only from a read-only calendar popup — order editing stays exclusive to the Orders tab. Orders with neither date surfaced via a top-right unscheduled callout that doubles as a drop target. `@dnd-kit/core` + `@dnd-kit/sortable` added (approved by Builder without `@cto` review); desktop + tablet only. Migration `0010` |
| D17 | Dashboard revenue metric (2026-07-29) → FB-18 | "Total Invoiced" hero card + invoice trend chart replaced by **"Total Revenue"**: `SUM(orders.price)` over all non-cancelled orders (bookings semantics — scheduled orders count), month-bucketed by `COALESCE(production_date, requested_delivery_date, created_at)`, recomputed at query time so production-date edits re-bucket. `InvoiceChart` → `RevenueChart`. Invoiced totals no longer shown anywhere on the dashboard |

---

## Feature 12: Orders List Ergonomics + Calendar Write Surface

> Two independent changes shipped together on 2026-07-27 (Tasks 61–67). Revises Feature 11's read-only calendar and Feature 4's paginated orders list.

### Problem Statement
Two frictions, one on each screen. The orders list paginated at 20 rows with no way to find a specific PO, so locating one meant clicking through pages. And the production calendar could only *move* orders — creating one, or marking it complete, meant leaving the planning screen for the Orders tab and losing the week in view.

### User Story
As the salesperson, I want to find any PO instantly, and to plan a whole week — creating, completing and cancelling orders — without leaving the calendar.

### User Flow
- **Orders list:** no pagination. Every PO for the active status tab renders in one scroll. A search box sits beside the status tabs; typing filters by PO number or customer name.
- **Calendar — new order:** a day's `+ Add order` menu offers **Add Purchase Order** above the unscheduled list. Choosing it opens the standard new-order form in a right drawer, over the calendar. On save the card appears on that day.
- **Calendar — card popup:** two pill toggles at the top (Backhaul, Same-day delivery), and below them the same status block as the Orders tab — Mark as Complete and Cancel Order on a scheduled PO, Revert to Scheduled otherwise.
- **Calendar — at a glance:** completed and invoiced cards sit on a grey background, clearly distinct from active ones. The dashboard production widget matches.

### Business Logic
- **Search:** case-insensitive partial match on `po_number` OR customer `company_name`, ANDed with the active status tab. URL-driven (`?search=`) like the customers tab, debounced 250ms because the result set is now unbounded.
- **Day wins over delivery date:** a PO created from a day column takes that day as its `production_date`, whatever delivery date the form carries. Clicking a day is a deliberate placement and outranks the creation-time default (CONSTRAINT-19). Weekends are rejected on write.
- **What the calendar still cannot edit:** quantities, prices, customer, address, notes, and `requested_delivery_date`. Those stay Orders-tab only.
- **Cancel is one-way from the calendar.** The calendar excludes cancelled orders, so the card leaves the board and the popup closes. Reverting requires the Orders tab. Completing is not one-way — the card dims in place and can be reverted from the popup.
- **Flag toggles are permitted on invoiced/cancelled orders** — CONSTRAINT-18's edit lock covers only quantity and price.

### Acceptance Criteria
- [x] Orders list shows every PO for the tab in one scroll; no pagination controls
- [x] Search matches PO number or customer name, combines with the status tab, and survives tab switches and row selection
- [x] "Add Purchase Order" creates an order on the clicked day without leaving `/calendar`
- [x] Backhaul and same-day toggles persist and survive a reload
- [x] Status transitions work from the popup and match the Orders tab exactly
- [x] Cancelling removes the card and closes the popup
- [x] Completed/invoiced orders are visually distinct on both the calendar and the dashboard widget
- [x] `/calendar` still never scrolls as a page; the drawer scrolls internally
- [x] **Browser-verified on the iPad** — confirmed by the builder 2026-07-27

---

## Feature 14: Multiple Saved Delivery Addresses per Customer

> Numbered 14 because "Feature 13" (long-press-to-arm calendar drag, Task 68) shipped without a PRD heading — that number is retired to avoid collision. Revises Feature 4's single `default_delivery_address` autofill.

### Problem Statement
Customers ship to more than one address, but only one `default_delivery_address` exists per customer — every other address is re-typed by hand on each order.

### User Story
As the salesperson, I want each customer's addresses saved and selectable so I pick from a dropdown instead of typing addresses repeatedly.

### User Flow
1. **New order:** pick customer → address dropdown appears below, listing that customer's saved addresses with the most-recently-used pre-selected → or **+ Add new address** reveals a textarea; on save the address is stored to the customer *and* used for the order.
2. **Customer detail panel:** new "Delivery Addresses" section — list with inline add / edit / delete (delete confirms first).

### Business Logic
- New `customer_addresses` table (`customer_id` FK cascade, `address` text, `last_used_at`); existing `default_delivery_address` values backfilled as each customer's first row; the column is deprecated — app code stops reading/writing it; the DB drop is deferred to a later migration (CONSTRAINT-20 caution).
- Orders keep storing `delivery_address` as a **text snapshot** — editing or deleting a saved address never rewrites order history.
- MRU: `createOrder` bumps `last_used_at` on the chosen address; the dropdown sorts `last_used_at` desc (nulls last), pre-selecting the top entry.
- Dedupe: submitting an address text that exactly matches an existing saved row for that customer bumps that row instead of inserting a duplicate.

### Acceptance Criteria
- [x] Picking a customer with saved addresses pre-selects the MRU address — no typing needed
- [x] "+ Add new address" on the order form persists the address to the customer and uses it for the order
- [x] Customer detail panel lists addresses with working add/edit/delete
- [x] Editing/deleting a saved address leaves past orders' `delivery_address` untouched
- [x] `default_delivery_address` no longer rendered or written anywhere in app code
- [x] **Browser-verified on the iPad** — confirmed by the builder 2026-07-28

### Edge Cases
- **Customer with zero saved addresses** → dropdown shows only "+ Add new address".
- **Edit-order mode** → current snapshot displayed even if it matches no saved row; resubmitting it saves it to the list (organic backfill via dedupe rules).
- **Deleting an address** → past orders unaffected (snapshot design).

### Out of Scope
- Pickup flow changes (next feature)
- Address entry on the create-customer form (add via detail panel or order form instead)
- Dropping the deprecated `default_delivery_address` column (later migration)

### Success Metric
No address is ever typed twice for the same customer.
