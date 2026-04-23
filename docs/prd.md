# Product Requirements Document: ToteTrack

**Date:** 2026-04-20
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
- Global top bar: hamburger (left), ToteTrack logo, search bar, notification bell, avatar (right)
- Page title: "Command Overview" / subtitle: "Real-time logistics matrix."
- Top-right: Monthly | Yearly pill toggle (default: Monthly)
- Row 1: Two hero cards (equal width)
- Row 2: Need-to-Contact (left 50%) + Pending Orders (right 50%)
- Row 3: Invoice Trend Chart (full width)
- Row 4: Leads to Follow Up (full width)

### Hero Cards (period toggle affects these only)
**Left — TOTAL INVOICED:**
- Monthly: sum of invoice `total_amount` for current calendar month
- Yearly: sum of invoice `total_amount` for current calendar year (YTD)
- Delta badge: `((current - prior) / prior) * 100` — green if positive, red-orange if negative; "—" if no prior data
- Label: "vs. [Prior Month]" or "vs. [Prior Year]"

**Right — PURCHASE ORDERS:**
- Always current counts (not time-filtered)
- Large: pending PO count. Smaller: scheduled PO count
- Arrow button → navigates to `/orders`

### Need-to-Contact Widget
- Top 5 most overdue customers (see cross-cutting: Need-to-Contact Logic)
- Row: teal avatar circle (initials), company name, "X days overdue" badge (red-orange)
- Only customers with ≥2 completed orders OR a manual frequency override
- Empty state: "No customers need contact right now."
- Click row → `/customers?id=[customerId]`

### Pending Orders Widget
- All orders with status = "pending"
- Sort: backhaul=true pinned to top (BACKHAUL badge, teal), then by `requested_delivery_date` ASC within each group
- Up to 5 rows; "View all" → `/orders?status=pending`
- Row: PO number, customer name, BACKHAUL badge (if applicable), requested delivery date
- Empty state: "No pending orders."

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
- Monthly/Yearly toggle affects hero cards only — not chart, Need-to-Contact, Leads, or Pending Orders
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
- **Order History tabs:** 1M | 3M | 6M | 1Y | YTD — windows: 30d / 90d / 180d / 365d / Jan 1 to today; table: PO#, date, qty, size, type, status badge, price; sorted by `requested_delivery_date DESC`
- **Volume Overview:** average totes per completed PO by size (275/330) and type (Rebottled/Reconditioned/Brand New) as progress bars — see Feature: Volume Overview

### New Customer Form (modal)
Required: company name, primary contact (name + at least one of email/phone)
Optional: role, additional contacts (max 5 total), contact frequency override (days), notes, status (Active default)

### Edit Customer Form
Same fields, pre-filled; "Add another contact" adds additional contact rows; "Delete customer" button (confirmation required)

### Error States
- Company name empty → "Company name is required."
- No email AND no phone on primary contact → "At least one email or phone is required."
- Delete customer with scheduled/pending orders → "Cannot delete a customer with active orders. Cancel or complete all orders first."

### Exclusions
- No bulk import
- No duplicate merge
- No customer activity log beyond order history

---

## Feature 4: Orders

### Layout
Two-panel: order table (left ~40%) + order detail (right ~60%)

### Order Table (left)
- Filter tabs: All | Scheduled | Pending | Completed | Cancelled | Invoiced
- Columns: PO#, Customer (avatar initial + name), Qty/Size, Type badge, Status badge, Req. Date, Price
- BACKHAUL badge (teal) on rows where `backhaul = true`
- Type badge colors: Rebottled = blue-tinted, Reconditioned = teal-tinted, Brand New = dark/inverted
- Default sort: scheduled/pending first (req date ASC), then completed/cancelled/invoiced (req date DESC)
- Pagination: 20 rows/page; "Showing X–Y of Z orders"
- "+ New Order" button top right → OrderForm
- Click row → URL `/orders?id=[uuid]`, right panel loads

### Order Detail Panel (right)
- No order selected → "Select an order to view details."
- All fields: PO#, customer (linked), status badge, container size, container type, quantity, price, pickup-only (Y/N), delivery address (hidden if pickup-only = true), requested delivery date, backhaul (Y/N), notes
- Status section → OrderStatusActions component (see state machine)
- Document section → PODocumentUpload component

### New/Edit Order Form
Fields: PO number (manual, unique), customer (searchable dropdown), container size (275 | 330), container type, quantity, price, pickup-only checkbox, delivery address (conditional), requested delivery date, backhaul checkbox, initial status (Scheduled default | Pending), notes, PO document (optional)

### PO Document Upload
- Upload zone: PDF/PNG/JPG, max 10MB
- Uploaded file shown as filename + "Download" link (signed URL, 1hr expiry)
- Replacing file: upsert (old overwritten)

### Error States
- Duplicate PO number → "PO number already exists."
- Delivery address empty when pickup-only = false → "Delivery address is required unless pickup-only."
- Quantity < 1 → "Quantity must be at least 1."
- Price ≤ 0 → "Price must be greater than $0."
- File > 10MB → "File too large. Maximum 10MB allowed."
- Wrong file type → "Only PDF, PNG, and JPG files are accepted."

### Exclusions
- No auto-generated PO numbers
- "Invoiced" status not manually selectable
- No bulk status update
- No supplier fields

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

### Layout
Two-panel: Generate Invoice (left ~45%) + Invoice Ledger (right ~55%)

### Generate Invoice Panel (left)
- Billing month picker: month + year, default current month
- Customer selector: "All Customers" (default) OR specific customer from dropdown
- Table auto-populates: all orders with status='completed' AND `invoice_id IS NULL` AND `requested_delivery_date` in selected month
- Table columns: ☐ | PO# | Customer | Qty + Size + Type | Price — all rows pre-checked
- Unchecking rows updates "Draft Total: $X,XXX.XX" in real-time
- "Create Invoice" button: disabled when 0 rows selected
- No eligible orders → "No completed orders for this period." (no button shown)

### Invoice Ledger Panel (right)
- Filter pills: All | Draft | Paid; sort: `billing_month DESC`
- Table: Invoice # | Period (Month YYYY) | Customer (or "All Customers") | Amount | Status badge
- Status: Draft (gray), Paid (teal)
- Click row → detail view: read-only PO rows + total + status + "Mark as Paid" (draft only)
- Empty state: "No invoices generated yet."

### Invoice Creation Logic (atomic)
1. Validate all selected orders are completed + uninvoiced
2. Sum total amount
3. Auto-generate invoice number: INV-0001, INV-0002... (global sequence)
4. Insert invoice record (status = 'draft')
5. Set all selected orders: status = 'invoiced', invoice_id = new invoice id

### Error States
- No billing month selected → "Select a billing month to continue."
- Zero POs selected → "Create Invoice" button disabled
- Any order already invoiced → "Order [PO#] is already invoiced." (blocks entire operation)

### Exclusions
- No PDF export
- No email delivery
- No editing of saved invoice records
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

## Cross-cutting: Need-to-Contact Logic

### Calculation
- **Auto-calculated frequency** (requires ≥2 completed orders):
  - Average of all consecutive intervals between completed order dates, in days
- **Manual override:** `customers.contact_frequency_days` — overrides auto-calc when set
- **Effective frequency:** `COALESCE(manual_override, auto_calculated)`
- **Overdue days:** `(today − last_completed_order_date) − effective_frequency_days`
  - Positive = overdue; negative = not yet due

### Eligibility
- status = 'active' AND (manual override set OR ≥2 completed orders)
- Customers with 0 or 1 completed orders and no override: excluded
- Inactive customers: excluded

### Sort
Overdue days descending (most overdue first). Used in: dashboard Need-to-Contact widget (top 5) and customer list "Need-to-Contact" sort option.

---

## Cross-cutting: PO Status State Machine

```
[Created] → scheduled
scheduled → pending        (manual: "Mark as Pending" button)
pending   → completed      (manual: "Mark as Complete" button)
pending   → cancelled      (manual: "Cancel Order" + confirmation)
completed → invoiced       (automatic: set when invoice includes this PO)
```

- Terminal states: completed, cancelled, invoiced — no further transitions
- 'invoiced' is auto-set only — not manually selectable
- Backward transitions are invalid and rejected server-side

---

## Decisions Log

| # | Decision | Resolution |
|---|----------|-----------|
| D1 | Session duration | Supabase default (1hr access token, rolling refresh) |
| D2 | Orders screen layout | Two-panel (list left, detail right) — matches Customers pattern |
| D3 | PO status transition UX | Labeled action buttons (not dropdown) |
| D4 | Lead source field | Freeform text input |
| D5 | Invoice — which POs shown | Completed POs only, not yet invoiced, within selected month |
| D6 | Invoice statuses | Draft + Paid only ("Sent" excluded — no send capability) |
| D7 | Developer ticket access | Supabase dashboard directly (no developer UI in app) |
| D8 | Purchase frequency unit | Days |
| D9 | Container sizes/types | Fixed enums — 275/330 gal, Rebottled/Reconditioned/Brand New |
