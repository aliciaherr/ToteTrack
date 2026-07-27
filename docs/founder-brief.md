# Founder Brief: ToteTrack

> Plain-language record of every significant architectural decision made during `@plan` Phase 2.
> `docs/architecture.md` cannot change without a corresponding update to this file.
> One entry per decision. Format: date, decision title, architecture section reference, four fields.

---

## FB-01 — Server Actions, No REST API

**Date:** 2026-04-20
**Architecture section:** `docs/architecture.md` → API Structure

**Decided:** Using Next.js Server Actions for all mutations and Server Components for all data fetching — no separate REST API layer.

**Means for your product:** No API endpoints to manage or secure separately. Data loads server-side before the page renders — faster first paint on iPad. Mutations are type-safe TypeScript functions called directly from client components — no JSON request/response boilerplate to maintain.

**Check before approving:** This app never needs to be called from outside a web browser. No external tool (QuickBooks, calendar, mobile app) will ever need to POST to ToteTrack programmatically. ✓ Confirmed out of scope in kickoff.

**What this closes off:** Building a native mobile app later would require extracting Server Actions into REST endpoints — a non-trivial refactor. No external API consumers are possible without that refactor.

---

## FB-02 — Supabase Storage for File Uploads

**Date:** 2026-04-20
**Architecture section:** `docs/architecture.md` → Infrastructure, Security Architecture

**Decided:** PO documents and support attachments stored in private Supabase Storage buckets, served via server-generated signed URLs (1-hour expiry).

**Means for your product:** Files are never publicly accessible — a guessed URL returns 403. Downloads require an active authenticated session to generate the signed URL. $0 cost up to 1GB total.

**Check before approving:** The 1GB ceiling: at 10MB max per PO document, that's roughly 100 PO documents before hitting the limit. Typical PDFs are 100KB–500KB, giving substantially more headroom. For a single salesperson, this is likely years of documents at realistic volumes.

**What this closes off:** Migrating to a different storage provider (S3, Cloudflare R2) touches every upload and download in the codebase. Low risk of needing to do this within the project's current scope and user volume.

---

## FB-03 — RLS as Primary Authorization Layer

**Date:** 2026-04-20
**Architecture section:** `docs/architecture.md` → Security Architecture

**Decided:** Row Level Security (RLS) enabled on all 8 Supabase tables as the primary authorization layer, with server-side session validation as a secondary check.

**Means for your product:** Two independent layers protect the data. Even if a bug in server-side code accidentally skips the session check, the database itself refuses unauthenticated queries. For a tool holding business-sensitive sales data, defense in depth is the right posture.

**Check before approving:** Nothing to check here — this is the correct security pattern for Supabase apps and has no downsides for a single-user tool.

**What this closes off:** Nothing. RLS is additive and does not restrict future architectural changes.

---

## FB-04 — Need-to-Contact Calculated at Query Time

**Date:** 2026-04-20
**Architecture section:** `docs/architecture.md` → Performance Considerations

**Decided:** The Need-to-Contact overdue calculation is computed at query time via SQL aggregation (Drizzle raw SQL for the interval calculation) — not stored as a pre-computed column and not maintained by a background job.

**Means for your product:** The Need-to-Contact list is always current — it reflects the exact state of the order history at the moment the page loads. No delay, no stale data, no background job to manage or fail.

**Check before approving:** This means every dashboard load runs the aggregation fresh. For a single user with a realistic order history (hundreds of orders, not millions), this query runs in milliseconds. There is no performance concern at this scale.

**What this closes off:** If this were ever multi-tenant with thousands of users, you would want pre-computed materialized views. Not a concern for this project's scope — and even then, the migration path is straightforward.

---

## FB-05 — Platform-Native Rules Documented

**Date:** 2026-04-22
**Architecture section:** `docs/architecture.md` → Platform-Native Rules

**Decided:** Four Next.js 14 invariants that aren't in the generic rules files are now documented as binding rules for this codebase: (1) `'use server'` files export only async functions — non-function exports live in sibling `*.constants.ts` files; (2) client components must not value-import from `db/queries/*` — types only, values live in `*.constants.ts` siblings; (3) authenticated routes declare `export const dynamic = 'force-dynamic'` to opt out of static prerender; (4) `globals.d.ts` declares `*.css` modules so TypeScript accepts side-effect CSS imports.

**Means for your product:** Nothing visible changes in the app. What changed is the documentation — anyone (including future-you) touching the codebase now has a written record of platform rules that dev mode doesn't enforce but production strictly does. Before this, these rules were tribal knowledge; they stayed invisible until the first production build failed on all four at once.

**Check before approving:** These are not chosen decisions — they are rules Next.js enforces. Writing them down doesn't commit us to anything new; it prevents the same class of bug from biting again. No downside.

**What this closes off:** Nothing. This is a documentation tightening, not an architectural constraint. If Next.js ever relaxes any of these rules in a future major version, update the document; no code migration is required.

---

## FB-06 — DetailDrawer (CSS-only responsive pattern)

**Date:** 2026-04-22
**Architecture section:** `docs/architecture.md` → Component Architecture (Component Tree)

**Decided:** All four selection-driven two-panel screens (Customers, Orders, Leads, Invoices) wrap their right panel in a single shared `components/shell/DetailDrawer.tsx` component. Above 1024px the right panel renders inline as a normal grid column; below 1024px it renders as a fixed slide-over from the right with a backdrop and close button. The switch between modes is pure CSS (Tailwind `lg:` modifiers) — no JavaScript media-query detection.

**Means for your product:** The app actually works on iPad in portrait orientation now, not just landscape. Before this, clicking a customer / order / lead / invoice on a narrow viewport silently did nothing — the right panel was display-hidden. After this, the detail slides in from the right as an overlay, exactly the way native iPad apps behave. On wide viewports nothing visibly changes — the inline two-panel layout is preserved.

**Check before approving:** No JS media query means no SSR hydration mismatch and no client/server rendering divergence. The trade-off is that the drawer DOM is always present below lg (just translated off-screen) — accepted because focus trap and body-scroll-lock were also skipped for v1 simplicity. Internal tool, single user, no accessibility-compliance bar.

**What this closes off:** Nothing. The drawer is a presentation pattern — a future redesign could swap it for any other responsive treatment without touching the underlying actions or queries.

---

## FB-07 — Invoice Model v3: One per Month, No Status, No Customer

**Date:** 2026-04-22
**Architecture section:** `docs/architecture.md` → Data Model

**Decided:** Invoices are now month-level only. The `invoices` table dropped `customer_id` and `status` (and the `invoice_status` enum). One invoice per calendar month covers every completed PO across every customer. When the salesperson tries to generate an invoice for a month that already has one, an Overwrite confirmation modal fires; confirming deletes the existing invoice (its orders detach back to `completed`) and creates a fresh INV-#### with the current eligible POs. Existing per-customer invoices in the DB lose their customer_id at migration time but stay queryable via the PO chain.

**Means for your product:** Invoicing is one click per month instead of one click per (customer × month). The customer dropdown is gone. The Mark-as-Paid button is gone (no status to track). The invoice ledger is just a chronological list — newest month first. Past per-customer invoices still exist but no longer carry a customer label on the invoice header itself; the PO rows in the detail view show each PO's customer instead.

**Check before approving:** Two trade-offs the builder explicitly accepted: (1) draft/paid status is gone forever — losing this means you can't track "which invoices have been paid" inside the app (no automatic or manual flow uses this distinction in your workflow); (2) overwriting generates a new INV-#### number rather than reusing the deleted invoice's number, so the deleted number is retired. Acceptable for an internal draft-only invoice system.

**What this closes off:** Adding back a per-customer invoice model would require a schema migration to re-add `customer_id` and a backfill strategy. Adding back a draft/paid distinction is similarly a schema-level change. The current model is the right one for the salesperson's monthly-batch invoicing workflow; reverting requires real architectural work.

---

## FB-08 — Revert from Terminal States

**Date:** 2026-04-22
**Architecture section:** `docs/architecture.md` → Data Model (PO state machine)

**Decided:** The PO state machine relaxes its terminal-state rule. `completed`, `cancelled`, and `invoiced` orders can all be reverted to `scheduled` via a new `revertOrderToScheduled` action. Reverting an invoiced order also detaches it from its invoice, recomputes the invoice's `total_amount`, and deletes the invoice entirely if it ends up with zero orders.

**Means for your product:** The salesperson can fix mistakes. If you accidentally mark a PO complete, you can revert it. If you cancel an order that gets uncancelled, you can revert it. If a PO landed on the wrong invoice, reverting pulls it off and the invoice total updates (or the invoice disappears if it was the only PO). Before this, terminal states were truly terminal — fixing a mistake meant deleting and re-creating the order.

**Check before approving:** The auto-delete of an emptied invoice has a subtle implication — the invoice's INV-#### number can be reused later (since `nextInvoiceNumber` uses `MAX(suffix)+1`), specifically when the deleted invoice was the most recent one. Acceptable for an internal draft-only invoice system; would not be acceptable for a system that emits formal sequential invoices to external parties.

**What this closes off:** Nothing meaningful. The state machine remains directional (you can't jump from cancelled directly to invoiced) — the revert-to-scheduled is the only escape hatch, and from scheduled the user can re-traverse the forward paths.

---

## FB-09 — Sole-Chrome Shift + Drawer-State Context Primitive

**Date:** 2026-04-23
**Architecture section:** `docs/architecture.md` → Component Architecture → shell/ + dashboard/

**Decided:** The app's chrome on authenticated routes is reduced to a single pill-contained hamburger button anchored top-left — no top bar, no logo, no global search, no notification bell, no user avatar. The dashboard adds a speed-dial Quick-Add FAB anchored bottom-right with three options (Purchase Order / Customer / Lead) that navigate to the destination screen with a `?new=1` deep link, opening the existing create form on mount. To let the FAB react to drawer open/close without prop drilling, AppShell now publishes drawer state through a React Context (`useAppShellDrawerState`) — the first cross-component shared-state primitive in this project, intended as the canonical pattern for any future shell-aware UI signal.

**Means for your product:** Less chrome means more vertical real estate for content on the iPad — the salesperson sees more rows of customers / orders / invoices per screen. The FAB compresses the most common daily action (add a new customer / PO / lead) from three taps (open drawer → tap nav → tap "+ New") to two (tap "+" → tap option). Sign Out is now reachable inside the drawer — a latent gap was that the server action existed but no UI called it; the salesperson previously couldn't log out from the app at all without manual session-cookie clearing.

**Check before approving:** The chrome is now intentionally minimal — for a single-user internal tool this is the right call, but it deviates from the Stitch mockup. The deviation is documented in `docs/design-decisions.md` under "Deliberate Deviations from Mockup" alongside the existing sidebar→drawer deviation. If the salesperson ever asks "how do I find X" and the answer is "the hamburger menu," the cost was real.

**What this closes off:** Adding chrome elements back (notifications, profile menu, global search) requires either re-introducing a top bar or finding non-chrome spots for them — both involve real layout work, not a single component swap. The drawer-state Context is small and additive — it doesn't lock out alternative shared-state patterns (Zustand, Jotai, etc.) in the future, but introducing one now sets a precedent that future cross-shell signals should default to React Context unless there's a real reason not to.

---

## FB-10 — PO Multi-Combo Wide-Row Schema

**Date:** 2026-04-24
**Architecture section:** `docs/architecture.md` → Component Tree (`components/shared/QtyGrid.tsx` + `lib/actions/orders.validation.ts` additions); also CONSTRAINT-18

**Decided:** Restructured the PO data model from single-combo (one `container_size` + `container_type` + `quantity` per PO row) to wide-row (6 typed integer quantity columns, one per fixed size×type combination — `qty_275_recon`, `qty_275_rebot`, `qty_275_new`, `qty_330_recon`, `qty_330_rebot`, `qty_330_new`). Total `price` stays a single user-entered value — no per-unit pricing, no global pricing settings, no per-PO unit-price overrides. The reusable `<QtyGrid>` component at `components/shared/` handles both display (read-only) and input (controlled) variants of the 2×3 grid.

**Means for your product:** A PO can now hold any mix of the 6 size×type combinations in a single record — matching how customers actually order. Most POs include 2–3 combos (per the salesperson). Before this, the salesperson would either fragment one real PO into multiple app POs (corrupting customer-level frequency / volume / last-sale analytics) or lose data fidelity by entering only one combo. Daily friction that compounded. Customer Volume Overview averages now reflect actual purchase mix, not a fragmented version of it. The orders table and other PO list surfaces show a clean `275 | 330` totals pattern + a compact `B` backhaul tag — no more cluttered Type badge column.

**Check before approving:** (a) Wide-row beats normalized line-items (separate child table) here because the universe of size×type combos is fixed at 6 by CONSTRAINT-09 — a child table would add join cost with zero flexibility benefit and a uniqueness constraint requirement. Confirmed during brainstorm. (b) Total `price` stays user-entered (not derived from per-unit pricing) because the salesperson negotiates lump-sum prices, not per-unit. Per-unit pricing was explicitly rejected. (c) Atomic PO completion stays — Mark Complete fires for the whole PO, not per-cell. Per-combo state would multiply the state-transition logic 6× and isn't a real workflow per the salesperson. (d) Edit lock for invoiced / cancelled POs blocks qty + price changes only — other field edits (notes, address, etc.) still allowed. Salespeople use the existing revert flow (FB-08) for genuine corrections.

**What this closes off:** Reverting to single-combo POs would require dropping 6 cols + restoring 3 + back-mapping multi-combo rows — lossy by definition and not realistically reversible. Adding per-unit pricing later requires either 6 more unit-price cols on each PO + a settings table OR a separate price-list model — explicitly rejected in this brainstorm; reopening requires a fresh assumptions pass. Adding partial fulfillment / per-combo state would multiply the state machine 6× — separate architectural change, not in scope. The `container_size` + `container_type` PostgreSQL enum types remain orphaned in `pg_type` after migration `0008` runs (intentional — to be dropped in a later cleanup migration once all TS code stops referencing them).

---

## FB-11 — Production Date as a Separate Column, with the Placement Rule Written Twice

**Date:** 2026-07-26
**Architecture section:** `docs/architecture.md` → Data Model (Production date vs delivery promise), Database Layer, Performance Considerations; also CONSTRAINT-19

**Decided:** The build day lives in its own database column, `production_date`, rather than reusing the delivery date. Where a PO has no build day set, the calendar shows it on the business day before its promised delivery — and that fallback rule is written twice on purpose: once in TypeScript (`lib/dates.ts`, for the browser) and once in SQL (`db/queries/calendar.ts`, for filtering). The two were verified to agree on all 43 rows of the live database.

**Means for your product:** Dragging a card on the calendar reschedules *production* and never touches what you promised the customer. That separation is the whole point of the feature — the first version of the idea would have had dragging silently rewrite delivery commitments. The cost is that a PO can now have a build day and a delivery day that disagree, and nothing flags it: if you set a build day and later change the delivery date, the card stays where you put it. That is intended (your explicit placement wins) but it means the calendar can drift from the orders list without warning.

Writing the rule twice is a real risk you should know about. If someone later changes the weekday logic in one place and not the other, a card would be *filtered into* one day column and *drawn in* another — a bug that is nearly invisible by eye. Three things guard against it: the SQL returns its computed answer as data so the browser never has to recompute placement; both files carry comments pointing at each other; and the agreement was proven against real data rather than assumed.

**Check before approving:** (a) Are you comfortable that changing a delivery date does *not* move an already-placed card, with no visual flag on the divergence? (b) The no-weekend rule is enforced when a date is *saved*, not when it is *read* — so a weekend date arriving by some other route (manual SQL, a future import) would display rather than error. There is no such route today. (c) The calendar query does not use the database index built for it, because wrapping a column in COALESCE makes indexes unusable. At tens of rows this is unmeasurable; it would matter at tens of thousands.

**What this closes off:** Collapsing production and delivery back into one date would mean deciding what happens to a card's placement when a promise moves — not a revert, a redesign. Holiday awareness needs a holidays table, an admin screen, and holiday-aware math everywhere `prevBusinessDay` is used. Weekend production needs 6–7 calendar columns and invalidates the no-weekend invariant the whole layout assumes.
