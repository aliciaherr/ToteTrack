# API Spec: ToteTrack

**Date:** 2026-04-20
**Status:** Approved — Phase 2 complete

> All operations are TypeScript functions — not HTTP endpoints.
> **Queries** (in `db/queries/`) are read-only, called from server components or server actions.
> **Actions** (in `lib/actions/`) are Server Actions, called from client components for mutations.
> All actions validate inputs with Zod server-side before any DB operation.

---

## Auth

### `signIn`
**File:** `lib/actions/auth.ts` | **Type:** Server Action
```ts
signIn(password: string): Promise<{ error: string | null }>
```
Calls `supabase.auth.signInWithPassword({ email: process.env.ADMIN_EMAIL, password })`.
On success: session cookie set, `redirect('/dashboard')`.
**Errors:** Wrong password → `{ error: "Incorrect password. Please try again." }` | Network error → `{ error: "Unable to connect..." }`

> ⚠ **The `redirect()` is load-bearing. Do not replace it with a client-side `router.push`.**
>
> This was attempted on 2026-07-27 and took production login down. The reasoning
> was that a Server Action `redirect()` "works by throwing", so the throw would
> reject the promise awaited in `LoginForm` and leave the button stuck. That is
> **not** how the App Router behaves: Next catches `NEXT_REDIRECT` at the action
> boundary and returns a redirect the client router executes. The promise does
> not reject.
>
> The replacement (`router.push('/dashboard')` in `LoginForm`) also dropped the
> only `setLoading(false)` on the success path, so when the navigation failed the
> button spun forever with no error. Reverted in `611b943`.

---

### `signOut`
**File:** `lib/actions/auth.ts` | **Type:** Server Action
```ts
signOut(): Promise<void>
```
Calls `supabase.auth.signOut()`. Redirects to `/login`.

---

## Dashboard

### `getDashboardStats`
**File:** `db/queries/dashboard.ts` | **Type:** Query
```ts
getDashboardStats(period: 'monthly' | 'yearly'): Promise<DashboardStats>

type DashboardStats = {
  totalRevenue: number
  priorPeriodRevenue: number
  deltaPercent: number | null
  openCount: number
  completedInPeriodCount: number
  period: 'monthly' | 'yearly'
}
```
Revenue (2026-07-29, replaces invoiced totals): `SUM(orders.price)` over `status <> 'cancelled'`,
period-matched on `COALESCE(production_date, requested_delivery_date, created_at::date)`.
Bookings semantics — scheduled orders count. Monthly: current calendar month; yearly: current
calendar year. Prior period: prior month/year; `deltaPercent` null when prior period is 0.
**Errors:** Throws with context on DB failure.

---

### `getRevenueTrendData`
**File:** `db/queries/dashboard.ts` | **Type:** Query
```ts
getRevenueTrendData(): Promise<RevenueTrendRow[]>

type RevenueTrendRow = {
  billing_month: string   // month bucket of COALESCE(production_date, requested_delivery_date, created_at::date)
  total_amount: string    // SUM(orders.price), non-cancelled orders
}
```
Replaces `getInvoiceTrendData` (2026-07-29). Field names `billing_month`/`total_amount` are a kept
contract — `lib/invoice-chart-transforms.ts` consumes them for the 4-mode chart datasets.
Sorted `billing_month ASC`.
**Errors:** Throws with context on DB failure.

---

### `getNeedToContactList`
**File:** `db/queries/dashboard.ts` | **Type:** Query
```ts
getNeedToContactList(limit?: number): Promise<NeedToContactRow[]>
// default limit: 5

type NeedToContactRow = {
  customerId: string
  companyName: string
  initials: string
  lastOrderDate: Date
  effectiveFrequencyDays: number
  overdueDays: number
}
```
SQL aggregation: auto-calculates average days between completed orders per customer. Uses manual override (`contact_frequency_days`) when set. Excludes: inactive customers, customers with < 2 orders and no override, non-overdue customers. Sorted by `overdueDays DESC`.
**Errors:** Throws with context on DB failure. Returns `[]` (not error) when no customers qualify.

---

### `getPendingOrdersForDashboard`
**File:** `db/queries/dashboard.ts` | **Type:** Query
```ts
getPendingOrdersForDashboard(limit?: number): Promise<PendingOrderRow[]>
// default limit: 5

type PendingOrderRow = {
  id: string
  poNumber: string
  customerName: string
  requestedDeliveryDate: Date
  backhaul: boolean
}
```
Returns orders with `status = 'pending'`. Sorted: `backhaul = true` first, then by `requested_delivery_date ASC` within each group.

---

### `getLeadsFollowUp`
**File:** `db/queries/dashboard.ts` | **Type:** Query
```ts
getLeadsFollowUp(limit?: number): Promise<LeadFollowUpRow[]>
// default limit: 5

type LeadFollowUpRow = {
  id: string
  name: string
  company: string | null
  nextFollowUpDate: Date
  overdueDays: number
}
```
Returns leads where `next_follow_up_date ≤ today`. Sorted by `next_follow_up_date ASC`.

---

## Customers

### `getCustomers`
**File:** `db/queries/customers.ts` | **Type:** Query
```ts
getCustomers(filters?: {
  status?: 'active' | 'inactive'
  search?: string
  sort?: 'alphabetical' | 'order_count' | 'need_to_contact'
}): Promise<CustomerListRow[]>

type CustomerListRow = {
  id: string
  companyName: string
  primaryContactName: string | null
  primaryContactRole: string | null
  lastOrderDate: Date | null
  isOverdue: boolean
}
```
Default: `status = 'active'`, `sort = 'alphabetical'`. Search is case-insensitive contains on `company_name`.

---

### `getCustomerDetail`
**File:** `db/queries/customers.ts` | **Type:** Query
```ts
getCustomerDetail(customerId: string): Promise<CustomerDetail>

type CustomerDetail = {
  id: string
  companyName: string
  status: 'active' | 'inactive'
  contactFrequencyDays: number | null
  autoCalculatedFrequencyDays: number | null
  notes: string | null
  contacts: CustomerContact[]
  isOverdue: boolean
  lastOrderDate: Date | null
  overdueDays: number
}
```
**Errors:** Throws `"Customer not found: [id]"` if not found.

---

### `getCustomerOrders`
**File:** `db/queries/customers.ts` | **Type:** Query
```ts
getCustomerOrders(
  customerId: string,
  window: '1M' | '3M' | '6M' | '1Y' | 'YTD'
): Promise<OrderRow[]>
```
Windows: 1M=30d, 3M=90d, 6M=180d, 1Y=365d, YTD=Jan 1 to today. Sorted by `requested_delivery_date DESC`.

---

### `getCustomerVolumeOverview`
**File:** `db/queries/customers.ts` | **Type:** Query
```ts
getCustomerVolumeOverview(customerId: string): Promise<VolumeOverview>

type VolumeOverview = {
  gal275: { rebottled: number; reconditioned: number; brandNew: number; totalAvg: number }
  gal330: { rebottled: number; reconditioned: number; brandNew: number; totalAvg: number }
}
```
Averages calculated from completed orders only. Returns zeroes (not errors) when no data. Divide-by-zero guarded.

---

### `createCustomer`
**File:** `lib/actions/customers.ts` | **Type:** Server Action
```ts
createCustomer(data: CreateCustomerInput): Promise<{ id: string } | { error: string }>

type CreateCustomerInput = {
  companyName: string               // min length 1
  primaryContact: {
    name: string
    role?: string
    email?: string                  // at least one of email/phone required
    phone?: string
  }
  additionalContacts?: ContactInput[]  // max 4
  status?: 'active' | 'inactive'       // default 'active'
  contactFrequencyDays?: number | null
  notes?: string
}
```
Atomic: inserts customer + all contacts in sequence. Rolls back if any insert fails.
**Errors:** `{ error: "Company name is required." }` | `{ error: "At least one email or phone is required." }`

---

### `updateCustomer`
**File:** `lib/actions/customers.ts` | **Type:** Server Action
```ts
updateCustomer(id: string, data: UpdateCustomerInput): Promise<{ success: boolean } | { error: string }>
```
Partial update. Contacts: replaces all contacts if `contacts` array provided.
**Errors:** `{ error: "Customer not found." }`

---

### `deleteCustomer`
**File:** `lib/actions/customers.ts` | **Type:** Server Action
```ts
deleteCustomer(id: string): Promise<{ success: boolean } | { error: string }>
```
**Errors:** `{ error: "Cannot delete a customer with active orders. Cancel or complete all orders first." }` — if customer has orders with status `scheduled` or `pending`.

---

## Orders

### `getOrders`
**File:** `db/queries/orders.ts` | **Type:** Query
```ts
getOrders(filters?: { status?: po_status | 'all' }): Promise<OrderTableRow[]>
```
Default: all statuses. Sorted: scheduled/pending first (req date ASC), then completed/cancelled/invoiced (req date DESC). Paginated 20/page at component level.

---

### `getOrderDetail`
**File:** `db/queries/orders.ts` | **Type:** Query
```ts
getOrderDetail(orderId: string): Promise<OrderDetail>
```
All order fields + customer company name.
**Errors:** Throws `"Order not found: [id]"` if not found.

---

### `createOrder`
**File:** `lib/actions/orders.ts` | **Type:** Server Action
```ts
createOrder(data: CreateOrderInput): Promise<{ id: string } | { error: string }>

type CreateOrderInput = {
  poNumber: string
  customerId: string
  containerSize: '275' | '330'
  containerType: 'rebottled' | 'reconditioned' | 'brand_new'
  quantity: number               // integer, min 1
  price: number                  // min 0.01
  pickupOnly?: boolean           // default false
  deliveryAddress?: string | null
  requestedDeliveryDate: Date
  backhaul?: boolean             // default false
  initialStatus?: 'scheduled' | 'pending'  // default 'scheduled'
  notes?: string
}
```
**Errors:** `{ error: "PO number already exists." }` | `{ error: "Delivery address is required unless pickup-only." }` | `{ error: "Quantity must be at least 1." }` | `{ error: "Price must be greater than $0." }`

---

### `updateOrder`
**File:** `lib/actions/orders.ts` | **Type:** Server Action
```ts
updateOrder(id: string, data: UpdateOrderInput): Promise<{ success: boolean } | { error: string }>
```
Partial update. `status` field is stripped by Zod — status changes use `updateOrderStatus` exclusively.

---

### `updateOrderStatus`
**File:** `lib/actions/orders.ts` | **Type:** Server Action
```ts
updateOrderStatus(
  orderId: string,
  newStatus: 'pending' | 'completed' | 'cancelled'
): Promise<{ success: boolean } | { error: string }>
```
Valid transitions: `scheduled → pending`, `pending → completed`, `pending → cancelled`. All others rejected.
`'invoiced'` is not a valid `newStatus` (Zod rejects it).
**Errors:** `{ error: "Invalid status transition from [current] to [new]." }`

---

### `uploadPODocument`
**File:** `lib/actions/orders.ts` | **Type:** Server Action
```ts
uploadPODocument(orderId: string, file: File): Promise<{ storagePath: string } | { error: string }>
```
Stores at `po-documents/[orderId]/[filename]`. Updates `orders.document_url` with storage path. Upsert (replaces existing). Accepted: PDF, PNG, JPG. Max 10MB.
**Errors:** `{ error: "File too large. Maximum 10MB allowed." }` | `{ error: "Only PDF, PNG, and JPG files are accepted." }`

---

### `getPODocumentSignedUrl`
**File:** `lib/actions/orders.ts` | **Type:** Server Action
```ts
getPODocumentSignedUrl(storagePath: string): Promise<string>
```
Returns a 1-hour signed URL. Called when user clicks "Download" on an uploaded document.
**Errors:** Throws with context if storage path not found.

---

## Leads

### `getLeads`
**File:** `db/queries/leads.ts` | **Type:** Query
```ts
getLeads(filters?: {
  status?: 'hot' | 'warm' | 'cold' | 'all'
  search?: string
}): Promise<LeadListRow[]>
```
Never returns `status = 'converted'` in any filter. Sorted: `next_follow_up_date ASC`, nulls last.

---

### `getLeadDetail`
**File:** `db/queries/leads.ts` | **Type:** Query
```ts
getLeadDetail(leadId: string): Promise<LeadDetail>
```
**Errors:** Throws `"Lead not found: [id]"` if not found.

---

### `getLeadNotes`
**File:** `db/queries/leads.ts` | **Type:** Query
```ts
getLeadNotes(leadId: string): Promise<LeadNote[]>
```
Sorted `created_at ASC` (oldest first).

---

### `createLead`
**File:** `lib/actions/leads.ts` | **Type:** Server Action
```ts
createLead(data: CreateLeadInput): Promise<{ id: string } | { error: string }>

type CreateLeadInput = {
  name: string                   // min length 1
  company?: string
  email?: string                 // at least one of email/phone required
  phone?: string
  status: 'hot' | 'warm' | 'cold'  // default 'warm'
  leadSource?: string
  notes?: string
}
```

---

### `updateLead`
**File:** `lib/actions/leads.ts` | **Type:** Server Action
```ts
updateLead(id: string, data: UpdateLeadInput): Promise<{ success: boolean } | { error: string }>
```
Partial update. Does not include `status = 'converted'` (that is set only by `convertLeadToCustomer`).

---

### `addLeadNote`
**File:** `lib/actions/leads.ts` | **Type:** Server Action
```ts
addLeadNote(leadId: string, content: string): Promise<{ id: string } | { error: string }>
```
Inserts new `lead_notes` record with current UTC timestamp.
**Errors:** `{ error: "Note cannot be empty." }` if content is empty (also enforced client-side).

---

### `setNextAction`
**File:** `lib/actions/leads.ts` | **Type:** Server Action
```ts
setNextAction(
  leadId: string,
  data: { date: Date; time: string; actionType: 'call' | 'email' | 'visit' | 'other' }
): Promise<{ success: boolean } | { error: string }>
```
Updates `leads.next_follow_up_date` and `leads.next_action_type`.

---

### `convertLeadToCustomer`
**File:** `lib/actions/leads.ts` | **Type:** Server Action
```ts
convertLeadToCustomer(leadId: string): Promise<{ customerId: string } | { error: string }>
```
**Atomic (DB transaction):**
1. Create customer record with lead's name/company/email/phone
2. Set `leads.status = 'converted'` and `leads.converted_customer_id = newCustomerId`

If step 1 fails → step 2 does not execute. If step 2 fails → step 1 rolls back. No partial state possible.
**Errors:** `{ error: "Lead not found." }` | `{ error: "Failed to convert lead: [reason]." }`

---

## Invoices

### `getInvoiceableOrders`
**File:** `db/queries/invoices.ts` | **Type:** Query
```ts
getInvoiceableOrders(
  billingMonth: Date,
  customerId?: string
): Promise<InvoiceableOrder[]>

type InvoiceableOrder = {
  id: string
  poNumber: string
  customerName: string
  quantity: number
  containerSize: '275' | '330'
  containerType: 'rebottled' | 'reconditioned' | 'brand_new'
  price: number
}
```
Returns: `status = 'completed'` AND `invoice_id IS NULL` AND `requested_delivery_date` within the calendar month of `billingMonth`. Returns `[]` (not error) when no orders match.

---

### `getInvoices`
**File:** `db/queries/invoices.ts` | **Type:** Query
```ts
getInvoices(filter?: 'all' | 'draft' | 'paid'): Promise<InvoiceLedgerRow[]>
```
Sorted `billing_month DESC`.

---

### `getInvoiceDetail`
**File:** `db/queries/invoices.ts` | **Type:** Query
```ts
getInvoiceDetail(invoiceId: string): Promise<InvoiceDetail>
```
Returns invoice record + all associated order rows (joined).
**Errors:** Throws `"Invoice not found: [id]"` if not found.

---

### `createInvoice`
**File:** `lib/actions/invoices.ts` | **Type:** Server Action
```ts
createInvoice(data: CreateInvoiceInput): Promise<{ id: string; invoiceNumber: string } | { error: string }>

type CreateInvoiceInput = {
  billingMonth: Date         // first day of month
  customerId?: string        // null = all customers
  orderIds: string[]         // min length 1, each a valid UUID
}
```
**Atomic (DB transaction):**
1. Validate all `orderIds`: `status = 'completed'` AND `invoice_id IS NULL`
2. Sum `total_amount` from selected orders
3. Auto-generate `invoice_number` (INV-0001 format)
4. Insert invoice record (`status = 'draft'`)
5. Update all selected orders: `status = 'invoiced'`, `invoice_id = newId`

**Errors:** `{ error: "Order [PO#] is already invoiced." }` (operation aborted, rolled back)

---

### `markInvoicePaid`
**File:** `lib/actions/invoices.ts` | **Type:** Server Action
```ts
markInvoicePaid(invoiceId: string): Promise<{ success: boolean } | { error: string }>
```
Only valid on `status = 'draft'` invoices.
**Errors:** `{ error: "Invoice is already marked paid." }`

---

## Support

### `getTickets`
**File:** `db/queries/support.ts` | **Type:** Query
```ts
getTickets(): Promise<TicketListRow[]>
```
Sorted `created_at DESC`.

---

### `getTicketDetail`
**File:** `db/queries/support.ts` | **Type:** Query
```ts
getTicketDetail(ticketId: string): Promise<TicketDetail>
```
Includes all `support_attachments` records for this ticket.
**Errors:** Throws `"Ticket not found: [id]"` if not found.

---

### `createTicket`
**File:** `lib/actions/support.ts` | **Type:** Server Action
```ts
createTicket(data: CreateTicketInput): Promise<{ id: string } | { error: string }>

type CreateTicketInput = {
  title: string           // min length 1
  category: support_category
  priority: support_priority
  description: string    // min length 1
}
```
Creates ticket with `status = 'open'`. Attachments uploaded separately via `uploadTicketAttachment`.

---

### `uploadTicketAttachment`
**File:** `lib/actions/support.ts` | **Type:** Server Action
```ts
uploadTicketAttachment(ticketId: string, file: File): Promise<{ path: string } | { error: string }>
```
Stores at `support-attachments/[ticketId]/[filename]`. Inserts `support_attachments` record.
Accepted: PNG, JPG, PDF. Max 5MB. Max 3 per ticket (enforced client-side; server validates count).
**Errors:** `{ error: "File too large. Maximum 5MB per file." }` | `{ error: "Only PNG, JPG, and PDF files are accepted." }` | `{ error: "Maximum 3 attachments per ticket." }`
