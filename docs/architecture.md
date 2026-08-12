# Architecture: ToteTrack

**Date:** 2026-04-20
**Last revised:** 2026-08-10 — Feature 15 (Pickups, Tasks 76–81) folded in: 10th entity, `/pickups` route, the two-list calendar and its five patterns, and recounted operation / RLS / nav-item figures. Same-day DS-01 accuracy pass: `components/customers/` and `components/calendar/` listings reconciled file-for-file against disk, the `formFields` "every form surface" claim corrected (leads/support diverge), `getCustomerVolumeOverview` renamed, `getSupportAttachmentSignedUrl` added to reconcile with CONSTRAINT-24, the nonexistent `PODocumentUpload.tsx` removed, and the 59-operation arithmetic made reproducible
**Status:** Approved — Phase 2 complete
**Approved by:** Builder (2026-04-20)

> See `docs/data-model.md` for complete entity definitions.
> See `docs/api-spec.md` for all operation signatures.
> See `docs/founder-brief.md` for rationale behind each significant decision.

---

## Stack

| Layer | Technology | Version target |
|-------|-----------|---------------|
| Framework | Next.js App Router | 15.5+ (React 19.2+) — upgraded from 14 in Task 83, 2026-08-11 |
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

10 entity types with relationships → full spec in `docs/data-model.md`.

**Entity overview:**

| Entity | Purpose |
|--------|---------|
| `customers` | Customer companies. `default_delivery_address` is DEPRECATED (Feature 14, 2026-07-28) — column retained in DB, unused by app code; drop deferred |
| `customer_addresses` | Saved delivery addresses per customer (Feature 14, migrations 0012/0013) — MRU via `last_used_at`, `UNIQUE (customer_id, address)`; orders still store `delivery_address` as a text snapshot |
| `customer_contacts` | Individual contacts per customer (1+ per customer); email + phone both optional |
| `orders` | Purchase orders; `requested_delivery_date` is nullable. Also carries the production-calendar columns `production_date` / `same_day_delivery` / `production_sort_index` (migration `0010`) |
| `pickups` | Collections of empty totes (Feature 15, migration `0015`) — a separate table, never a flag on `orders` (CONSTRAINT-25). No price, PO number, document or invoice link, so it appears on no revenue or dashboard surface. `pickup_date` **is** the calendar placement (NULL = unscheduled); `sort_index` is the hand-placed position in a day column. `address` is a text snapshot, never an FK (CONSTRAINT-21) |
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

**Pickup state machine (CONSTRAINT-25):**
```
[New] → scheduled ⇄ completed
              ⇅
          cancelled
```
- Three statuses, no `invoiced` sub-state — a pickup is never billed
- **Every** status is a legal transition target: `scheduled → completed`, `scheduled → cancelled`, and `completed`/`cancelled` → `scheduled`. A pickup carries no price, invoice or document, so reopening a terminal one has nothing to unwind — unlike an order, which needs the dedicated `revertOrderToScheduled` transaction. A no-op to the status the row already holds is still rejected
- No edit lock either (contrast CONSTRAINT-18): quantities stay editable in every status
- `updatePickup` cannot write `status` — the field is not in its schema, so transitions belong exclusively to `updatePickupStatus`

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

**59 total operations** (recounted 2026-08-10 against source) = **29 + 30**:

- **29 exported `async` query functions** across `db/queries/*.ts`. That tree exports **40** functions in total; the other **11** are synchronous SQL-fragment builders and pure helpers (`buildNeedToContactQuery`, `buildProductionWidgetQuery`, `revenueSumQuery`, `computeWindowStartDate`, `computeDeltaPercent`, `assembleVolumeOverview`, `productionWidgetDays`, …) that compose or post-process a query rather than performing one. They are deliberately excluded — count `export async function` in `db/queries/*.ts`, not `export function`.
- **30 exported Server Actions** across the 11 `'use server'` modules in `lib/actions/`. This is the same 30 CONSTRAINT-24 reconciles against the build manifest — if the two disagree, one of them is stale.

Full spec in `docs/api-spec.md`.

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
    pickups/
      page.tsx              ← server component — fetches pickup list + optional ?id= detail (Feature 15). Whitelists `?status=` against the four legal values (SEC-02) — the filter is interpolated into `AND p.status = $1`, and Postgres cannot cast an unknown label to the `pickup_status` enum, so an un-whitelisted value would 500 the route rather than filter
    calendar/
      page.tsx              ← server component — parses ?week=, fetches calendar + unscheduled rows for **both** groups (Feature 11; pickups added in Feature 15)
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
    NavDrawer.tsx           ← 'use client' — Framer Motion slide-over (left); 8 nav items (Dashboard, Customers, Orders, Pickups, Calendar, Leads, Invoices, Support) + Sign Out at bottom (FB-09)
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
  customers/                ← complete listing, reconciled against disk 2026-08-10
    CustomerLayout.tsx      ← 'use client' — two-panel state
    CustomerRightPanel.tsx  ← 'use client' — the right panel's three-way switch (`RightPanelMode`: detail / new-customer / edit-customer), split out of CustomerLayout
    CustomerList.tsx        ← 'use client' — the list panel; renders the search box and mounts CustomerStatusToggle, both of which write URL params rather than local state
    CustomerRow.tsx         ← 'use client' — one list row (Framer Motion; index-staggered entry)
    CustomerStatusToggle.tsx ← 'use client' — the Active/Inactive segmented filter above the list
    CustomerDetail.tsx      ← 'use client' — also exports `CustomerDetailEmptyState`
    CustomerForm.tsx        ← 'use client' — create+edit form shell (react-hook-form + field array for contacts)
    CustomerFormBasicFields.tsx ← 'use client' — the scalar half of the form (line-cap split)
    CustomerContactFields.tsx   ← 'use client' — the contacts field array, capped by `MAX_CONTACTS_PER_CUSTOMER` (line-cap split)
    customerFormSchema.ts   ← the form's shared contract: `CustomerFormValues`, `EMPTY_FORM_VALUES` / `EMPTY_CONTACT`, and the `detailToFormValues` / `formValuesToInput` mappers. Plain types + pure functions, no Zod (server-side validation lives in `lib/actions/customers.ts`) and no JSX, so both field files import it without a cycle
    DeleteCustomerDialog.tsx ← 'use client' — confirm dialog; `onConfirm` returns `{ error }` so a failed delete surfaces inline rather than closing silently
    CustomerContactCard.tsx ← 'use client' — Text/Email action buttons per contact; hrefs come from lib/contact-links.ts (Task 75 — it built them raw until then)
    CustomerAddresses.tsx   ← 'use client' — the saved-address book panel (Feature 14)
    useCustomerAddresses.ts ← 'use client' — add/edit/delete mutation state behind it
    OrderHistory.tsx        ← 'use client' — windowed order list on the detail view (`?window=`)
    PickupHistory.tsx       ← 'use client' — Feature 15 sibling of OrderHistory. Owns `?pwindow=`, deliberately **not** `window`: both panels sit on the same screen, and one shared param would make a click on either tab group silently re-filter the other. The five window options are the same five, from one `CustomerOrdersWindow` definition, so "3M" can never mean two things. Header carries a quiet `· N unscheduled` suffix from `getCustomerUnscheduledPickupCount`
    PickupHistoryParts.tsx  ← 'use client' — line-cap split (rows + the window tab strip)
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
  calendar/                 ← Feature 11, extended to two card groups in Feature 15 — most files are 'use client' (@dnd-kit + Framer Motion). Six carry no directive: `armPlacement.ts`, `calendarDnd.ts`, `calendarWeeks.ts`, `calloutMetrics.ts`, `productionCardFormat.ts`, `productionCardStatus.ts` — pure logic or constants, with no runtime import from a client-only library (CONSTRAINT-03)
    CalendarLayout.tsx      ← composition root; owns the one GroupedPlacement instance and threads it down
    CalendarHeader.tsx      ← the header bar: the two group toggles (Orders / Pickups) and both unscheduled callouts. Split out of CalendarLayout in Task 80
    CalendarBoard.tsx       ← the board itself (week strip + columns), split out of CalendarLayout in Task 80
    CalendarOverlays.tsx    ← everything drawn *above* the board — one card popup and one create drawer **per group**. Split out in Task 81 when the second drawer pushed CalendarLayout past CONSTRAINT-14's 80-line JSX allowance
    calendarScroll.ts       ← useWeekScroll — strip scroll position + the viewer's local "today"
    calendarWeeks.ts        ← buildWeekGroups + groupRowsByDay (keys cards by production_date)
    WeekStrip.tsx           ← week groups with a 2px Fri│Mon divider
    DayColumn.tsx           ← one weekday; **two** droppables and two SortableContexts, one per group
    DayColumnParts.tsx      ← DayHeader / ColumnBody / ColumnFooter (line-cap split)
    useColumnDroppables.ts  ← registers a column's two droppables (orders + pickups). A sibling rather than an addition to `calendarDnd.ts` for the same reason `calendarCollision.ts` is one — `useDroppable` is a runtime import and would force `'use client'` onto the type-only module
    ColumnPickupList.tsx    ← a day column's second list: its pickups, below the orders list and ordered independently of it
    DropPlaceholder.tsx     ← the accent outline drawn in the dragged card's own slot, which the sortable strategy moves to the insertion point — turning that slot into a live drop indicator
    ProductionCard.tsx      ← presentational card, context-free
    productionCardStatus.ts ← isBuiltStatus + built/active surface classes, shared with the dashboard widget (extracted 2026-07-27 at the 200-line cap)
    productionCardFormat.ts ← formatProductionMix (the `12×275 REC` line)
    productionCardColors.tsx ← COMBO_CLASS + ColoredMix — the mix line's size/type coloring (line-cap split)
    SortableProductionCard.tsx ← drag wrapper; the tap target that opens the popup, arms on touch long-press (Task 68)
    PickupCard.tsx          ← the pickup card face. **Amber surface with plain dark text** — deliberately not the green-275 / blue-330 size-and-type language, because a pickup has no type dimension and the two card kinds must never be misread for each other at the 80px card floor (CONSTRAINT-25)
    SortablePickupCard.tsx  ← the pickup drag/tap wrapper, mirroring SortableProductionCard
    PickupCardDialog.tsx    ← the pickup popup: status section, `Remove from calendar`, and the same ContactMenu the order popup uses. No same-day / backhaul toggles — a pickup carries neither
    CalendarDndContext.tsx  ← sensors (mouse/pen + keyboard — touch deliberately has none), group-filtered collision detection, auto-scroll, DragOverlay
    CalendarDragOverlay.tsx ← what the overlay carries and how it is drawn, as a tagged union over the two card kinds so the group and the row type can never disagree. Split out in Task 81 at the 200-line cap
    calendarDnd.ts          ← pure drop resolution, the `CardGroup` type, the composed droppable-id helpers and sensor constants (type-only @dnd-kit import — no `'use client'`, which is what lets any surface import it)
    calendarCollision.ts    ← `groupedCollisionDetection`: `closestCenter` restricted to droppables in the dragged card's own group. The value-importing half of the drop rules, so it carries the directive that `calendarDnd.ts` must not
    armPlacement.ts         ← Task 68 — pure tap resolution + arming constants; the touch counterpart of calendarDnd.ts
    useLongPressArm.ts      ← Task 68 — still-finger long-press detection, touch events only
    armMode.tsx             ← Task 68 — armed-card context + tap routing into the placement mutations
    cardSelection.tsx       ← context carrying "open this card's popup" to the card wrapper
    pickupVisibility.tsx    ← the fourth calendar context (see "Calendar contexts" below) — which of the two groups is drawn, plus the two toggles
    calendarLayoutHooks.ts  ← useCalendarActions / useNewOrderDay (line-cap split from CalendarLayout)
    useProductionPlacement.ts ← the four **order** calendar mutations + the shared `useCalendarMutation` (toast/refresh/error convention)
    usePickupPlacement.ts   ← the two **pickup** placement mutations, plus `useGroupedPlacement` — the single point at which a gesture chooses its table (see "The `group` discriminator" below)
    UnscheduledCallout.tsx  ← orders: amber count pill, dropdown, and drop-target for unscheduling
    UnscheduledPickupsCallout.tsx ← the pickup counterpart. A **second** droppable id, not a shared one — the two pills sit side by side in one header, and one id would make a cross-group drop a matter of which pill happened to be nearer the finger
    calloutMetrics.ts       ← the two callouts' shared dropdown sizing (`CARD_GAP_REM`, `LIST_PADDING_REM`, `DROPDOWN_MAX_HEIGHT`, the last expressed against `--card-h`). Both panels are the same panel with different cards in it, so one copy — these are the numbers that get tuned once on a device and silently drift apart. No `'use client'`: three constants, no hook, so it is valid in either graph
    useOpenOnDragOverTarget.ts ← opens a collapsed callout while a card is dragged over its pill, turning the whole panel into the drop target instead of a 44px pill. Each callout passes **its own** droppable id, which is what keeps the orders pill shut while a pickup is dragged over the pickups pill next door (CONSTRAINT-25). A sibling rather than an addition to `calendarDnd.ts` for the same reason `useColumnDroppables.ts` is one — `useDndMonitor` is a runtime import and would force `'use client'` onto the type-only module
    AddOrderMenu.tsx        ← the per-day pick list: two create actions (order / pickup) above two undated lists
    AddOrderMenuParts.tsx   ← its presentational pieces (line-cap split, Task 81)
    ProductionCardDialog.tsx ← the card popup. **No longer read-only** (Feature 12) — writes `same_day_delivery`, `backhaul` and status
    ProductionCardDialogParts.tsx / productionCardDialogHooks.ts ← line-cap splits; the hooks file holds the project's only focus trap + the nested-dialog Escape gate
    ProductionCardDialogControls.tsx ← the two pill toggles + the status section (Feature 12); passes the Contact menu into OrderStatusActions' leadingAction slot (Task 75)
    ContactMenu.tsx         ← Task 75 — the popup's Contact dropdown; one contact skips the picker, two or more nest one level as a single-open accordion
    ContactMenuTrigger.tsx / ContactMenuParts.tsx ← line-cap splits; trigger button, and the stateless channel/contact rows
    newOrderDay.tsx      ← context carrying "start a new order on this day" up to the layout, mirroring cardSelection.tsx
    NewOrderDrawer.tsx   ← DetailDrawer + OrderForm mode="create", hosted on /calendar (Feature 12)
    NewPickupDrawer.tsx  ← the sibling for pickups (Feature 15). Mounts the Pickups tab's `PickupForm` verbatim rather than a calendar-specific form — a pickup created here is the same record with the same rules
  pickups/                  ← Feature 15 — most files are 'use client'; `pickupFormSchema.ts` and `PickupStatusBadge.tsx` carry no directive (pure schema / presentational, no client-only runtime import)
    PickupLayout.tsx        ← two-panel state, mirroring OrderLayout
    PickupTable.tsx         ← unbounded list (scrolls, never paginates); search input is debounced because every keystroke would otherwise refetch the full result set
    PickupTableParts.tsx    ← presentational split at the 80-line JSX cap
    PickupRow.tsx           ← one row; reuses the orders table's `formatPoTotal` verbatim so a zero count renders as the same em dash on both tables
    PickupStatusTabs.tsx    ← three tabs, each 1:1 onto a `pickups.status` value — unlike the Orders tabs, where "Completed" also matches `invoiced`
    PickupStatusBadge.tsx   ← the same three-colour language as OrderStatusBadge, minus the `invoiced` entry
    PickupDetail.tsx        ← right panel; status transitions surface their failure inline rather than silently no-op'ing (EH-01)
    PickupDetailParts.tsx   ← line-cap split
    PickupForm.tsx / PickupFormFields.tsx / usePickupForm.ts / pickupFormSchema.ts ← create+edit form, its fields, its submit flow, and its value shape + action-input transforms. `PickupFormFields` imports `FieldRow` / `FORM_INPUT_CLASS` straight from `components/shared/formFields`, so the two forms cannot drift visually. The schema file used to re-export the class string via `components/orders/orderFormSchema`; that two-hop re-export was removed — a pickup file has no reason to reach through the orders vertical for a shared primitive
    PickupAddressSelect.tsx ← thin adapter mapping the pickup form's `address` / `address_id` onto the shared `components/shared/AddressSelect`
  leads/
    LeadLayout.tsx          ← 'use client' — two-panel state
    LeadList.tsx            ← 'use client'
    LeadDetail.tsx          ← 'use client' — Text + Email + Edit + Convert action buttons
                               (Text/Email hrefs built by `lib/contact-links.ts`, never inline)
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
  shared/                   ← the cross-vertical primitives. Anything two verticals both mount belongs here, not in whichever one built it first
    QtyGrid.tsx             ← 'use client' — reusable 2×3 size×type grid (display + input modes); used by OrderForm and OrderDetail (FB-10 / Feature 9 / CONSTRAINT-18)
    QtyGridRow.tsx / QtyGridCells.tsx ← line-cap splits (one type row; the display/input cells)
    qtyGridValues.ts        ← the cross-surface data contract + formatting helpers. No JSX, so tables, widgets and schemas can import it without pulling in a component (CQ-03)
    AddressSelect.tsx       ← 'use client' — the saved-address picker. **Moved here from `components/orders/` when the pickup form became its second consumer** (Feature 15); `components/orders/AddressSelect.tsx` is now a thin adapter over it, as `components/pickups/PickupAddressSelect.tsx` is
    useAddressSelect.ts     ← form-agnostic bridge between the picker and whichever react-hook-form owns the fields, plus the sentinel `<option>` values (real options carry a `customer_addresses` UUID, so neither sentinel can collide with one)
    useMruAddressPreselect.ts ← resets the selection when the customer actually changes, then pre-selects that customer's most-recently-used address (`getActiveCustomersForSelect` returns them MRU-first, so index 0 is it)
    formFields.tsx          ← `FieldRow` + `FORM_INPUT_CLASS`. Moved out of `components/orders/`, which was fine only while orders were the sole consumer. **Consumed by four surfaces, not all of them** (verified against disk 2026-08-10): orders (`OrderFormFields`, `OrderContainerFields`, `OrderLogisticsFields`), pickups (`PickupFormFields`), customers (`CustomerFormBasicFields`, `CustomerContactFields`, `CustomerAddresses` — `FORM_INPUT_CLASS` only, no `FieldRow`) and `shared/AddressSelect`. Every consumer imports from here directly; there are no re-export hops through a vertical's schema file
                              ⚠ **Known inconsistency — leads and support do not use it.** `components/leads/leadFormSchema.ts` and `components/support/NewTicketFormFields.tsx` each declare their **own** `FORM_INPUT_CLASS`, and it is a *different* string: `bg-muted rounded-lg border-0 …` against this file's `rounded-md border border-border bg-card …`. So the two older forms are visually a distinct input language, and the support one is not even shared with leads — it is a third copy that merely happens to match. This is unreconciled drift, not a decision. Do not describe `formFields` as the primitive "every form surface" uses; it is the primitive orders/pickups/customers/AddressSelect use. Folding leads and support in is a visual change to two live screens and needs its own task
    BackhaulTag.tsx         ← 'use client' — compact `B` tag for any PO list surface (created in Task 42)
    SameDayTag.tsx          ← 'use client' — compact amber `SD` tag mirroring BackhaulTag; used by the calendar card and the dashboard production widget (moved here 2026-07-27)
  ui/                       ← shadcn/ui generated components
```

> **Not in the tree, and deliberately so:** there is **no PO document upload component**. Tasks 19/33 were cut, so nothing under `components/orders/` uploads or renders a PO document, and the `po-documents` storage bucket (see Infrastructure) has no writer in the app. Earlier revisions of this file listed a `PODocumentUpload.tsx` annotated "placeholder"; it never existed on disk and has been removed rather than left to read as a real file.

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

## The Two-List Calendar (Feature 15)

`/calendar` draws two entities from two tables in one drag-and-drop surface. Five patterns hold that apart; all five bind any future work on the calendar, and the first three bind any third group added to it.

### 1. The `group` discriminator, and its single switch point

Every drag payload, every droppable and every armed-mode tap carries a `group: 'order' | 'pickup'` (`components/calendar/calendarDnd.ts`). **`useGroupedPlacement` in `components/calendar/usePickupPlacement.ts` is the one place a calendar gesture chooses which table it writes to.** Every caller above it — `CalendarDndContext`, `useArmModeState`, the day columns — is group-agnostic and receives a target that already knows its own group. The switch exists exactly once, where it is visible, so no caller can route a pickup into an order mutation by omission.

Both halves share one `useCalendarMutation`, so a failed pickup write toasts, logs and refreshes exactly like a failed order write rather than growing a second error convention. The order half additionally returns the popup's `setSameDay` / `setBackhaul`, which have no pickup counterpart.

**The discriminator is re-validated server-side, symmetrically.** `setProductionPlacementInputSchema` requires `group: z.literal('order')` and `setPickupPlacementInputSchema` requires `group: z.literal('pickup')`, so a payload built for one action and sent to the other is rejected by Zod before any query runs. The client routing correctly is not the guarantee; the literal is. Each action then *also* resolves the id against its own table, so an order id fails the pickup action whatever the payload claims — two independent checks, neither trusting the client.

> **If you add a third group, this is the file to change** — and the only one. Adding a branch anywhere above `useGroupedPlacement` reopens exactly the failure the design closes.

### 2. Composed droppable ids and group-pre-filtered collision detection

A day column's orders list is keyed by the bare `dateKey`; its pickups list by `pickups:${dateKey}` (`pickupColumnDroppableId`). Sortable lists compose the same way, `${group}:${dateKey}`, so a Monday orders list and a Monday pickups list are two distinct lists rather than one dnd-kit would happily reorder across. The two unscheduled callouts likewise have two ids, not one — they sit side by side in a single header, and a shared id would make a cross-group drop a matter of which pill was nearer the finger.

`groupedCollisionDetection` (`components/calendar/calendarCollision.ts`) filters candidate containers to the dragged card's own group **before** `closestCenter` runs. This is where "an order cannot be dropped into the pickup list" is enforced for the *preview*, not just the write: refusing at drop time comes too late to be honest — dnd-kit would still report the pickup list as `over`, the sortable strategy would part its cards to show a slot, and the card would snap back with no explanation. `resolveDropTarget` keeps its own cross-group check as a last line, because a silent write to the wrong table is the one failure this feature cannot recover from and the check costs one comparison.

### 3. `pickupVisibility.tsx` — the fourth calendar context

The calendar now has four contexts: `cardSelection` (open this card's popup), `newOrderDay` (start a new row on this day), `armMode` (touch tap-placement) and `pickupVisibility` (which groups are drawn). All four exist for the same reason — the trigger and its consumer are three or four levels apart, and threading state through `WeekStrip → DayColumn → ColumnBody → list` would add eight prop hops to reach one decision.

**`pickupVisibility`'s default is deliberately inert**: the real defaults (orders on, pickups off) paired with no-op setters. A `DayColumn` or a card therefore still renders outside a calendar — which is what every existing `DayColumn` test does — and behaves exactly as it did before pickups existed. Nothing persists the toggles: no localStorage, no URL param, no cookie. This app stores no client state anywhere and two booleans are not the reason to start (CONSTRAINT-25).

### 4. `calendarDateSchema` vs `productionDateSchema` — the weekday rule is now opt-in

`lib/actions/dates.validation.ts` exports two date schemas, and **which one a new date field picks is a real decision, not a formality**:

| Schema | Guarantees | Used by |
|---|---|---|
| `calendarDateSchema` | a real `yyyy-MM-dd` day — shape *and* existence, so `2026-02-31` is a validation message rather than an opaque Postgres driver error | `pickups.validation`, `pickups.calendar.validation` |
| `productionDateSchema` | the above **plus** `isBusinessDay` (CONSTRAINT-19) | `orders.validation`, `calendar.validation` |

`productionDateSchema` is literally `calendarDateSchema` plus one refinement. A pickup takes the base: the calendar renders Mon–Fri, so a dragged pickup lands on a weekday in practice, but a collection is not production and the server must not invent a business-day invariant the entity does not have. Reach for `productionDateSchema` only when the weekend genuinely cannot render the row.

### 5. `recordDeliveryAddressUsage` is shared between `createOrder` and `createPickup`

`lib/actions/orders.addresses.ts` (still under the `orders.` prefix — it predates the second caller) holds the address-book bookkeeping both create actions run: bump `last_used_at` when a saved address was picked, single atomic `ON CONFLICT` upsert when the text was typed fresh, no writes at all when the customer collects or the field is blank. `addressBelongsToCustomer` — the SEC-03 ownership gate — is shared the same way, and both actions call it *before* their insert so a forged address id fails the whole create.

Feature 15 added an `operation` param (defaulting to `'createOrder'`) purely so the failure log names the action that actually ran (EH-02); a line hardcoded to `createOrder` would point an incident at the wrong table. Failures are contained rather than propagated: the row is already committed, and failing the create at that point would tell the salesperson it failed when it did not, pushing them into a duplicate-PO retry.

---

## Database Layer

```
db/
  schema/
    enums.ts          ← all pgEnum definitions
    customers.ts      ← customers + customer_contacts + customer_addresses tables
    orders.ts         ← orders table
    pickups.ts        ← pickups table (Feature 15). FK to `customers` is `restrict`, matching orders — pickup history is never orphaned by a customer delete (CONSTRAINT-13)
    leads.ts          ← leads + lead_notes tables
    invoices.ts       ← invoices table
    support.ts        ← support_tickets + support_attachments tables
    index.ts          ← re-exports all
  queries/
    dashboard.ts      ← getDashboardStats, getNeedToContactList, getRevenueTrendData, etc.
    customers.ts      ← getCustomers, getCustomerDetail, getCustomerOrders, getCustomerVolumeOverview (+ the sync helper computeWindowStartDate). Detail/select/volume/SQL siblings: customers.detail.ts, customers.select.ts, customers.volume.ts, customers.sql.ts
    orders.ts         ← getOrders, getOrderDetail
    pickups.ts        ← getPickups, getPickupDetail, getCustomerPickups, getCustomerUnscheduledPickupCount (Feature 15). `CustomerPickupsWindow` aliases `CustomerOrdersWindow` rather than redeclaring the five options, so the two history panels cannot disagree about what "3M" means
    pickups.calendar.ts ← getCalendarPickups, getUnscheduledPickups + CalendarPickupRow. Its projection mirrors `CALENDAR_SELECT_LIST` in `calendar.ts` field for field, including the embedded `contacts` aggregate — a pickup popup's Contact menu must offer the same people the order popup does, and one shared shape is what stops the two drifting
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
    customer-addresses.ts ← addCustomerAddress, updateCustomerAddress, deleteCustomerAddress (Feature 14)
    orders.ts        ← createOrder, updateOrder, updateOrderStatus
    orders.revert.ts ← revertOrderToScheduled (FB-08; sibling extracted at the 300-line cap)
    orders.internal.ts ← defaultProductionDate + write-shape helpers (no 'use server')
    orders.addresses.ts ← addressBelongsToCustomer (the SEC-03 ownership gate) + `recordDeliveryAddressUsage`, the MRU address-book bookkeeping. **Shared by `createOrder` and `createPickup`** (see below). No 'use server' — internal to the actions, never client-invokable
    orders.validation.ts ← Zod schemas + helpers + constants for the orders actions (FB-10 / Platform-Native Rule sibling — `'use server'` files export async only)
    pickups.ts       ← createPickup, updatePickup, updatePickupStatus (Feature 15)
    pickups.validation.ts ← Zod schemas for them. Reuses `QUANTITY_MAX` / `DELIVERY_ADDRESS_MAX` / `NOTES_MAX` from `orders.validation` rather than redeclaring the limits, and `UUID_RE` from `lib/validators/uuid`
    pickups.calendar.ts ← setPickupPlacement, clearPickupPlacement (Feature 15)
    pickups.calendar.validation.ts ← Zod schemas; reuses `SORT_INDEX_MAX` from `calendar.validation` so the two lists share one sanity bound
    calendar.ts      ← setProductionPlacement, clearProductionPlacement, toggleSameDayDelivery, toggleBackhaul (Feature 11–12)
    calendar.validation.ts ← Zod schemas + SORT_INDEX_MAX (Platform-Native Rule sibling)
    dates.validation.ts ← ISO_DATE_RE + the two date schemas, `calendarDateSchema` and `productionDateSchema` (see below). Extracted in Feature 12 so every writer enforces the invariant from ONE rule; a direct re-export between `orders.validation.ts` and `calendar.validation.ts` would have closed an import cycle and left ISO_DATE_RE in the TDZ
    leads.ts         ← createLead, updateLead, addLeadNote, setNextAction, convertLeadToCustomer
    leads.convert.ts ← loadLeadForConversion, findDuplicateCustomer, runConversionTransaction — helpers for convertLeadToCustomer, extracted at the 300-line cap (no 'use server' — none of them guards, the guard lives once at the leads.ts entry point, so the directive would publish three unauthenticated endpoints; SEC-08 / CONSTRAINT-24). It carried the directive until 2026-08-09; see FB-24
    invoices.ts      ← createInvoice (v3; markInvoicePaid removed)
    invoices.constants.ts ← INVOICE_EXISTS_CODE sentinel (Platform-Native Rule sibling)
    support.ts       ← createTicket, uploadTicketAttachment, getSupportAttachmentSignedUrl (3 exports — the same 3 CONSTRAINT-24 counts; the signed-URL reader is an action, not a query, because it mints a credential and must be guarded)
  hooks/
    useToast.ts       ← toast queue hook
    useDismissOnOutsideOrEsc.ts ← Task 75 — open-gated outside-press + Escape dismissal, shared by ContactMenu and QuickAddFab. Options carry the two call sites' real differences (pointerdown vs capture-phase mousedown; whether the dismissing press is swallowed) rather than flattening them
  animations.ts       ← shared Framer Motion variant constants
  calendar-range.ts   ← parseCalendarWeek + buildCalendarRange for the /calendar route's ?week= param
  contact-links.ts    ← smsHref / mailtoHref / isPresent / isReachable. The ONE place `sms:` and `mailto:` hrefs are built. Both sides of the mailto `@` are percent-encoded — the email column is hand-typed free text, and a raw `?cc=` in it would open a draft with a silent CC that reads as normal. Phone sanitizing strips a trailing extension only (an unanchored `x` ate the number in `Text 555-0100`)
  format-currency.ts  ← shared USD formatter, drops trailing zeros (e.g. 25.50 → $25.5)
  dates.ts            ← DB_DATE_FORMAT + the business-day helpers (isBusinessDay,
                        prevBusinessDay, nextBusinessDay, startOfBusinessWeek,
                        businessWeekDays, parseDbDate). `prevBusinessDay` has
                        exactly one caller — defaultProductionDate at order
                        creation. Nothing derives a card's position at read
                        time (CONSTRAINT-19)
  errors.ts           ← named error classes + GENERIC_FAILURE_MESSAGE (client-safe home of
                        the fallback copy; auth.guard.ts re-exports it for server actions).
                        DatabaseError, InvalidDateError, and one *NotFoundError per entity:
                        Customer, Order, **Pickup**, Lead, Invoice, Ticket, Attachment
  validators/
    uuid.ts           ← UUID_RE + isUuid — the one UUID shape check, imported by every
                        action and every page that reads an `?id=`
  parse-initial-mode.ts ← shared `?new=1` deep-link parsing for the list screens
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
Row Level Security (RLS) on all **10** tables — `customers`, `customer_contacts`, `customer_addresses`, `orders`, `pickups`, `leads`, `lead_notes`, `invoices`, `support_tickets`, `support_attachments`. Policy: `FOR ALL TO authenticated USING (true) WITH CHECK (true)`. Single user — any authenticated session has full access. RLS prevents any unauthenticated query from returning data, even if server-side code has a bug.

**Every new table ships its RLS in the same migration that creates it** (CONSTRAINT-05). Migration `0015` does this for `pickups`: `ENABLE ROW LEVEL SECURITY` plus the standard `authenticated_access` policy, in one file. This count was last reconciled against the migrations on 2026-08-10; it had drifted twice before then (`customer_addresses` in Feature 14, `pickups` in Feature 15), so re-check it whenever a table is added rather than trusting the number.

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

Next.js enforces invariants that don't appear in the generic rules files but are binding for any code touching this repo. The first three were surfaced by the first production build (2026-04-22) under Next 14 and still hold under 15. The fourth arrived with the Next 15 upgrade (Task 83, 2026-08-11).

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

### Request APIs are async — `createClient()` must be awaited
Since Next 15, `cookies()`, `headers()`, `draftMode()`, `params` and `searchParams` are all promises. Two consequences bind every future file:

**`createClient()` from `lib/supabase/server.ts` is async.** Every call site must `await createClient()`. It is called inside a `try` that converts a non-server-context call into a described error; that failure is now an async rejection rather than a synchronous throw, so any test asserting it must use `.rejects`, not `expect(() => ...).toThrow()`. Eleven call sites across six files at the time of the upgrade.

**Page `searchParams` is a promise.** The established shape — used by all eight pages that read it — is:

```ts
interface XPageProps { searchParams: Promise<{ /* ... */ }> }

export default async function XPage(props: XPageProps) {
  const searchParams = await props.searchParams
  // every downstream reference is unchanged
}
```

Take `props` whole rather than destructuring `{ searchParams }` in the signature. It keeps the awaited value under its original name, so the body needs no edits — the customers page has seven references that would otherwise all have to change.

Note this does **not** relax the `force-dynamic` rule above; the two are independent.

### TypeScript CSS side-effect import declaration
`import './globals.css'` in `app/layout.tsx` requires an ambient module declaration because TypeScript doesn't natively recognise CSS side-effect imports. The project ships one at `globals.d.ts` (`declare module '*.css'`). Dev tolerates the missing declaration; `tsc --noEmit` and the production build reject it.

---

## Performance Considerations

- Need-to-Contact calculation: computed at query time via SQL aggregation. Single-user with hundreds of orders — runs in milliseconds. No background job or materialized view needed. A customer with a scheduled order is never overdue (`overdue_days` NULL, excluded from the widget) — an order is already booked, so there is nothing to contact them about (Task 74, 2026-08-02).
- **Calendar range filter is index-backed again (2026-07-27).** `getCalendarOrders` now filters on the bare column (`o.production_date >= from AND <= to`), which is sargable, so `orders_production_date_idx` serves it. The previous `COALESCE(production_date, …)` form forced a sequential scan and was logged as **FI-02**; removing the read-time derivation removed the problem rather than working around it. No functional index is needed.
- Server Components: data fetched before page renders — no client-side loading state for initial content.
- Animations: `useReducedMotion()` checked in all animated components — instant transitions when accessibility preference set.
- Recharts: `animationDuration={0}` when `useReducedMotion()` is true.
