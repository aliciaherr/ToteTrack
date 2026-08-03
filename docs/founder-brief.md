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

> **Partly superseded by FB-13 (2026-07-27).** The decision to keep production date separate from the delivery promise still stands and is the foundation of the feature. The part about the placement rule being written twice no longer applies — both copies were deleted when card position became the stored column itself.

**Date:** 2026-07-26
**Architecture section:** `docs/architecture.md` → Data Model (Production date vs delivery promise), Database Layer, Performance Considerations; also CONSTRAINT-19

**Decided:** The build day lives in its own database column, `production_date`, rather than reusing the delivery date. *(As originally shipped, a PO with no build day set was shown on the business day before its promised delivery — and that fallback rule was written twice on purpose, once in TypeScript and once in SQL. Both were deleted on 2026-07-27; see FB-13.)*

**Means for your product:** Dragging a card on the calendar reschedules *production* and never touches what you promised the customer. That separation is the whole point of the feature — the first version of the idea would have had dragging silently rewrite delivery commitments. The cost is that a PO can now have a build day and a delivery day that disagree, and nothing flags it: if you set a build day and later change the delivery date, the card stays where you put it. That is intended (your explicit placement wins) but it means the calendar can drift from the orders list without warning.

Writing the rule twice is a real risk you should know about. If someone later changes the weekday logic in one place and not the other, a card would be *filtered into* one day column and *drawn in* another — a bug that is nearly invisible by eye. Three things guard against it: the SQL returns its computed answer as data so the browser never has to recompute placement; both files carry comments pointing at each other; and the agreement was proven against real data rather than assumed.

**Check before approving:** (a) Are you comfortable that changing a delivery date does *not* move an already-placed card, with no visual flag on the divergence? (b) The no-weekend rule is enforced when a date is *saved*, not when it is *read* — so a weekend date arriving by some other route (manual SQL, a future import) would display rather than error. There is no such route today. (c) The calendar query does not use the database index built for it, because wrapping a column in COALESCE makes indexes unusable. At tens of rows this is unmeasurable; it would matter at tens of thousands.

**What this closes off:** Collapsing production and delivery back into one date would mean deciding what happens to a card's placement when a promise moves — not a revert, a redesign. Holiday awareness needs a holidays table, an admin screen, and holiday-aware math everywhere `prevBusinessDay` is used. Weekend production needs 6–7 calendar columns and invalidates the no-weekend invariant the whole layout assumes.

---

## FB-12 — Drag-and-Drop Library Added to a Locked Stack

**Date:** 2026-07-27
**Architecture section:** `docs/architecture.md` → Stack, Component Boundary Rule; also CONSTRAINT-03 and CONSTRAINT-19

**Decided:** Two new packages were added to the project — `@dnd-kit/core` and `@dnd-kit/sortable` — to make the production calendar's cards draggable. Nothing already in the stack could do it. The calendar needs four things at once: dragging a card into a position *within* a day rather than just onto it, the strip scrolling itself when a card is dragged to the edge, keyboard-only dragging, and — hardest — telling the difference on an iPad between a finger dragging a card and a finger scrolling the page. Hand-writing that is weeks of work and a permanent source of bugs.

**Means for your product:** The calendar works by dragging, which is the whole point of it, and it works with a keyboard as well as a finger. The cost is two more dependencies to keep current — this is the first time anything has been added to the stack since it was set. It is worth being explicit that **no rule was broken**: CONSTRAINT-01 locks the stack against *substitutions* (swapping Framer Motion for something else, swapping Drizzle for Prisma), not against additions where the stack has a genuine hole. You approved this directly on 2026-07-26 without a `@cto` review, on that reading.

There is one open question this does not answer. The iPad touch behaviour is configured but has **never been tested on an actual iPad** — it is logged as assumption A-05, accepted with a fallback plan (tap a card to select it, then tap a day to place it) rather than validated up front. If the drag-versus-scroll distinction turns out to feel wrong on the real device, that fallback replaces the touch handling; the mouse and keyboard paths are unaffected.

**Check before approving:** (a) Are you comfortable that adding a dependency is now an established precedent — the next feature that needs something the stack lacks will point at this decision? (b) Would you rather future additions route through `@cto` for a second opinion, or is your direct approval the process? You raised this yourself as an open question and it is still unanswered. (c) A-05 remains unvalidated: the touch experience is a guess until someone drags a card on an iPad.

**What this closes off:** Very little, which is why it was an easy call. `@dnd-kit` is self-contained — it touches only the calendar components and could be removed by deleting them. What it *does* close off is the argument that the stack is immutable; from here, "the stack is locked" means "we don't swap what works," not "we never add." That is a weaker guarantee than before, and worth saying out loud rather than discovering later.

---

## FB-13 — Where a Card Sits *Is* Its Production Date (supersedes the second half of FB-11)

**Date:** 2026-07-27
**Architecture section:** `docs/architecture.md` → Data Model, Database Layer, Performance Considerations; also CONSTRAINT-19 (revised) and migration `0011`

**Decided:** A card's position on the production calendar is now simply the production date stored against that order. Nothing is worked out on the fly any more. If an order has no production date, it is not on the calendar — it sits in the amber "needs a production date" list at the top, no matter what delivery date it carries. The delivery date is used exactly once, when an order is first created, to pick a sensible starting day so you never face an empty calendar. After that it has no say in where a card sits.

**Means for your product:** "Remove from calendar" now removes the order from the calendar. Previously it didn't — the card sprang back to a day worked out from the delivery date, which is the behaviour you flagged the first time you used it. The deeper fix is that a card sitting on a day now always means *someone decided that day*. Before, a card that had been deliberately placed and a card that had never been touched looked identical and behaved differently, and there was no way to tell them apart.

There is a real trade. Because a card's day is now stored rather than calculated, **changing a delivery date will never move a card.** If a customer pushes their delivery out by a week, the production card stays exactly where it is and nothing rearranges itself. That is deliberate — production scheduling is your decision, and delivery dates are guidance, not instructions. The cost is that the two can drift apart quietly. That drift is unflagged, and deliberately so. An indicator was built and then removed on 2026-07-27: marking only "production is later than promised" was the wrong signal, and marking "the promise moved at all" would have required the database to remember which delivery date each production date was chosen against — a new column and a migration for a warning you judged you did not need. You look at the calendar daily; a build day that has drifted from its promise shows up in that review.

The other trade: the amber "needs a production date" list is now load-bearing. Previously the system could not lose an order — anything with a delivery date was auto-placed whether you asked or not. Now an order you unschedule waits in that list until you deal with it. That is the point, but it means the amber count is something to actually look at.

**Check before approving:** (a) Are you comfortable that a delivery-date change never moves a card, with nothing flagging the divergence? (b) The amber unscheduled list is now the only thing standing between an unscheduled order and being forgotten — is a count badge at the top of the calendar enough, or would you want it surfaced somewhere harder to miss? (c) A one-time database update (`0011`) wrote today's calculated positions into the database. You ran it and confirmed every card stayed put; that is what makes this change invisible rather than disruptive.

**What this closes off:** Very little, and it *opens* something up. The riskiest part of the original design is gone: the placement rule used to be written twice — once in TypeScript for the browser, once in SQL for filtering — and FB-11 called out that if the two ever drifted, a card would be filtered into one day and drawn in another, a bug that is nearly invisible by eye. Both copies have been deleted. There is now one stored fact and nothing to keep in sync. A performance caveat also disappeared: the calendar's date filter can finally use its database index, which it never could while the position was being calculated inside the query.

Going back would mean reintroducing derived positions, and with them both the drift risk and the "remove doesn't remove" behaviour. Holiday awareness, weekend production, and phone layouts remain closed off for the same reasons as before.

---

## FB-14 — Touch Drag Failed on the Real iPad; Hold-Then-Tap Replaces It

**Date:** 2026-07-27
**Architecture section:** spec in `docs/plan.md` → Feature 13, Task 68; diagnosis in `docs/assumptions.md` → A-05

**Decided:** The risk FB-12 warned about happened. On a real iPad, dragging cards is broken in every browser — and it is every browser at once because on the iPad, Chrome and Firefox are the same engine as Safari wearing different clothes; one engine's flaw shows up everywhere. Rather than tune the drag settings, dragging is being replaced on touch screens with a two-step gesture you already know from rearranging apps on a phone: **hold a card for about a third of a second and it "arms"** — it shakes and gets a bold outline — **then tap where it should go.** Tap another card and the armed card slots into that position, pushing the rest down. Tap the empty space at the bottom of a day and it lands last. Tap the amber unscheduled list and it comes off the calendar. Tap anything else — including the armed card itself — and nothing happens; it just calms down. While a card is armed you can still scroll freely, so moving something three weeks out is: hold, scroll, tap. The card flies to its new spot so you can see where it went. Mouse and keyboard on the desktop are completely untouched.

**Means for your product:** The calendar becomes genuinely usable on the device it was designed for. This design is also *more* reliable than a fixed version of drag would be, not a consolation prize: a dragged card has to follow a finger perfectly across a screen that is trying to scroll at the same time, while hold-then-tap never asks the browser to do two things at once. The scroll-then-tap trick replaces the fiddliest part of touch drag (hovering at the screen edge to make it auto-scroll) with plain scrolling.

**Check before approving:** (a) An armed card stays armed while you scroll and has no time-out — the only way out is a tap. Comfortable? (b) While a card is armed, tapping another card *places*, it does not open that card's popup — placement wins. That is the trade for keeping plain tap = popup. (c) The last touch design shipped marked "done" without ever touching an iPad, and that is exactly how this problem stayed hidden. Task 68 therefore has a hard rule: it cannot close until someone runs the whole gesture set on a real iPad. Hold this line.

**What this closes off:** Very little. The drag library stays (desktop still drags), so nothing is added or removed from the stack. If hold-then-tap *also* disappoints on the real device — unlikely, since it avoids the browser behaviours that broke drag — the remaining fallback is a "Move to date" picker inside the card popup: slower, but immune to gesture problems entirely.

---

## FB-15 — The Calendar Became a Place You Change Things, Not Just Look at Them

**Date:** 2026-07-27
**Architecture reference:** `docs/architecture.md` → Component Architecture (calendar tree), API Structure (revalidation), Database Layer (`lib/actions/dates.validation.ts`)
**Tasks:** Feature 12, Tasks 63–67

**Decided:** The production calendar now creates orders, flips the backhaul and same-day flags, and moves orders through their status lifecycle — work that previously required going to the Orders tab. It still cannot change quantities, prices, the customer, or the delivery promise.

**Means for your product:** The salesperson can plan a week without leaving the planning screen. A new PO can be created straight onto the day it will be built — and that day wins over the automatic "day before delivery" default, because clicking a specific day is a deliberate choice. An order can be marked complete or cancelled from the card itself. Cancelling removes it from the board; getting it back means going to the Orders tab, which is deliberate, since an accidental cancel should not be undoable with the same casual tap that caused it.

**Check before approving:**
- Is it right that creating an order from a day column **ignores** the delivery date you type into the form? A PO due Friday, created by clicking Tuesday, builds Tuesday.
- Is cancelling from the calendar being one-way acceptable, or should it be reversible from the card too?
- Completed orders now sit on a grey background rather than just faded. Clear enough at a glance on the iPad?

**What this closes off:** The calendar is now a second writer to the order lifecycle, so any future status rule has two screens to satisfy, not one. Every write that can move, hide or restyle a card must revalidate three routes — a fourth surface would make that a real coupling problem worth solving properly. And the "calendar is a read-only view" simplification is gone for good: it is now a full participant in the order lifecycle, minus the fields it deliberately refuses.

**Related:** supersedes the read-only clause of CONSTRAINT-19 (revised the same day). Independent of FB-14, which replaces the touch *interaction*; this changes what the popup can *do*.

---

## FB-16 — The First Code Review Hardened How the Orders Screen Fails

**Date:** 2026-07-27
**Architecture reference:** `docs/architecture.md` → API Structure (revalidation note), Database Layer (`auth.guard.ts`, `errors.ts`)
**Tasks:** none — `@code-review` targeted-fix pass over the Features 11–13 range

**Decided:** The project's first formal code review found the new calendar code solid, but the older Orders screens it calls into were missing the same safety net. Four things changed: (1) if the connection drops mid-action, the Cancel/Revert confirmation boxes now say "Something went wrong. Please try again." and stay dismissible, instead of freezing until a page reload; (2) the order-revert action — the one that can delete an invoice — now has its own test suite (it previously had none); (3) editing an order now refreshes the calendar and dashboard too, so an Orders-tab edit can no longer leave a stale card on another screen; (4) the sign-in check is now one shared piece of code instead of three drifting copies, so a Supabase outage reads as "something went wrong" rather than the misleading "you are not signed in."

**Means for your product:** Nothing looks different. What changed is how it fails: on a warehouse iPad with flaky wifi, a failed tap now tells you it failed and lets you retry, instead of silently wedging a dialog.

**Check before approving:** (a) A connection failure mid-cancel keeps the dialog open with an error so you can retry — right call, versus closing it? (b) Orders-tab edits now refresh three screens; this is cheap (a cache tag flush, not a re-render storm) and free-tier safe.

**What this closes off:** Nothing. Pure hardening — no behavior removed, no dependency added. Known leftovers, deliberately deferred and logged: the same shared sign-in check should eventually replace the private copies still living in the invoices, customers, leads and support actions.

## FB-17 — Customers Now Keep an Address Book; Orders Keep Receipts

**Date:** 2026-07-28
**Architecture reference:** `docs/architecture.md` → Data Model (`customer_addresses`), CONSTRAINT-21
**Tasks:** Feature 14, Tasks 70–73 (+ security fix pass: migration `0013`)

**Decided:** Each customer now has a saved list of delivery addresses. The order form offers them as a dropdown (most-recently-used pre-selected) with an inline "+ Add new address"; the customer page manages the list. Each order still stores its own frozen copy of the address text — picking from the list copies the text in, it does not link to it.

**Means for your product:** No address is ever typed twice for the same customer. And because orders keep frozen copies, fixing or deleting a saved address never changes what past orders say — an old PO remains evidence of where it actually shipped.

**Check before approving:**
- Deleting a saved address leaves every past order untouched — confirmed on the iPad?
- The old single "default address" field is gone from all screens; its data was copied into each customer's address list. Anything missing?

**What this closes off:** There is deliberately no "fix this address everywhere" button — a typo saved onto three past orders stays on them (each order is editable individually). The database keeps one duplicate-proof list per customer, enforced at the database level, so double-taps can't create twins.

---

## FB-18 — The Dashboard Now Shows Bookings, Not Billings

**Date:** 2026-07-29
**Architecture reference:** `docs/architecture.md` → Component Architecture (`RevenueChart`), `docs/api-spec.md` → `getDashboardStats` / `getRevenueTrendData`
**Tasks:** none — builder-directed change, same-day

**Decided:** "Total Invoiced" (sum of issued invoices) is replaced by "Total Revenue" — the summed price of every non-cancelled order, bucketed into the month of its production date (falling back to delivery date, then entry date). The trend chart follows the same rule.

**Means for your product:** The number now moves the moment you book or schedule work, not when you invoice it — it answers "how much business is on the books this month?" instead of "how much have I billed?". Expect it to read higher than the old number, and expect history to shift slightly (an order completed in June but invoiced in July now counts in June). Rescheduling an order's production date moves its value to the new month automatically.

**Check before approving:**
- Is bookings the number you want on the hero card, or do you eventually want both bookings and billed side by side?
- One legacy order (`MAn00003239`) has no prices filled in and counts as $0 until its unit prices are entered.

**What this closes off:** The dashboard no longer reports invoiced revenue anywhere — if that view matters again (e.g. for taxes), it's a new card/chart to add, not a toggle.

---

## FB-19 — One Definition of "Overdue Customer" Instead of Three Copies

**Date:** 2026-08-02
**Architecture reference:** `docs/architecture.md` → Database Layer (`db/queries/customer-overdue.sql.ts`)
**Tasks:** none — code-review fix pass (commit `8e54c2c`)

**Decided:** The SQL that decides when a customer is overdue for contact (their completed-order history, their average reorder gap, and the "days overdue" arithmetic) used to be pasted into three different query files — the customer list, the customer detail panel, and the dashboard's Need-to-Contact widget. It now lives in one shared module that the other files assemble from.

**Means for your product:** Nothing changes on screen today — the compiled queries are verifiably identical to before. What changes is the failure mode: previously, a future tweak to the overdue rule (say, "ignore orders older than two years") had to be applied in three places, and missing one would make the dashboard and the customer list silently disagree about who's overdue. Now there is exactly one place to change, and all three surfaces move together.

**Check before approving:** Nothing — this is invisible plumbing. The 55 existing query-shape tests passed without modification, which is the proof the behavior didn't move.

**What this closes off:** Nothing. It reopens something, in fact: rule changes to "overdue" are now one-file edits instead of three-file hunts.

---

## FB-20 - The Database Phone Line Was Replaced, and Login Got Two Keys

**Date:** 2026-08-02
**Architecture reference:** `docs/architecture.md` -> Infrastructure (database connection) + Security Architecture (authentication)
**Tasks:** none - emergency outage session (commits `54462e4`, `5b89483`)

**Decided:** Two things. (1) The app now talks to the database through Supabase's "session" pooler (port 5432) instead of the "transaction" pooler (port 6543), because the transaction pooler started silently losing answers to queries - pages waited forever for replies that never came. The app also now hangs up idle database lines and holds at most 2 per server instance. (2) Login was split into two identities: a new production user (what the salesperson's login uses) and the old user, whose leaked password was replaced, kept for testing.

**Means for your product:** The site works again, and any future database problem shows up as a fast, visible error instead of an endless spinner. The leaked password from April is now dead. Day-to-day nothing looks different.

**Check before approving:**
- On days with many deploys in a row, the site can briefly error until old server instances clear (~15 min). Rare at your scale; the fix if it recurs is raising "Pool Size" in Supabase settings.
- The session pooler is a workaround. When Supabase fixes their transaction pooler, switching back (one character in one env var) removes that limitation entirely.

**What this closes off:** Nothing permanently. The QA user is a separate key to the same room - it is not a safe playground; test data still lands in real data.

---

## FB-21 — A Booked Order Silences the "Call Them" Reminder

**Date:** 2026-08-02
**Architecture reference:** `docs/architecture.md` → Performance Considerations (Need-to-Contact rule)
**Tasks:** Task 74

**Decided:** A customer who already has a scheduled order no longer appears in the Need-to-Contact list, and their "overdue" indicator disappears everywhere (customer list and detail show nothing) until that order completes or is cancelled.

**Means for your product:** The reminder list now means exactly "call these people to book an order." Before, a customer could show as overdue even though their next delivery was already on the books — a call you'd never actually make. The reorder-frequency math itself is untouched: it still learns only from completed deliveries, so a promised date can't skew the averages.

**Check before approving:** If a scheduled order sits open for a long time (never marked complete or cancelled), that customer stays silenced the whole while. Acceptable because a stale scheduled order is itself visible on the dashboard's Open Orders widget and the calendar.

**What this closes off:** Nothing — one-line rule in one shared SQL module; trivially reversible.
