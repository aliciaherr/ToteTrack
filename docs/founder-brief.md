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

## FB-22 — One Tap to Text or Email the Customer, and a Quiet Bug Closed on the Way

**Date:** 2026-08-09
**Architecture reference:** `docs/architecture.md` → Component Structure (`calendar/`, `customers/`) + `lib/contact-links.ts`
**Tasks:** Task 75

**Decided:** Tapping an order on the calendar now offers a **Contact** button beside Mark as Complete and Cancel Order. It opens Messages or Mail with the customer's contact already filled in. One contact goes straight to the two choices; several show a short list of names, each opening its own Message/Email pair. A customer with nothing on file greys the button out.

**Means for your product:** Chasing a delivery no longer means leaving the calendar, opening Customers, finding the company, and copying a number by hand. It is now one tap from the order you are already looking at.

Two defects were found and fixed while building it, both silent:
- The **Customers screen has been building email links unsafely since it was written.** If a contact's email field ever held stray text after the address, the mail app would read it as instructions — a draft could open with an extra recipient CC'd, looking completely normal on the way out. Both screens now share one guarded builder. Nothing suggests this ever happened to you; the field is yours to type into. It simply can't now.
- A phone written as **"Text 555-0100"** produced a dead Message link. The code looked for extensions (`x204`) and the `x` in "Text" swallowed the number. The extension marker is now only recognised when it does not sit inside a word, so "Text", "fax" and names like "Alex" keep their number.
- Extensions themselves are now dropped along with anything written after them, so **"555-010-2030 ext 12 (Dana)"** texts `555-010-2030` rather than folding the `12` on and dialling a number that belongs to someone else. The trade-off is deliberate: when the extension is written *before* the number the whole field is dropped and you get an empty message draft. An empty draft is obviously wrong and you can fix it on the spot; a wrong number that looks right is not.

**Check before approving:**
- On desktop, the Message option does nothing — `sms:` is a phone/tablet handler. Verified working on the iPad, which is the device this is for.
- If a stored value is not a real number or address, the app still opens the messaging app with a blank or visibly-wrong recipient rather than blocking you. That is deliberate: you land where you meant to go and can correct it by hand. It also means bad contact data shows up as a wrong draft, not an error message.
- Only the primary-first contact list on the order's customer is offered. There is no way to text someone who isn't saved on that customer.

**What this closes off:** Nothing. Prefilled message templates (e.g. a delivery notice vs. a delay notice) were deliberately deferred, not designed out — the menu has room for them.

---

## FB-23 — Every Screen on the iPad Was One Nudge Too Tall

**Date:** 2026-08-09
**Architecture reference:** none — no structural change. The rule is recorded as CONSTRAINT-23 in `docs/constraints.md`.
**Tasks:** none — unplanned bug fix, commit `d3314d7`.

**Decided:** Every screen is now measured against the height of the iPad screen **as it actually is when you open it** — with the browser's tab bar showing — rather than the height it would be if the tab bar were hidden.

**Means for your product:** You reported that on the iPad, in both Safari and Chrome, every tab opened very slightly too tall: a small scroll was needed before the screen settled, after which the tab bar tucked away and everything behaved as intended. That was not a design quirk, it was a measurement bug, and it was on every screen in the app.

The cause is worth knowing because it will come up again. When a web page asks for "the full height of the screen," the iPad answers with the height it *would* be once the browser hides its own toolbar — not the height available right now. So each screen was built about a tab-bar taller than the space it had, and that overhang was the scroll you were doing. Scrolling hid the toolbar, the two heights matched, and the problem disappeared — which is exactly why it looked like it fixed itself.

Every screen now asks a different question — "how much room is there *with* the browser's chrome visible" — and gets an honest answer. The rubber-band bounce when you drag down on a screen with nothing to scroll is gone too; on a page where there is never anything below, that bounce reads as a promise the app can't keep.

**Check before approving:**
- The trade-off is deliberate. If the toolbar ever does collapse — scrolling something inside the page, say the week strip — you get a tab-bar's worth of empty space at the bottom until it returns. The alternative was a height that tracks the toolbar live, which re-shuffles the calendar grid mid-scroll. A stable layout with a little dead space beat a layout that moves while you are reading it. Tell me if that dead space is uglier in practice than it sounds and it can be revisited.
- The calendar's four-visible-cards rule now measures against the smaller height, so on a short screen cards may hit their minimum size and clamp rather than scale. Not seen on the iPad; worth an eye if the app is ever opened on a phone.
- **No automated test can catch this class of bug.** The test suite runs in a fake browser with no toolbar to mismeasure — all 936 tests passed while every screen was wrong on the real device. This was found by you, on the iPad, and that is the only way it could have been found.

**What this closes off:** The most common way of writing "full screen height" in this stack (`h-screen`) is now banned in this codebase, because it is the exact construction that caused this. Nothing enforces that automatically yet — it is a written rule, so a future screen can still reintroduce the bug silently.

---

## FB-24 — A File That Called Itself Private Was One Import From Being Public

**Date:** 2026-08-09
**Architecture reference:** `docs/architecture.md` → `lib/actions/` tree, `leads.convert.ts`. Rule recorded as CONSTRAINT-24 in `docs/constraints.md`.
**Tasks:** none — security fix pass, commit `3b27ed7`.

**Decided:** One line was deleted from a helper file, and a second file's entry was moved from the "ships to production" list to the "only used while building" list.

**Means for your product:** Two separate things, both structural. Neither was leaking anything today — I want to be exact about that, because the first one is easy to over-read.

**The first is about how this stack publishes code.** In Next.js, writing `'use server'` at the top of a file is not a label — it is the act of publishing. Every function that file exports becomes an address on the public internet that anyone can call. `leads.convert.ts` had that line at the top and, three lines below it, a comment reading *"Private helpers. Not part of the public actions API."* Both statements were in the same file and only one of them was true.

Underneath sat three functions that skip the "is this person logged in?" check — deliberately, because the real entry point above them does that check once. Every other action file in the app guards every function it exposes: 23 out of 23. These three were the exception, and they were the ones marked as published.

They were never actually reachable. Next only wires up a published function when something on the browser side asks for it, and nothing did — the file is only used by other server code. But that is luck with a good explanation, not a safeguard. It held because of *who happened to import the file*, which is invisible, tested by nothing, and one ordinary refactor from changing. Had it changed, one of those three functions answers the question "is this company a customer of yours?" for anyone who asks, and asking it repeatedly with different guesses walks out your whole customer list. Your code is public on GitHub, so nobody would have had to guess where to knock.

The fix was deleting the `'use server'` line. Nothing else — the file works exactly as before, because the real entry point above it was always doing the guarding.

**The second is about what gets installed when your site deploys.** `shadcn` is the tool that *generates* interface components — you run it while building, and it writes files into the project. It was listed as something your live site needs, so every deploy installed it along with everything it depends on: a web server, a code-rewriting engine, and more. None of it is used by a single line of your app. Moving it to the "build-time only" list took the production security warnings from 15 down to 4, and removed a path where a compromised piece of that toolchain could run during a deploy — the one moment your database and admin keys are in reach.

**Check before approving:**
- **Nothing about the app changed.** Same screens, same behaviour, same components. Type-checking clean, all 936 tests passing, production build fine, and I probed the live site after deploying: the login page loads and all four internal pages still bounce a logged-out visitor to login.
- **The lead-conversion feature is the one to eyeball** if you want to confirm by hand — convert a lead to a customer and check the customer and their contact details appear as usual. It has 8 tests covering it that pass, so this is belt-and-braces.
- **The rule now written down (CONSTRAINT-24) has no automatic enforcement**, same as the last two constraints. The realistic way this comes back is someone adding `'use server'` to that file to match its neighbours. There is now a comment at the top of the file addressed to exactly that person.

**What this closes off:** Nothing in the app. What it closes off is a *style of checking*: the previous security pass looked at whether the same set of files was present and concluded nothing had changed. That was true and useless — the problem was inside one of those files, in what it exported. Future passes have to count the exported functions and reconcile them against what the build actually publishes. That is slower and it is the only version of the check that works.

---

## FB-25 — The Calendar Now Holds Two Kinds of Card, and "Which Kind Is This" Is Enforced Four Times

**Date:** 2026-08-10
**Architecture reference:** `docs/architecture.md` → *The Two-List Calendar (Feature 15)*, sections 1 and 2. Rule recorded as CONSTRAINT-25 in `docs/constraints.md`.
**Tasks:** 80, 81 — commits `df78e2b`, `f84c31b`.

**Decided:** Every card on the calendar carries a permanent tag saying whether it is an order or a pickup, and that tag is checked four separate times on the way from your finger to the database — including once on the server, which does not trust anything the screen sends it.

**Means for your product:** The calendar used to show one kind of thing. It now shows two, stacked in every day column: orders on top, pickups underneath. That creates a failure this app cannot recover from quietly — a pickup written into the orders table, or an order written into the pickups table. Nothing would look wrong on screen. The row would simply be in the wrong place, in live production data, with no sandbox to have caught it.

So "which kind is this" is not a UI detail here, it is a boundary. Four things check it:

1. **While you drag**, the other list is removed from consideration entirely before the app works out what you are hovering over — so an order dragged over the pickups list never opens a gap. This one exists for honesty: refusing only at the moment you let go would mean the screen showed you a slot it was always going to refuse.
2. **When you let go**, the drop is refused outright if the kinds do not match.
3. **In tap-to-place mode** (the long-press flow you use on the iPad), the tap is cancelled before any position arithmetic runs, so an armed order cannot compute where it would sit in the pickup list.
4. **On the server**, the request is rejected before it touches the database, by a check that does not care what the browser claimed. There is then a *second* server check that looks the card up in its own table — so an order id sent to the pickup save fails even if the tag was forged.

The first three are the experience. Only the last two are the safeguard. That distinction is written into the code comments so nobody later "simplifies" a guard by deciding the drag already handles it.

There is also exactly **one place in the whole app** where a calendar gesture decides which table to write to. Everything above it is deliberately ignorant of the difference. That is the design's real payoff: adding a third kind of card later means changing one file, not auditing every gesture.

**Check before approving:**
- **Try to break it on the iPad, deliberately.** Drag an order over the pickups half of a day and confirm nothing opens up to receive it; then the reverse. Long-press a pickup to arm it, then tap an order card, and confirm the arming just cancels rather than doing something surprising.
- **The security pass tested all four layers by running them, not by reading them** — including sending a deliberately forged request straight at the server. Verdict was clear.
- **One asymmetry was found and fixed during review, not at build time.** The pickup save had two guards; the order save had one. They now match. It was never exploitable, but it is exactly the kind of drift that makes the *next* change unsafe, and it was caught only because someone compared the two sides directly.

**What this closes off:** Moving a card between the two lists — dragging an order into the pickups row to "convert" it — is now impossible by design, at four levels. If that ever becomes a feature you want, it is not a small change; it is a deliberate hole cut through a boundary built to have none.

---

## FB-26 — Shared Building Blocks Now Have a Home of Their Own

**Date:** 2026-08-10
**Architecture reference:** `docs/architecture.md` → *Component Tree*, `components/shared/`. Rule recorded as CONSTRAINT-26 in `docs/constraints.md`.
**Tasks:** none — builder-requested address picker plus code-review remediation, commit `f84c31b`.

**Decided:** Anything two parts of the app both use now lives in a shared folder. It does not stay in whichever screen happened to build it first, and no screen reaches across into another screen to borrow it.

**Means for your product:** You asked for the pickup form to offer a customer's saved addresses as a dropdown, the way the order form does, instead of a free-text box. The honest way to do that is to have both forms use the *same* picker. The tempting way is to have the pickup form import the order form's picker.

The tempting way was already in the codebase in a smaller form, and it had gone slightly wrong: a pickup file was reaching the standard input styling by going through the *orders* form's schema file, which re-exported it from somewhere else again. Two hops, through a vertical that had no reason to be involved. Nothing was broken — but the day someone edits the orders form and moves that line, the pickups form changes appearance for no reason anyone can trace.

So the picker moved into the shared folder, and the two forms became thin adapters holding only what genuinely differs between an order's address and a pickup's. Same for the input styling and the field row layout. The rule is now written down: shared things live in the shared folder; verticals never import from each other.

The address picker itself also carries a real safeguard. A pickup can now be attached to one of the customer's saved addresses, and the server checks that the address actually belongs to that customer before saving anything — you cannot end up with one customer's address stapled to another's pickup. And because a saved address and the typed-out text could in principle disagree, the form refuses a request that sends an address id without the matching text.

**Check before approving:**
- **On the iPad, open a pickup and check the address dropdown behaves like the order form's** — the customer's most recently used address preselected, an "add new" option that lets you type one, and a blank state that is still allowed (a pickup does not require an address).
- **Addresses typed into a pickup still get remembered** on the customer's address list, as decided during the pickups brainstorm. Worth confirming once with a real customer: add a new address on a pickup, then open an order for that customer and check it appears in the dropdown.
- **One inconsistency is deliberately left alone and you should know about it.** The leads and support forms each carry their *own* copy of the input styling, and it is a genuinely different look from the one orders, pickups and customers share. That is old drift, not something introduced here. Folding them in changes the appearance of two live screens, so it needs to be its own decision rather than a silent tidy-up.

**What this closes off:** Nothing, but it sets a direction. From here, the cost of a second consumer is a small move into the shared folder rather than a slow accumulation of cross-screen imports — which is the shape technical debt takes in a codebase like this one, where every vertical looks similar enough to borrow from.

---

## FB-27 — "Must Be a Weekday" Is Now a Rule You Opt Into, Not One Every Date Inherits

**Date:** 2026-08-10
**Architecture reference:** `docs/architecture.md` → *The Two-List Calendar (Feature 15)*, section 4. Interacts with CONSTRAINT-19.
**Tasks:** 77 — commit `7bb2687`.

**Decided:** The app now has two kinds of date check. Both refuse a date that does not exist. Only one of them additionally refuses weekends, and a new date field has to ask for that on purpose.

**Means for your product:** Production dates cannot fall on a weekend — that is CONSTRAINT-19 and it is correct, because nothing is produced on a Saturday. Until this session that weekend rule was baked into the single date check the whole app used, so any new date field would have silently inherited it.

A pickup date should not inherit it. A collection is not production. The calendar only draws Monday to Friday, so in practice a dragged pickup lands on a weekday anyway — but the *server* should not invent a rule the thing does not actually have. If you ever decide a Saturday collection is fine, that becomes a UI question, not a database refusal you have to go hunting for.

So the check was split in two. The base version guarantees the date is a real day — which matters more than it sounds. Without it, typing something like 31 February does not produce a helpful message; it produces a raw database error, which is the kind of failure that looks like the app is broken. Both versions have that. The production version is the base version plus one extra line: and it must be a weekday.

The reason this is written down rather than just done: the next date field added to this app will pick one of the two, and picking wrong is invisible. Choose the production one for something that is not production and you get a mysterious refusal on Saturdays. Choose the base one for something that genuinely is production and you have quietly deleted CONSTRAINT-19 for that field.

**Check before approving:**
- **Nothing about order dates changed.** The production check is now literally the pickup check plus the weekend rule, so orders behave exactly as before — that is covered by the existing tests, which were not modified.
- **The practical question for you is whether a weekend pickup should ever be possible.** Today the calendar shows weekdays only, so the answer is effectively no by way of the interface. The server no longer has an opinion. If you want weekend collections, that is now a calendar change rather than a validation change.

**What this closes off:** Nothing. It reopens something, deliberately: weekend dates are no longer refused app-wide as a matter of course, so any field that genuinely needs the weekday rule must now say so.

---

## FB-28 — Reading Who Is Logged In Now Takes a Moment, and Every Piece of Code Has to Wait for It

**Date:** 2026-08-11
**Architecture reference:** `docs/architecture.md` → *Platform-Native Rules*, section "Request APIs are async — `createClient()` must be awaited". Stack table updated to Next.js 15.5+ / React 19.2+.
**Tasks:** 83 — commit `0476528`.

**Decided:** The app moved from Next.js 14 to 15 and from React 18 to 19. The single change that touches how future code must be written: asking "who is signed in?" and "what was in the web address?" are no longer instant answers. The code has to wait for them.

**Means for your product:** Nothing you can see. Same screens, same speed, same behaviour — 1,222 automated checks all still pass, unchanged, and you exercised the calendar yourself afterwards.

What changed is underneath. Previously a piece of code could ask for the browser's session cookie and get it back immediately, in the same breath. Next.js decided that was a lie worth correcting: fetching that information is genuinely a small piece of work, so now it hands back a promise — "I'll have this for you shortly" — and the code has to wait.

That sounds like a nuisance and mostly it is, but it is the honest version. It also unlocks the thing Next.js is actually chasing: if the framework knows a page is *waiting* on something, it can start rendering the parts that aren't waiting. You do not benefit from that today. You would if this app ever got slow.

The practical cost was eleven places that fetch the logged-in user and eight pages that read the web address. All eighteen now wait. The reason it is written here rather than left in the code: the next page or action added to this app has to do the same, and forgetting is not a subtle bug — it fails loudly at build time, which is the good kind of failure.

Worth knowing how small this was. Two major version jumps sounds alarming; it produced fourteen type errors and took one session. That is not luck — it is because this app never used the features Next.js broke. No image component, no API routes, no custom build configuration. A more conventionally-built app would have paid far more.

**Check before approving:**
- **The calendar is the thing to keep an eye on.** React 19 changed how components get handles on elements on screen, which is the machinery drag-and-drop runs on. You confirmed drag, drop and arm mode work on the desktop. The gap is the iPad — touch dragging uses that same machinery and a desktop pass cannot tell you about it. **Next time you have the iPad in hand, drag a card.** Not urgent, but it is the one untested surface.
- **Nothing about your data, login, or hosting changed.** This was entirely a change of the tools the app is built from.

**What this closes off:** Nothing — it opens the door to Next.js 16, which is planned as Task 84 and was the whole point. Going backwards to Next 14 would now mean undoing eighteen deliberate edits, so consider this one-way. That is intended.

---

## FB-29 — The App No Longer Holds a Master Key, and the Thing Guarding Your Login Was Never the Guard

**Date:** 2026-08-12
**Architecture reference:** `docs/architecture.md` → *Security Architecture*, new section "Session refresh — `proxy.ts`" and rewritten "Secrets".
**Tasks:** 84 — commit `be4a078`; follow-up fixes `7072363`.

**Decided:** Two things, both found by asking "is what this document says still true?" rather than by anything breaking.

**First: the app was storing a master key it never used.** Supabase gives you two keys. The ordinary one respects your security rules — it can only see what a signed-in user is allowed to see. The other, the `service_role` key, ignores every rule by design; it is the master key, meant for admin tooling. ToteTrack was set up with both back on day one, and the master key was written into the setup docs, the README, and your local environment file. **No line of code has ever read it.** It sat there for four months being a liability with no job.

It is now deleted from all four places. The app is unaffected — it talks to the database directly with a different credential and uses the ordinary key for logins, exactly as it always did.

> **The one thing this brief cannot do for you:** deleting the key from your computer does not un-expose it. It was on disk for months. **Rotate it in the Supabase dashboard.** That is a two-minute job and it is the only part of this nobody can do on your behalf.

**Second: a file was renamed, and renaming it revealed a misunderstanding worth writing down.** Next.js 16 renamed the file that runs on every request from `middleware.ts` to `proxy.ts`. Mechanical. But the file carried a comment claiming that errors inside it were "non-fatal" — and the code did not implement that. If Supabase had a hiccup, that file would have failed *every single page*, including the login page. A brief outage at Supabase would have locked your salesperson out of an app that was otherwise working perfectly.

The reason it is safe to fix rather than dangerous: **that file was never the thing keeping strangers out.** People assume it is, because it runs first and touches the session. It does not. It only refreshes the session so it does not expire while someone is working. The actual gate is a check on every authenticated page that asks "who is this?" and sends you to the login screen if it cannot tell. So a failed refresh is genuinely survivable — the page-level check still refuses to show anything.

That fact is now written into the architecture document in bold, because it is exactly the kind of thing a future change gets wrong by assuming the opposite.

**Means for your product:** Nothing you can see. Same screens, same logins. What changed is that a Supabase blip now degrades the app instead of killing it, and you are carrying one fewer credential that could hurt you.

**Check before approving:**
- **Rotate the `service_role` key in Supabase.** The single action item in this brief.
- **You do not need it back.** If a future feature ever seems to want admin database access, treat that as a question to ask, not a key to paste — the app already reaches the database through a route that is not restricted by those rules, so a second bypass buys nothing.

**What this closes off:** Nothing. Both changes are reversible in a line. The `service_role` key can be reintroduced by whatever task genuinely needs it — but that task should have to justify itself, which is the point of removing it now.

---

## FB-30 — The Address of Your Database Matters More Than the Password, and Three Popups Could Freeze

**Date:** 2026-08-16
**Architecture reference:** `docs/architecture.md` → *Infrastructure* → "Database connection" (new "Never use the direct connection string" block); *Security Architecture* → "Secrets" (publishable-key note); `components/shared/` listing (two new hooks).
**Constraint added:** CONSTRAINT-28.
**Tasks:** 85 — commit `0ee4322`; 86 — commit `b79b028`.

**Decided:** Your database connection string is locked to one specific form, and three confirmation popups that could freeze permanently now recover with an error message instead.

**First: rotating the database password took the live app down, and the password was never the problem.**

You reset the password and pasted in a new connection string. The deploy went green. Then every page except the login screen broke.

Here is the part worth keeping. Supabase offers you **three** different connection strings and they are not interchangeable — only one of them can physically work with the way Vercel runs your app. The one the dashboard steers you toward by default is the one that cannot. It is not slower or less reliable; it is a street address in a format the delivery van cannot read. Your app never got as far as offering a password.

Two things made this hard to see, and both are worth recognising if it ever happens again:

- **The build succeeded.** The connection string is only used when a real person loads a real page, so nothing checks it until then. A green deploy is not evidence the database works.
- **The login page kept working perfectly.** Logging in doesn't touch the database — it goes to a different Supabase service entirely. So you get an app where you can sign in, and then everything behind the sign-in is broken. That reads like a broken page. It was a broken address.

The rule is now written into three places, including the setup instructions, which had been pointing at the wrong one all along.

**Second: three popups could freeze with no way out.**

"Delete customer", "Convert lead to customer" and "Generate invoice" each showed a confirmation popup. While the app was working, the popup correctly disabled its buttons so you couldn't click twice. But it only re-enabled them when the server answered.

If your internet dropped at that exact moment, the server never answered. So the buttons stayed disabled, the Escape key stayed switched off, and clicking outside the popup did nothing — all three exits are controlled by the same "still working…" flag that never got switched off. No error message, because nothing had gone wrong as far as the popup knew. The only way out was reloading the page.

This is now caught properly: you get a plain "Something went wrong. Please try again.", the buttons come back, and the real cause is written to the logs where it can be diagnosed.

**Worth knowing:** the same flaw is still present in three more places, including the login screen itself. They were found while fixing these and are recorded as the next thing to do. Nobody has hit them, but the login one is the one I would fix first — being locked out of the front door is worse than being stuck in a popup you can reload away from.

**Means for your product:** Nothing looks different. What changed is that a dropped connection now shows a message instead of stranding the person using the app, and the single most confusing failure mode you have hit — "the site is up but nothing loads" — now has a written diagnosis so it takes minutes rather than an evening.

**Check before approving:**
- **Deactivate the old Supabase keys.** Settings → API Keys → Legacy API Keys. The only step left from the rotation, and nothing depends on them any more.
- **Do you want the three remaining freeze-bugs fixed before launch, or after?** The login one is a 15-minute fix. The other two are lower stakes.
- **If a page ever 500s again while login still works**, the connection string is the first suspect, not the password and not the page.

**What this closes off:** Nothing you would want. Locking the connection string to one form removes an option that never worked. The popup fix adds an error path where there was none — the only thing it "costs" is that a failed action now says so out loud, which is the point.

---

## FB-31 — Saturday Became a Working Day, and the Reordering You Asked For Was Already Built and Broken

**Date:** 2026-08-17
**Architecture reference:** `docs/architecture.md` → *Business rules* → "Production week" (rewritten Mon–Sat); *Server Actions* → `lib/actions/` listing (new `placement.renumber.ts` entry); stack table corrected to Next 16.3+.
**Constraint added:** CONSTRAINT-29. CONSTRAINT-19 substantially revised.
**Tasks:** 88 — commit `a624843`; 89 — commit `8fba2a7`; CONSTRAINT-29 — commit `88d38a4`.

**Decided:** Saturday is now a normal production day with its own calendar column, and dragging orders into a different order within one day now actually sticks.

**First: the second request was not a feature request.**

You asked to "allow ordering the orders of a single day, right now the ordering is not allowed." Reordering had been built months ago. It was broken, and broken in a way that looks exactly like a missing feature.

Here is what was happening. Each card can carry a position number within its day. When you dragged a card, the app wrote a position number onto **that card only** and left every other card in the day with no number at all. The rule for sorting says cards without a number go last — so a single card with a number always jumped to the **top** of the day, no matter where you dropped it. And if the card was already at the top, nothing appeared to happen at all.

That is why moving a card to a different day seemed to work while reordering within a day did not: moving to another day changes the day, which is obvious, so you never noticed that its position *within* that new day was also wrong.

The fix renumbers every card in the affected day, every time, so positions are always a complete `1, 2, 3, 4` with no gaps. Cards that never had a number get one the first time you touch their day.

**Second: Saturday cost almost nothing, but it does change two things you'll see.**

The whole Monday-to-Friday rule lived in one line of code, so widening the week was small. Two consequences reach outside the calendar, and both are intended:

- **A Monday delivery now defaults to being built on Saturday**, where before it defaulted to Friday. That follows directly from Saturday being a real working day.
- **The dashboard's Friday panel now shows Friday and Saturday**, where before it showed Friday and Monday.

You also made a deliberate trade: the columns stay their current width and the calendar scrolls sideways, rather than squeezing six columns into the screen. That means a full week no longer fits on the iPad screen at once — you scroll to see Saturday. That was your call and it is recorded, because the original design had "a whole week fits on the iPad" written down as a goal.

**Worth knowing: there is a small inconsistency between finger and mouse, and you chose to keep it.** When you move a card *downward* within a day, long-press-and-tap puts it just above the card you tapped, while mouse-dragging puts it just below. Both are defensible and the two original specs actually disagree with each other. Mouse can't be the one to change, because it shows you a live preview of where the card will land — changing it would make the preview lie. You use touch daily, so changing that would rewrite your muscle memory for no real gain. Recorded as CONSTRAINT-29 so nobody files it as a bug next month.

**Means for your product:** Saturday production is schedulable, which it was not before. Day sequencing works, which means the build order you set is the build order the team sees — the whole point of the calendar. Neither changes how anything looks.

**Check before approving:**
- **Open the calendar on your iPad.** This is the one thing that could not be tested here — the six columns, the sideways scroll, and dragging a card onto the new Saturday column. Five checks are waiting on you and they gate the quality sign-off.
- **Is Saturday defaulting correct for Monday deliveries?** A Monday delivery will now be scheduled to build on Saturday rather than Friday. If your team does not want Monday work landing on the weekend by default, say so — that is a separate decision from Saturday existing.
- **Is the sideways scroll acceptable in practice?** If it turns out to be annoying, the alternative is narrower columns, which was rejected because it would make the cards too small to read.

**What this closes off:** Sunday production is now the awkward one. Adding Saturday was cheap because Monday stayed the unambiguous start of the week; adding Sunday would leave no non-production day at all, and the week-boundary logic would need rethinking rather than widening. Nothing else is foreclosed — the Saturday change is one line to reverse, and the reordering fix has no way back worth wanting.

---

## FB-32 — Three Buttons Could Freeze Forever, Including the One You Log In With

**Date:** 2026-08-17
**Architecture reference:** none — no architectural change. The fix follows the pattern already recorded for the Task 85 fixes.
**Constraint added:** none. CONSTRAINT-14's component size cap was applied, not changed.
**Tasks:** 90 — commit `3369d2c`.

**Decided:** Three buttons that could lock up permanently now recover and tell you what happened. This completes a set of six; the other three were fixed last session.

**What was wrong, in plain terms.**

You click Save. The button greys out to show it is working. When the server answers, it un-greys and either saves or tells you what went wrong.

If the server *never* answered — your wifi dropped, the connection blipped, a deploy landed at exactly the wrong moment — nothing un-greyed it. The button stayed dead. No error message, because from the app's point of view nothing had gone wrong; it was still politely waiting for a reply that was never coming. Your only way out was reloading the page.

The three affected:

1. **Sign In, on the login screen.** The bad one. If it froze, you could not get into the app at all — there is nothing behind it to navigate to.
2. **Save next action**, on a lead.
3. **Add note**, on a lead. Your typed note stayed in the box, but Save was dead.

**Why it happened, and why it is a family rather than three coincidences.**

The app has always handled *expected* failures well — a wrong password, an invalid date, a rejected save all produce a proper message. What none of these three handled was the request *vanishing*. Those are two genuinely different situations in the code, and handling only the first is an easy thing to miss, which is exactly why six places had the same flaw.

They are all now fixed the same way: the button un-greys no matter what happens, and if the request vanished you get "Something went wrong. Please try again." while the real cause goes to the logs where it can be diagnosed.

**One detail worth knowing about the login fix.** Everywhere else in the app, a failure is logged along with a note of what it was working on — which lead, which customer — so it can be traced later. The login screen deliberately logs *nothing* of the sort, because the only thing it was working on is your password. There is now a test whose entire job is to fail if a password ever appears in a log line.

**Means for your product:** No visible change when things are working. What changed is the worst-case: a dropped connection at the wrong moment used to leave you stuck on a dead screen with no explanation, and the login case could shut you out of the app entirely until you thought to reload. That failure mode is gone from every place it was known to exist.

**Check before approving:**
- **Nothing needed from you.** This one is not waiting on a decision or a device check — flagged because it changes behaviour you could notice, not because it needs your input.
- **If you ever see "Something went wrong. Please try again." on one of these three**, that now means the request genuinely did not reach the server — worth noticing if it happens repeatedly, because that points at the connection rather than the app.

**What this closes off:** Nothing. The fix only adds a path where there was none. The one small cost is that two lead components had to be restructured to fit the project's file-size rules — the save logic moved into a separate function — which is tidier rather than worse, and matches how the three equivalent fixes were done last session.

---

## FB-33 — One Tap Was Being Counted Twice, and "Insert Above" Meant "Do Nothing"

**Date:** 2026-08-17
**Architecture reference:** none — no architectural change. Same components, same server actions, corrected rules.
**Constraint retired:** CONSTRAINT-29, superseded by Task 91. No new constraint added.
**Tasks:** 91 — in progress; closes on your iPad check, not on a green test run.

**Decided:** There is now **one rule** for moving a card with your finger: **tap a card to take its place, tap empty space to go last.** The same rule on any day, including the day the card is already on.

**The clue was which half worked.**

Moving a card to a *different* day worked. Reordering cards *within* one day did not. Same gesture, same code — so the difference had to be in what "same day" does differently. It turned out to be two separate faults that only overlap on the same-day path.

**Fault one: the rule was written backwards.**

The old rule was "slot the card in *above* the one you tapped". Read that back with a real gesture in mind. You hold a card, and you tap the card just below it, because that is what "move down one" looks like. Under the old rule, "above the card below me" *is where I already am*. So the app worked out the destination, noticed it was the same as the starting point, and correctly did nothing.

It was not a crash and not an accident. It was the rule doing exactly what it said, and what it said was wrong. Worse, a test asserted this behaviour, so every automated check agreed the app was fine.

**Fault two: one tap was counted twice.**

Each card listens for your tap. So does the list the cards sit in. The card was not telling the list "I have handled this one" — so a single tap fired twice. The first count did the right thing. The second count meant "send this card to the **bottom** of this day", and being second, it won.

On a different day, this was invisible: the card ended up at the bottom of the day you tapped, which is a plausible-looking result of a move you asked for. You would never have called it a bug. Within one day, it was the whole bug — the card either went nowhere (fault one) or slid to the bottom (fault two).

Both counts also sent an instruction to the server, so two saves raced each other for the same card. The fix stops the second tap from existing rather than trying to referee the race.

**What it does now.** Tap a card, the armed card takes that card's position. Tap empty space in a day, or an empty day, and it goes last. That's it — there is no separate same-day rule to remember.

**Finger and mouse now agree exactly.** Last session I recorded a small disagreement between the two — moving a card down with your finger put it just above the card you tapped, while dragging with a mouse put it just below — and you chose to keep it. That disagreement was the *same* backwards rule that caused fault one. Removing it makes both gestures land in identical places, so the note recording the disagreement (CONSTRAINT-29) is retired, and there is now a test whose whole job is to fail if the two ever drift apart again.

**The uncomfortable part: how this shipped.**

Fault two was invisible to every test that existed, because no test had ever rendered a card inside a real list and clicked it. Tests checked the card on its own and the list on its own; the bug lived only in the space between them. And a comment in the code — a note written for the next person to read — stated plainly that the double tap could not happen. It was wrong, and because it was reassuring, nobody checked it against the code sitting directly underneath it.

Both are now covered: a test clicks a real card inside a real list and fails if the tap is counted more than once, and the false comment is corrected rather than deleted.

**Means for your product:** Day sequencing finally behaves as a single, predictable rule instead of two rules that disagreed. The build order you set with your finger is the order that saves, and it is the same order a mouse would have produced.

**Check before approving:**
- **This one needs your iPad and cannot close without it.** Five things to try, and all five are meant to work: move a card **down** within a day, move one **up**, **swap two neighbours** in both directions, tap a **specific card in another day** (it should land in *that card's* spot, not at the bottom), and tap **empty space** in a day (it should go last).
- **The cross-day one is the one worth being fussy about.** It is the case that looked correct before and was not — so if a card you drop onto a specific card in another week still lands at the bottom of that day, the second fix has not taken.
- **Plain tap should still open the card popup**, exactly as before. If tapping a card without holding it first stops opening the popup, say so immediately — that would be this change reaching further than intended.

**What this closes off:** Nothing you would want back. The old "insert above" rule is gone and there is no argument for it — it made the most natural gesture on the calendar do nothing. The one thing genuinely given up is the freedom for touch and mouse to behave differently, which was never a feature; it is now something a test actively prevents.

---

## FB-34 — The Second Lock on Your Data Was Never Installed

**Date:** 2026-08-17
**Architecture reference:** `docs/architecture.md` → Security Architecture → Authorization. One false sentence was replaced with a paragraph describing what actually protects the data.
**Constraint added:** none. CONSTRAINT-05 ("RLS on all tables") is unchanged — the database rules exist and are still correct. What changed is what the document *claims* they do.
**Found by:** `@qa` (NON-BLOCKING-6) and, independently and on the same day, `@security` (M-03).

**Decided:** The architecture document said the database would refuse to hand over data to anyone who was not signed in, "even if server-side code has a bug." That was not true of this app and never has been. The sentence is gone. The document now states plainly that the app's own sign-in check is the only thing guarding your data.

**What the document promised.**

Two locks, one behind the other. The first is the app: every screen and every save re-checks that you are signed in. The second was supposed to be the database itself — a rule attached to each table saying "only hand rows to a signed-in caller." The point of the second lock is that it keeps working when the first one is broken. If a future change accidentally left a page unguarded, the database was meant to catch it and return nothing.

**What is actually true.**

The second lock is installed on every table, exactly as recorded. But the app does not knock on the door like an ordinary visitor — it connects to the database as the **owner** of the tables. And a table's owner is not subject to that table's own rules. Postgres works this way by design; there is a setting that forces an owner to obey its own rules, and this project has never switched it on.

So for every read and every write this app makes, the second lock is simply not in the loop. It is not weak, or misconfigured, or bypassable with effort — it does not apply. There is one lock, and it is the app's sign-in check.

**Why this is a documentation defect, not a hole to plug.**

The single lock is the right amount for what this is. ToteTrack has one user and one company's data in it; there is no second tenant to keep out, nobody whose rows must be hidden from somebody else's. The sign-in check runs on every screen and every action, and `@security` confirmed this audit that it is working. Nothing needs to be built, and nothing was at risk.

The defect is what the sentence would have done to whoever reads it next. Somebody adding a feature six months from now — an export, a status page, a link you can send someone — reads "the database catches it even if the code has a bug," concludes the guard on their new page is belt-and-braces, and leaves it off. It isn't, and the page would hand out everything. A safety net that people believe in and that isn't there is worse than no net at all, because it changes how carefully they walk.

**Means for your product:** Nothing changes in the app — not a line of code moved, not a behaviour altered. What changed is that the written record now matches reality, so the next person to touch anything that reads your data is told the truth about what is protecting it. Two independent reviewers arrived at the same finding from different directions the same day, and both confirmed the security report had described this correctly all along; it was the architecture document that had drifted.

**Check before approving:**
- **Nothing needed from you.** This is a correction to a document, flagged because it reverses something you were told when the project was designed.
- **The reversal is specifically of FB-03**, from 2026-04-20, which told you "two independent layers protect the data" and that "even if a bug in server-side code accidentally skips the session check, the database itself refuses unauthenticated queries." That is the claim being withdrawn. FB-03's other content stands; this one promise did not survive contact with how the app connects.
- **If you ever want the second lock to be real**, it is a small database change — switching on the setting that makes the owner obey its own rules. It is not free: it has to be done on every table, and any query that legitimately needs to run outside a session would then need a deliberate exemption. Worth doing if a second user ever appears; not worth doing today.

**What this closes off:** Nothing. The correction is a description, not a decision, and it leaves both futures open — carry on with one lock, or switch the second one on later with eyes open.

---

## FB-35 — Two Switches Became One Dial, and the Calendar Learned to Find Things

**Date:** 2026-09-18
**Architecture section:** `docs/architecture.md` → The Two-List Calendar (Feature 15) — `CalendarViewCycle`, `CalendarSearch`, `useCalendarSearch`, `useCardReveal`, and the `Current week` behaviour.
**Constraint changed:** CONSTRAINT-25 amended — the calendar's visibility control is now three views on one button, not two independent switches.
**Requested by:** Builder, during the session.

**Decided:** The calendar header had two separate on/off switches — one for orders, one for pickups. They are now a single button you tap to move between three views: Orders, Pickups, Both. A search box was added next to it, and the "Current week" button was repaired.

**Why two switches became one.**

Two switches can be set four ways, and one of those four was "both off" — an empty calendar. Nobody opens a calendar to see no cards. It was a setting the control *allowed*, never one anyone designed, and every day column carried a message explaining the blank space.

The header is also narrow. At the width of an iPad held sideways there is no room to spare, and two switches took roughly twice the space of one button.

The new button has three stops and no fourth. The empty state is not "discouraged" — it is no longer a thing the app can be in.

**What the search box does.**

Tap the magnifying glass, start typing a PO number, and a list of matching orders appears and narrows as you type. Pick one and the calendar goes to it and flashes the card for about a second.

Three things about it are deliberate:

- **Typing never moves anything.** Only picking a result does. Getting to an order can mean jumping the calendar to a different month, and you do not want that happening halfway through typing a number.
- **It searches the whole book, not just what is on screen.** The calendar only ever holds about nine weeks. A search that only looked at those would say "no such order" about an order three months out — a wrong answer that looks exactly like a right one.
- **It searches orders only.** Pickups have no PO number at all, so there is nothing to search them by. The box says "Search orders" on its face rather than letting you find that out the confusing way.

**The button that did nothing.**

"Current week" scrolled you back to today. If today was not among the weeks currently loaded, it quietly did nothing at all — no movement, no message. You would press it and assume it was broken.

Until now that was unreachable: nothing in the app could take you far enough away to trigger it. Search can. So it was fixed in the same breath: when today is not loaded, the calendar reloads around today instead of silently giving up.

**Means for your product:** Less clutter in a header that had none to give, and a way to find one order among hundreds without scrolling for it. The old empty-calendar state is gone — if you ever used it to clear the screen deliberately, that is the one thing you have lost. The red "needs a production date" count now stays visible in every view: choosing to look at pickups says which cards to draw, not that you have stopped caring about unscheduled work.

**Check before approving:**
- **The list shows at most 8 matches** and tells you when there are more. If your PO numbers are similar enough that you routinely hit that, say so — it is one number to change.
- **Long PO numbers are now shortened** in the search list and in the Orders table, with the full number a tap away. If most of your numbers are long, the cut-off may want raising.
- **Dates now read "Jul 27" rather than "2026-07-27"** in the Orders table, which is what paid for the new Production Date column without making the table wider. The year is not shown; that is fine for a working window of a few weeks and would be wrong for anything spanning a year end.

**What this closes off:** The "show me nothing" calendar state is gone and would have to be deliberately rebuilt. Searching by customer name was deliberately not built — this box exists to jump to one card, and a customer name would return that customer's whole book, which is a different feature wearing the same clothes.

---

## FB-36 — The Mailbox Was Being Tracked by Something the Sender Writes, and Spam Could Switch It Off

**Date:** 2026-10-09
**Architecture reference:** `docs/architecture.md` → *Email PO Ingestion — the processed marker (Feature 16)*. New CONSTRAINT row 33.
**Tasks:** decided before Task 102 is written. Amends the design built in Tasks 95–97.

**Decided:** The ingestion mailbox now tracks what it has already read using **two numbers the mail server assigns**, instead of a line of text written into the email by whoever sent it.

**What was wrong.**

Every run has to answer one question: *which of these emails have I already dealt with?* Get it wrong in one direction and you process the same PO twice. Get it wrong in the other and you never process it at all.

The original design answered it using the email's `Message-ID` — a label that lives inside the email itself. Two problems with that, and they compound.

The first is that **the sender writes it**, so it can be anything. The second is subtler and is what actually bites: the software that *lists* the mailbox and the software that *opens* an email tidy that label up in slightly different ways. Accented characters, odd spacing, a label that appears twice — the two disagree. So an email gets filed as handled under one spelling, and when the next run checks, it computes the other spelling, finds no match, and concludes the email is new.

That email is then downloaded again. And again. Every run, forever.

**Why that is worse than it sounds.** Each run only reads a fixed number of emails, to keep costs and memory bounded. A few permanently-unmatched emails fill that allowance completely. Real purchase orders sit behind them and are never read — and nothing fails, nothing logs an error, nothing tells you. Ingestion just quietly stops working.

And the emails most likely to carry a malformed label are spam. This mailbox is mostly spam by design, since it exists only to receive your forwarded POs. **The thing that breaks it is the thing it receives most of.**

**Why it is being redesigned rather than patched.** The security review found this five separate times across five rounds — five different symptoms of the same single cause. Its own closing note was that it could keep closing individual cases but could not promise a sixth did not exist. That is the signal to change the design, not to write a sixth patch.

**What replaces it.** Mail servers number every message they receive, in order, permanently. The run remembers the highest number it finished and next time simply asks the server for *everything after that number*. The sender has no say in it. No software has to interpret anything. Handled mail is never even mentioned again, so it cannot clog the allowance.

The email's own `Message-ID` is still recorded, because it is useful when tracing a specific message — it just no longer decides anything.

**Means for your product:** Ingestion stops being able to silently switch itself off, which was the real risk — not a wrong PO, but no POs and no warning. Spam volume no longer competes with real orders. And this is *less* machinery than before: an entire module built to tame that sender-written label (234 lines, the source of all five findings) has nothing left to do.

**Check before approving:**
- **If the app crashes halfway through a run, the next run may re-read those few emails.** That is harmless — the app separately recognises a PO it has already seen by its content and flags it for your review rather than filing it twice. Accepting this is what keeps the design simple.
- **The mailbox stays read-only, so nothing in it will ever show as "read" in Gmail.** If you log in and look, everything will appear unread, always. Using read/unread as the tracker was considered and rejected: it needs write access to your mailbox, and if you ever opened the account and Gmail marked something read, that PO would be skipped permanently.
- **One rule is being relaxed:** the database previously refused two emails with the same `Message-ID`. It no longer does, because the label is no longer trusted enough to enforce anything. Duplicate protection is unchanged and comes from the content of the message instead. **The tables are empty today, so this costs nothing — after the first real email lands it becomes a migration.** That is why this was decided now.

**What this closes off:** The tracking is specific to reading mail over IMAP, which is how Gmail is read today. If this ever moves to Google's own mail API, that API numbers things differently and the tracker would need replacing — the rest of the ingestion would survive. Also deliberately not built: anything that treats a sender-supplied header as a decision. Read them, store them, show them; never branch on them.

**Also settled by this.** The security report was BLOCKED on this issue, rated High, with a disagreement on record: `@security` said High, Claude assessed it Medium on the grounds that none of the code is reachable yet. That argument no longer needs settling — the cause is being removed rather than rated. A separate low-priority item about reused message numbers if the mailbox were ever recreated (L-15) is absorbed by the same change.

---

## FB-37 — A Wrong Reading You Can Fix; A Missing Order You Will Never Know About

**Date:** 2026-10-11
**Architecture reference:** `docs/architecture.md` → *Email PO Ingestion* → "No silent skips" and "PDFs and images are read the same way". New CONSTRAINT rows 34, 35, 36.
**Tasks:** decided before Tasks 98+ are specced. Sets the rule they are written against.

**Decided:** Every email that arrives in the ingestion mailbox must end up somewhere you can see it — either as a purchase order, or in the review queue with a reason. Nothing is ever quietly ignored.

**Why this is the rule, in your words.** A wrong reading is fine. A missed ingestion with no notification is not.

That asymmetry is the whole thing. If the system reads a quantity wrong, you see it on the review screen before it becomes an order, and you fix it in a few seconds. If an email with a real PO silently disappears, **every screen looks normal.** There is no error, no red count, nothing to notice. You find out when a customer rings up asking where their order is — and by then the trail is cold.

So the first costs you a correction. The second costs you the order and the customer's confidence. They are not the same kind of mistake, and the system should not treat them as the same kind of mistake.

**What this means concretely.** All of these now land in the review queue rather than vanishing: a file format the AI cannot read, an extraction that fails, an attachment too large, an email with no PO in it at all, and a database or storage failure part-way through. Spam included — it gets reviewed and dismissed by you, not guessed away by the system.

"Just ignore it" is no longer an option the code is allowed to take.

**On PDFs and photos — they are now treated identically.** You asked why photos should be any harder than PDFs, given the AI reads both by looking at them. You were right; they are not. Both go to the AI as pictures of the page and it reads them the same way.

One mechanical detail survives: the AI is sent images, so a PDF gets turned into a picture of each page first. Your own OpenRouter test already did exactly this and read the fields correctly, so the path is proven rather than theoretical. Worth recording precisely because it is easy to mistake for an unnecessary step later and remove.

**Means for your product:** The failure you were most worried about is now structurally prevented rather than hoped against. Your floor becomes "I have to type this one in myself" — which is exactly where you are today, so ingestion can only improve on the status quo, never fall below it. Photos and screenshots of POs work, not just PDFs.

**Check before approving:**
- **The review queue will contain spam.** That is deliberate — the alternative is the system deciding on its own that something was junk, which is the silent-miss failure wearing a different hat. If the volume becomes tiresome, the fix is a one-click dismiss, not an automatic one.
- **Only four file types are accepted: PDF, JPG, PNG and WebP.** Anything else is flagged asking the vendor to re-send. Notably **iPhone's default HEIC photo format is not readable** and will be flagged — relevant if a vendor ever sends one.
- **Nothing is compressed or resized before the AI reads it.** That keeps an extra piece of software — one with known security problems, which would have been handling files from an inbox anyone can email — out of the project entirely. The cost of skipping it is a few pennies a year.

**What this closes off:** The system can no longer be made quieter. Any future change that adds a "skip this" path has to write a review row instead, and that is now a rule rather than a preference. It also means the queue is the single place to look — so it has to stay usable as volume grows, which is a UI concern this decision creates and does not solve.

---

## FB-38: Testing No Longer Happens in the Live System

**Date:** 2026-10-12
**Architecture reference:** `docs/architecture.md` → *Security Architecture* → *Authentication* ("Revised 2026-10-12"). CONSTRAINT-20 amended.
**Tasks:** prerequisite for Task 98 onward.

**Decided:** Development now runs against a private copy of the database on this computer, not the live one the salesperson uses. The live passwords were removed from this machine entirely; only Vercel has them.

**Why:** The PO work feeds real customer documents through the system dozens of times while it's being tuned. Before this, every one of those test runs would have written rows and files into the live system, to be cleaned up by hand afterwards. A second cloud database wasn't available: both free slots are used and the paid tier was declined.

**Means for your product:** Nothing changes for the salesperson. For building, mistakes during development can no longer touch real orders. The scripts that wipe or seed data refuse to run against anything that isn't this computer.

**Check before approving:**
- **Starting work now takes three steps:** open Docker, run `npx supabase start`, then `npm run dev`. If Docker isn't running, the app won't load locally.
- **One thing is now only tested in production:** the special connection setting that fixed the August outage (CONSTRAINT-28). The local copy doesn't use it.

**What this closes off:** Nothing meaningful. Data seen locally is test data, not the salesperson's real orders. That's the point, but it means you can't check a live-data question from the dev app.

---

## FB-39: The System Can Now Read a PO

**Date:** 2026-10-12
**Architecture reference:** `docs/architecture.md` → *Email PO Ingestion* → "The extraction module". A-14 added.
**Tasks:** Task 98 done; Tasks 99 (checks) and 101 (worker) build on it.

**Decided:** A PO, whether PDF, photo or email text, is turned into structured fields: customer, PO number, delivery date, and tote lines with quantity and price. Each field comes with the exact words it was read from. PDFs are turned into page pictures first, then sent to the AI with zero-data-retention forced on.

**What it got right:** All 4 of your real vendor POs, after two prompt fixes. The first run named the ship-to company as the customer and the second named a buyer's initials. The rule is now "the Bill To company, otherwise the letterhead, never the ship-to and never a person."

**Means for your product:** The hard part, reading, works on your real documents. Nothing is visible yet. There's no screen, no inbox check and no review queue; those are Tasks 99–107.

**Check before approving:**
- **Two new add-ons draw the PDF pages. They haven't been run on Vercel yet.** One uses compiled code that sometimes misbehaves on hosting platforms. It gets checked on the first preview deploy, and there's a known fallback if it fails (A-14).
- **Size and time limits are set** so a hostile or huge PDF can't run up the AI bill or stall the server. One gap remains: a single pathological page can't be stopped mid-draw. That's accepted for now, with conditions attached to Task 101.

**What this closes off:** Nothing. The AI model is a setting and can be swapped without code changes.

---

## FB-40: Checking the AI Didn't Make a Value Up

**Date:** 2026-10-12
**Architecture reference:** `docs/architecture.md` → *Email PO Ingestion* → "Quote verification". CONSTRAINT-35 amended.
**Tasks:** decided before Task 99 (check suite) is written.

**Decided:** Every value the AI reads comes with the exact words it says it read it from. Those words are checked against the document's own text where the document has any: the email text, or the built-in text of a computer-made PDF. Each quote ends up "found", "not found" (flagged as possibly invented) or "can't check" (photos and scans, which have no built-in text). The AI still only ever sees pictures of the pages; the text is used to check it, not to read for it.

**Means for your product:** On computer-made PDFs, which all 4 of your samples are, an invented value is caught and pushed to the top of your queue. On a photo you'll see "couldn't check" and compare by eye against the document next to it, which is what you do today.

**Check before approving:**
- **This only helps if vendors mostly send computer-made PDFs.** If phone photos turn out to be common, a second AI "does this really say that?" check for photos can be added later.
- **"Can't check" doesn't push a PO to the top of the queue**, so a day of photos won't bury the real problems.

**What this closes off:** Nothing costly. It uses software already in the project and adds no AI cost.

---

## FB-41: One Broken Email Can No Longer Jam the Inbox

**Date:** 2026-10-12
**Architecture reference:** `docs/architecture.md` → *Email PO Ingestion* → "Give-up rule". New CONSTRAINT-37. Closes HIGH-02R.
**Tasks:** new task, before Task 104 (production wiring).

**Decided:** If one email fails to save on 3 runs in a row and at least an hour has passed since its first failure, the system stops retrying. It saves a placeholder in your review queue, "this email couldn't be stored, open it in Gmail", with the time Gmail received it, and moves on.

**Means for your product:** No email, broken or hostile, can stop the system from moving past it. At worst, a PO sits unseen for about an hour, then shows up as a placeholder you handle by hand from Gmail. Short storage or database outages fix themselves without creating placeholders.

**Check before approving:**
- The placeholder shows no sender, subject or document, only the arrival time. That's on purpose: whatever is in the email may be what's breaking it.
- You'll find the email in Gmail by its arrival time.

**What this closes off:** Nothing. The 3 runs and 1 hour are settings in code and easy to change.

## FB-42: The Worker That Reads Your POs: Where Its Pieces Live

**Date:** 2026-10-12
**Architecture reference:** `docs/architecture.md` → *Email PO Ingestion* → "The extraction worker", "Email-body POs keep their text", "Storage access without a session". New CONSTRAINT-38.
**Tasks:** Task 103 (worker). Task 104 reuses the storage module.

**Decided:** Three things, all needed before the worker can be built:
1. A PO typed into an email body now keeps its text on the PO row. Until now it was thrown away after being fingerprinted.
2. The server gets one new secret key, used by one small file that can only upload or download PO documents. The automatic jobs need it because no one is logged in when they run.
3. The worker claims up to 4 POs at a time in a way two runs can never share, counts each attempt before it starts, and gives up after 3 attempts. A PO whose run was killed becomes retryable after 5 minutes.

**Means for your product:**
- POs typed straight into an email now work end to end, and the review screen can show their text.
- The daily 06:00 run and the self-continuing worker can work while you're away.
- A PDF that crashes the worker every time ends up in your review queue as a failed row with empty fields, after 3 tries at most. It never disappears and never loops forever.

**Check before approving:**
- You'll need to add `SUPABASE_SECRET_KEY` to Vercel (Supabase → Settings → API Keys → create a secret key).
- A PO whose run died waits 5 minutes before it is retried.
- You accepted that a hostile PDF can waste a few seconds of server time per attempt, rather than adding a separate processing thread.

**What this closes off:** Nothing significant. The key can be revoked on its own; the body text could move into the bucket with one migration; an external cron can replace self-chaining without touching anything else.

## FB-42 follow-up: The Worker Reads POs One at a Time and Waits Before Retrying

**Date:** 2026-10-12
**Architecture reference:** `docs/architecture.md` → *Email PO Ingestion* → "The extraction worker" ("Claiming is one statement, one row at a time", "Retry delay").
**Tasks:** Task 115 (`@security` MEDIUM-09, MEDIUM-10).

**Decided:** Two changes to how the worker described in FB-42 above works:
1. It picks up **one PO at a time** (up to 4 per run), not 4 at once, and stops picking up new ones 30 seconds into a run.
2. A PO that hit a temporary error **waits 5 minutes** before it can be tried again.

**Means for your product:**
- A slow or broken PDF can no longer push the good POs queued behind it into manual entry. Only the PO being worked on loses a try.
- A short OpenRouter outage no longer uses up every waiting PO's 3 tries in seconds. The 3 tries now span at least 10 minutes.
- A corrupt PDF still gets 3 tries (your decision), so it reaches your review queue as a failed row about 10 minutes after it arrives.

**Check before approving:**
- After an outage, POs show up a few minutes later than before, instead of landing in manual entry.

**What this closes off:** Nothing. The 30 seconds and 5 minutes are settings in code.

## Task 116: The Worker Function Gets 120 Seconds, Not 60

**Date:** 2026-10-12
**Architecture reference:** `docs/architecture.md` → "The extraction worker" → "Route ownership".
**Tasks:** Task 116 (M-04 condition 3, A-11).

**Decided:** The worker route may run for up to 120 seconds per call (was planned as 60).

**Means for your product:** A PO picked up late in a run can finish its model call, so it isn't killed mid-read and retried 5 minutes later.

**Check before approving:**
- At Task 104, confirm Vercel's Fluid Compute is on for the project. Without it, Hobby caps functions at 60 s and the deploy fails with a clear error.

**What this closes off:** Nothing. It is one number in the route file, and a test keeps it inside safe bounds.

## Task 104: The Inbox Is Checked Once a Day, and the Button Uses the Same Path

**Date:** 2026-10-12
**Architecture reference:** `docs/architecture.md` → "Ingestion triggers".
**Tasks:** Task 104. Task 105 adds the button.

**Decided:** A Vercel cron checks Gmail once a day at 11:00 UTC. The manual "check now" button goes through the same route, not a separate one. There is no lock: if the daily run and a click overlap, nothing is duplicated.

**Means for your product:** New POs are waiting each morning. They arrive at about 06:xx in summer and 05:xx in winter, because Vercel schedules in UTC and fires anywhere within the hour. The button replies instantly and the work continues in the background. If the mailbox check fails, POs already picked up are still read.

**Check before approving:**
- Add `CRON_SECRET` and `INGEST_APP_ORIGIN` (the prod URL) in Vercel only, alongside `SUPABASE_SECRET_KEY` and `INGEST_TRIGGER_SECRET`.
- Fluid Compute must be on: the route runs for up to 300 s.

**What this closes off:** Automatic checks more often than daily while on Hobby, whose crons run at most once a day. Faster checks need the button or a paid plan.
