# API Spec: ToteTrack

**Date:** 2026-04-20
**Last revised:** 2026-08-10 — added Pickups (Feature 15), Calendar and Customer Addresses; removed `markInvoicePaid`, which no longer exists. Same-day DS-01 fix: `signOut`'s signature and error path corrected — it was documented as `Promise<void>` inside a section this file's banner declared verified
**Status:** Partially revised — sections below carry different vintages, see the warning

> ⚠ **This document is not fully reconciled against source.** The 2026-08-10 pass
> verified Auth, Customer Addresses, Calendar, Pickups and the Invoices deletion
> against the real `lib/actions/*.ts` and `db/queries/*.ts`. **Auth was re-verified
> line by line later the same day** after `signOut` was found documented with the
> wrong return type despite being inside the "verified" set — treat "verified"
> as *checked on a date*, not as a guarantee.
>
> The Dashboard, Customers, Orders, Leads, Invoices and Support sections were
> **not** re-verified and are known to contain stale entries. Known and still
> outstanding as of 2026-08-10:
> - **Documented but nonexistent:** `getPendingOrdersForDashboard` (the real
>   function is `getOpenOrdersForDashboard`), `uploadPODocument` and
>   `getPODocumentSignedUrl` (Tasks 19/33 were cut — nothing uploads a PO document).
> - **Exists but undocumented:** `getProductionWidgetData`
>   (`db/queries/production-widget.ts`) and `getSupportAttachmentSignedUrl`
>   (`lib/actions/support.ts`, the third export of that module).
> - **Stale shapes:** `createOrder`'s documented input predates the multi-combo
>   schema (CONSTRAINT-18), and some Invoices types predate the v3 model
>   (CONSTRAINT-17).
>
> Read the source before relying on anything outside the verified sections.

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
signOut(): Promise<{ error: string } | void>
```
Calls `supabase.auth.signOut()`. **On success it returns nothing and `redirect('/login')` runs. On failure it returns `{ error }` and does not redirect** — the caller must render that error.

**Errors:** Two distinct failure surfaces, both logged with context (`operation: 'supabase.auth.signOut'`) and both returned as `{ error: GENERIC_FAILURE_MESSAGE }` (audit L-02 — a failed sign-out must reach the user, never silently redirect):
- supabase-js v2 `auth.signOut()` **resolves** with `{ error }` on an auth-service failure rather than throwing; the resolved error is captured and checked before redirecting.
- A thrown/rejected call (network failure, service down) is caught so it never escapes as an unhandled rejection.

The `redirect('/login')` sits **outside** the `try` — inside it, the `NEXT_REDIRECT` throw would be swallowed by the `catch` and reported to the user as a sign-out failure. It runs only when neither surface produced an error. `components/shell/NavDrawer.tsx` is the only caller and awaits the result to surface `{ error }`.

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

## Customer Addresses

Feature 14. The saved address book per customer. Orders and pickups store address **text
snapshots**, never foreign keys into this table (CONSTRAINT-21) — which is why deleting a saved
address leaves past rows untouched.

### `addCustomerAddress`
**File:** `lib/actions/customer-addresses.ts` | **Type:** Server Action
```ts
addCustomerAddress(customer_id: string, address: string): Promise<{ id: string } | { error: string }>
```
Address is trimmed before validation, so a whitespace-only string is rejected server-side; the
trimmed text is what gets stored. Dedupe is a **single atomic upsert** against the unique
`(customer_id, address)` index (migration `0013`) — no check-then-insert race. An exact-text match
has its `last_used_at` bumped to now and its existing id returned; a genuinely new row is inserted
with `last_used_at` left NULL, since it is only set when the address is actually *used* on an order
or pickup. Equality is plain SQL `=`, case- and whitespace-sensitive: `"123 Main St"` and
`"123 main st"` are intentionally distinct rows.
**Errors:** `{ error: "Invalid customer id." }` | `{ error: "Address is required." }` | `{ error: "Address must be [N] characters or fewer." }`

---

### `updateCustomerAddress`
**File:** `lib/actions/customer-addresses.ts` | **Type:** Server Action
```ts
updateCustomerAddress(id: string, address: string): Promise<{ success: true } | { error: string }>
```
Rewrites the stored text (trimmed) and touches `updated_at`.
**Errors:** `{ error: "Invalid address id." }` | `{ error: "Address not found." }` — returned, not silently succeeded: the row may have been deleted from another screen.

---

### `deleteCustomerAddress`
**File:** `lib/actions/customer-addresses.ts` | **Type:** Server Action
```ts
deleteCustomerAddress(id: string): Promise<{ success: true } | { error: string }>
```
Hard delete. Past orders and pickups are unaffected by design — they hold text snapshots, not FKs.
**Errors:** `{ error: "Invalid address id." }` | `{ error: "Address not found." }`

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
  customerCollects?: boolean     // default false
  deliveryAddress?: string | null
  requestedDeliveryDate: Date
  backhaul?: boolean             // default false
  initialStatus?: 'scheduled' | 'pending'  // default 'scheduled'
  notes?: string
}
```
**Errors:** `{ error: "PO number already exists." }` | `{ error: "Delivery address is required unless the customer collects." }` | `{ error: "Quantity must be at least 1." }` | `{ error: "Price must be greater than $0." }`

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

### `revertOrderToScheduled`
**File:** `lib/actions/orders.revert.ts` | **Type:** Server Action
```ts
revertOrderToScheduled(id: string): Promise<{ success: true } | { error: string }>
```
FB-08. Moves a **terminal** order back to `scheduled`. Three source states:
- `completed → scheduled` — status flip; the auto-set-on-completion `requested_delivery_date` is preserved
- `cancelled → scheduled` — status flip
- `invoiced → scheduled` — also detaches the order from its invoice (`invoice_id → null`), recomputes that invoice's `total_amount` from the orders still attached, and **deletes the invoice entirely if it ends up with zero orders** (a $0 zombie is worse UX than the slim risk of an invoice number being reused later)

The whole revert runs in **one DB transaction**, so partial state cannot leak — the order cannot
detach from its invoice without the total recomputing. A `scheduled` order cannot be reverted;
it is already in the in-flight state.
**Revalidates:** `/orders`, `/calendar`, `/dashboard`.
**Errors:** `{ error: "Invalid order id." }` | order not found | already `scheduled`.

---

### `getPODocumentSignedUrl`
**File:** `lib/actions/orders.ts` | **Type:** Server Action
```ts
getPODocumentSignedUrl(storagePath: string): Promise<string>
```
Returns a 1-hour signed URL. Called when user clicks "Download" on an uploaded document.
**Errors:** Throws with context if storage path not found.

---

## Pickups

Feature 15 (Tasks 76–81). Collections of empty totes — a separate table, never a flag on `orders`
(CONSTRAINT-25). No price, PO number, document or invoice link, so pickups appear on **no revenue
or dashboard surface**. `pickup_date` **is** the calendar placement; NULL means unscheduled.

All five actions guard with `assertAuthenticated()` and validate with Zod before any DB write.
Shared limits (`QUANTITY_MAX`, `DELIVERY_ADDRESS_MAX`, `NOTES_MAX`) come from `orders.validation`
rather than being redeclared.

### `getPickups`
**File:** `db/queries/pickups.ts` | **Type:** Query
```ts
getPickups(filters?: GetPickupsFilters): Promise<GetPickupsResult>

type PickupStatus = 'scheduled' | 'completed' | 'cancelled'
type PickupListStatus = PickupStatus | 'all'

type GetPickupsFilters = {
  status?: PickupListStatus   // default 'all'
  search?: string             // case-insensitive contains on customer company name; blank/whitespace ignored
}

type PickupTableRow = {
  id: string
  customer_id: string
  customer_name: string | null
  status: PickupStatus
  qty_275: number
  qty_330: number
  pickup_date: string | null
}

type GetPickupsResult = { rows: PickupTableRow[] }
```
Sorted so scheduled pickups come first (`pickup_date ASC` — next collection first) and
completed/cancelled ones after (`pickup_date DESC` on the same column). **Unbounded** — the table
scrolls rather than paginates, which is why the search input is debounced client-side.
The caller (`app/(app)/pickups/page.tsx`) whitelists `?status=` against the four legal values
before passing it (SEC-02): the filter is interpolated into `AND p.status = $1` and Postgres
cannot cast an unknown label to the `pickup_status` enum, so an un-whitelisted value would 500
the route rather than filter.
**Errors:** Throws `DatabaseError` with context on query failure.

---

### `getPickupDetail`
**File:** `db/queries/pickups.ts` | **Type:** Query
```ts
getPickupDetail(pickupId: string): Promise<PickupDetail>

type PickupDetail = PickupTableRow & {
  address: string | null
  notes: string | null
}
```
Joins `customers` for the company name, so the detail panel renders without a second round-trip.
**Errors:** Throws `PickupNotFoundError` when no row matches. Throws `DatabaseError` on query failure.

---

### `getCustomerPickups`
**File:** `db/queries/pickups.ts` | **Type:** Query
```ts
getCustomerPickups(
  customerId: string,
  window: CustomerPickupsWindow      // = CustomerOrdersWindow: '1M' | '3M' | '6M' | '1Y' | 'YTD'
): Promise<CustomerPickupRow[]>

type CustomerPickupRow = {
  id: string
  status: PickupStatus
  qty_275: number
  qty_330: number
  pickup_date: string | null
}
```
Backs the Pickup History panel on the customer detail view. Sorted `pickup_date DESC`; returns `[]`
when the customer has no dated pickups in the window. **Every status is included** — a cancelled
pickup is still history, and each row carries its own badge, mirroring `getCustomerOrders`.
`CustomerPickupsWindow` is an alias of `CustomerOrdersWindow`, not a second definition, so the two
history panels can never disagree about what "3M" means. Only the URL param differs (`?pwindow=`
here, `?window=` there) so the two tab groups stay independent on the one screen.
**Errors:** Throws `DatabaseError` with context on query failure.

---

### `getCustomerUnscheduledPickupCount`
**File:** `db/queries/pickups.ts` | **Type:** Query
```ts
getCustomerUnscheduledPickupCount(customerId: string): Promise<number>
```
Backs the quiet `· N unscheduled` suffix on the Pickup History header. Counts pickups that are
still open but carry no date. **Not window-filtered** — an undated pickup falls outside every
window, so the count is identical on all five tabs. Returns `0` when there are none.
**Errors:** Throws `DatabaseError` with context on query failure.

---

### `getCalendarPickups`
**File:** `db/queries/pickups.calendar.ts` | **Type:** Query
```ts
getCalendarPickups(input: CalendarRange): Promise<CalendarPickupRow[]>
// CalendarRange = { from: string; to: string }   // 'yyyy-MM-dd', from lib/calendar-range.ts

type CalendarPickupRow = {
  id: string
  customer_id: string
  customer_name: string | null
  status: PickupStatus
  qty_275: number
  qty_330: number
  pickup_date: string | null
  sort_index: number | null
  address: string | null      // popup only — cards show neither address nor notes
  notes: string | null
  contacts: CalendarContact[] // embedded for the popup's Contact menu
}
```
The pickup half of `/calendar`'s fetch, alongside `getCalendarOrders`. Filters on the bare
`pickup_date` column so `pickups_pickup_date_idx` serves it (same sargability rule as FI-02).
The projection mirrors `CALENDAR_SELECT_LIST` in `calendar.ts` field for field, including the
`contacts` aggregate — a pickup popup's Contact menu must offer the same people the order popup
does, and one shared shape is what stops the two drifting. Contacts are embedded on the row rather
than fetched per popup because this app has no client-side data-fetching pattern.
**Errors:** Throws `InvalidDateError` when `from > to`. Throws `DatabaseError` on query failure.

---

### `getUnscheduledPickups`
**File:** `db/queries/pickups.calendar.ts` | **Type:** Query
```ts
getUnscheduledPickups(): Promise<CalendarPickupRow[]>
```
Open pickups with `pickup_date IS NULL`, for the calendar's undated-pickups callout. Same
projection as `getCalendarPickups`, so a pickup rendered in the callout and the same pickup
rendered in a day column carry identical fields.
**Errors:** Throws `DatabaseError` with context on query failure.

---

### `createPickup`
**File:** `lib/actions/pickups.ts` | **Type:** Server Action
```ts
createPickup(input: CreatePickupInput): Promise<{ id: string } | { error: string }>

type CreatePickupInput = {
  customer_id: string              // UUID
  qty_275: number                  // integer ≥ 0, ≤ QUANTITY_MAX
  qty_330: number                  // integer ≥ 0, ≤ QUANTITY_MAX
  pickup_date?: string | null      // 'yyyy-MM-dd' or ''; absent/blank = unscheduled
  address?: string | null          // optional — a pickup from the usual site needs none
  address_id?: string | null       // UUID of a saved customer_addresses row, when picked from the dropdown
  notes?: string | null
}
```
`qty_275 + qty_330 > 0` is enforced by a `superRefine`, with the message pathed to `qty_275` so it
surfaces next to the count grid. `pickup_date` uses **`calendarDateSchema`, not
`productionDateSchema`** — a pickup carries no weekday rule, because a collection is not
production (see `docs/architecture.md`, "The Two-List Calendar").

There is no "required unless the customer collects" rule as there is for orders. When an address
*is* given it is snapshotted on the row (CONSTRAINT-21, never an FK) **and** upserted into the
customer's address book through the same `recordDeliveryAddressUsage` path `createOrder` uses.
When `address_id` is present it is ownership-checked against `customer_id` **before** the insert
(SEC-03), so a forged or foreign id fails the whole create rather than bumping another customer's
address book.
**Revalidates:** `/pickups`, `/calendar`, `/customers`. `/dashboard` deliberately absent — no widget reads pickups.
**Errors:** `{ error: "Please choose a customer." }` | `{ error: "At least one quantity is required." }` | `{ error: "Invalid date format." }` | address-not-owned | `GENERIC_FAILURE_MESSAGE` on write failure (the real cause is logged, never returned).

---

### `updatePickup`
**File:** `lib/actions/pickups.ts` | **Type:** Server Action
```ts
updatePickup(id: string, input: UpdatePickupInput): Promise<{ success: true } | { error: string }>
```
Same schema as create, minus two fields — and both omissions are load-bearing:
- **no `status`** — transitions belong exclusively to `updatePickupStatus`, and a `status` key sent here is not whitelisted and never reaches the column
- **no `address_id`** — edits keep snapshot semantics and never touch the address book, mirroring `updateOrderInputSchema`

**There is no edit lock.** Unlike CONSTRAINT-18's rule for orders, quantities stay editable in
every status: a pickup has no price or invoice to protect.
**Revalidates:** `/pickups`, `/calendar`, `/customers`.
**Errors:** `{ error: "Invalid pickup id." }` | pickup not found | the create-schema messages | `GENERIC_FAILURE_MESSAGE`.

---

### `updatePickupStatus`
**File:** `lib/actions/pickups.ts` | **Type:** Server Action
```ts
updatePickupStatus(
  id: string,
  target: 'scheduled' | 'completed' | 'cancelled'
): Promise<{ success: true } | { error: string }>
```
Valid transitions: `scheduled → completed`, `scheduled → cancelled`, and
`completed | cancelled → scheduled`. **A terminal pickup can be reopened directly** — it carries no
price, invoice or document, so there is nothing to unwind (compare `revertOrderToScheduled`, which
needs a whole transaction to detach an invoice). A no-op move to the status the row already holds
is rejected rather than silently written.
**Revalidates:** `/pickups`, `/calendar`, `/customers`.
**Errors:** `{ error: "Invalid pickup id." }` | pickup not found | `{ error: "Invalid status transition from [current] to [target]." }`

---

### `setPickupPlacement`
**File:** `lib/actions/pickups.calendar.ts` | **Type:** Server Action
```ts
setPickupPlacement(id: string, input: SetPickupPlacementInput): Promise<{ success: true } | { error: string }>

type SetPickupPlacementInput = {
  group: 'pickup'            // z.literal — a validated field, not documentation
  pickupDate: string         // 'yyyy-MM-dd', no weekday rule
  sortIndex: number          // integer 0..SORT_INDEX_MAX (9,999), shared with the order action
}
```
Writes `pickup_date` + `sort_index`. **The group is checked twice, on purpose:** `input.group` must
be the literal `'pickup'`, which rejects a payload built for `setProductionPlacement` before any
query runs; and `id` must resolve to a row in `pickups`, which rejects an order id whatever the
payload claims. Neither check trusts the client, and the UI's discriminator is not part of either.
Blocked on terminal pickups, matching the order action's message shape.
**Revalidates:** `/calendar`, `/pickups`, `/customers` — the last because Pickup History renders `pickup_date` in a column of its own, and a drag that skipped it would leave that panel on the old day.
**Errors:** `{ error: "Invalid pickup id." }` | `{ error: "That card is not a pickup." }` | `{ error: "Invalid date format." }` | sort-index out of range | `{ error: "Cancelled pickups cannot be placed on the calendar." }` | `{ error: "Completed pickups cannot be moved on the calendar." }` | `GENERIC_FAILURE_MESSAGE`.

---

### `clearPickupPlacement`
**File:** `lib/actions/pickups.calendar.ts` | **Type:** Server Action
```ts
clearPickupPlacement(id: string): Promise<{ success: true } | { error: string }>
```
Nulls `pickup_date` **and** `sort_index`. Three entry points, one operation: the popup's
`Remove from calendar`, the drag-onto-callout gesture, and the armed tap on the callout.

Clearing `sort_index` too is deliberate — a pickup placed again later must not inherit a position
from the column it used to sit in. This supersedes the Task 80 shortcut (recorded as INFO-05),
which cleared the date by resending the whole editable row through `updatePickup`: that path was
last-write-wins against a concurrent edit from the Pickups tab and left a stale index behind. Two
columns and nothing else move here, so a concurrent quantity edit survives. Status, quantities,
address and notes are untouched — this clears a day, not the collection.
**Revalidates:** `/calendar`, `/pickups`, `/customers`.
**Errors:** `{ error: "Invalid pickup id." }` | pickup not found | terminal-status block | `GENERIC_FAILURE_MESSAGE`.

---

## Calendar

Features 11–12. The **order** half of `/calendar`. Every action guards with `assertAuthenticated()`,
and none of them ever writes `requested_delivery_date` — the calendar owns the build day, never the
customer-facing promise (CONSTRAINT-19).

### `getCalendarOrders`
**File:** `db/queries/calendar.ts` | **Type:** Query
```ts
getCalendarOrders(input: CalendarRange): Promise<CalendarOrderRow[]>
// CalendarRange = { from: string; to: string }   // 'yyyy-MM-dd'
```
Filters on the **bare** `production_date` column (`>= from AND <= to`), which is sargable, so
`orders_production_date_idx` serves it. The earlier `COALESCE(production_date, …)` form forced a
sequential scan (FI-02); removing the read-time derivation removed the problem rather than working
around it.
**Errors:** Throws `InvalidDateError` when `from > to`. Throws `DatabaseError` on query failure.

---

### `getUnscheduledOrders`
**File:** `db/queries/calendar.ts` | **Type:** Query
```ts
getUnscheduledOrders(): Promise<CalendarOrderRow[]>
```
Open orders with `production_date IS NULL`, for the unscheduled callout — whatever their delivery
date. Same projection as `getCalendarOrders`.
**Errors:** Throws `DatabaseError` with context on query failure.

---

### `setProductionPlacement`
**File:** `lib/actions/calendar.ts` | **Type:** Server Action
```ts
setProductionPlacement(id: string, input: SetProductionPlacementInput): Promise<{ success: true } | { error: string }>

type SetProductionPlacementInput = {
  group: 'order'             // z.literal — the exact mirror of setPickupPlacement's
  productionDate: string     // 'yyyy-MM-dd', must be a weekday (productionDateSchema)
  sortIndex: number          // integer 0..SORT_INDEX_MAX (9,999)
}
```
Writes `production_date` + `production_sort_index`. The no-weekend invariant is enforced **here, on
write** (CONSTRAINT-19) and on no read path. Blocked on terminal statuses.
**Revalidates:** `/orders`, `/calendar`, `/dashboard`.
**Errors:** `{ error: "Invalid order id." }` | `{ error: "That card is not an order." }` | `{ error: "Production dates must fall on a weekday." }` | `{ error: "Invalid date format." }` | sort-index out of range | blocked status | `GENERIC_FAILURE_MESSAGE`.

---

### `clearProductionPlacement`
**File:** `lib/actions/calendar.ts` | **Type:** Server Action
```ts
clearProductionPlacement(id: string): Promise<{ success: true } | { error: string }>
```
Nulls `production_date` + `production_sort_index`; the order moves to the unscheduled callout.
`requested_delivery_date` and `same_day_delivery` are left untouched — this clears a build day, not
the delivery promise.
**Revalidates:** `/orders`, `/calendar`, `/dashboard`.
**Errors:** `{ error: "Invalid order id." }` | blocked status | `GENERIC_FAILURE_MESSAGE`.

---

### `toggleSameDayDelivery`
**File:** `lib/actions/calendar.ts` | **Type:** Server Action
```ts
toggleSameDayDelivery(id: string, next: boolean): Promise<{ success: true } | { error: string }>
```
Takes the **target state** rather than flipping the stored value, so a double-fired click cannot
toggle twice. Touches neither production column nor `requested_delivery_date`.
**Errors:** `{ error: "Invalid order id." }` | cancelled order | `GENERIC_FAILURE_MESSAGE`.

---

### `toggleBackhaul`
**File:** `lib/actions/calendar.ts` | **Type:** Server Action
```ts
toggleBackhaul(id: string, next: boolean): Promise<{ success: true } | { error: string }>
```
Same target-state semantics. **Stays available on completed and invoiced orders** — CONSTRAINT-18
locks quantities and price on those, not logistics flags.
**Errors:** `{ error: "Invalid order id." }` | cancelled order | `GENERIC_FAILURE_MESSAGE`.

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

> **`markInvoicePaid` was removed** (CONSTRAINT-17, 2026-04-22, migration `0007`). Invoice v3
> dropped the `status` column the action read, and the action with it. `lib/actions/invoices.ts`
> exports exactly one function, `createInvoice`. Anything still calling `markInvoicePaid` is
> calling something that has not existed for months.

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
