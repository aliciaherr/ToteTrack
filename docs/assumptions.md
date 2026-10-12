# Assumptions: ToteTrack

> Per-project file. Produced by `@assumptions` command.
> Loaded by `@session-start` alongside `architecture.md` and `constraints.md`.
> This file is complete when every critical assumption is either validated or explicitly accepted as a known risk with a contingency. Nothing invisible. A known risk is acceptable. An unexamined assumption is not.

---

## Status

**Overall:** [x] Complete — all assumptions resolved or accepted

**Last updated:** 2026-08-18

---

## Assumption Categories

1. **Data availability** — Does the data source actually have what this project needs?
2. **Service capability** — Can the third-party service do what the project requires?
3. **User behavior** — Will users actually perform the interaction the product is designed around?
4. **Technical feasibility** — Can this be built with available tools and libraries?
5. **Cost** — Will this be affordable at real usage volume?

---

## Assumptions Log

---

### A-01 — Supabase free tier project pausing

**Category:** Service capability

**Assumption:** The Supabase free tier will stay active and available at all times for the salesperson.

**Why it's critical:** If the database is paused, the entire app returns errors and is unusable until manually unpaused via the Supabase dashboard. A salesperson who encounters errors on a Monday morning after a week off has a broken tool.

**Resolution approach:** Research + Accepted risk with mitigation

**Resolution detail:**
Confirmed from Supabase documentation: free tier projects are paused after 7 consecutive days of no database activity. Unpausing is manual (via Supabase dashboard, ~30 seconds) and does not require any code changes.

Mitigation: Implement a keep-alive mechanism during build — a lightweight cron job via cron-job.org (free) that pings a minimal Supabase query every 5 days. This prevents pausing entirely at $0 cost.

If the cron fails or is not implemented: document the unpause steps for the salesperson as part of app onboarding notes.

**Outcome:** Accepted risk with mitigation. Keep-alive cron ping to be implemented during build. Zero architectural impact.

**Mitigation revised 2026-08-17 — the cron was never built, and is now declined.** Two facts came to light together. First, the keep-alive cron **was never actually set up**: it was only ever documented (`README.md`, `docs/architecture.md:443`, `docs/plan.md` Task 30), and `docs/roadmap.md:93` still carried Task 30 unticked. The docs described a mitigation that did not exist, and a `@session-start` briefing repeated the assumption that it did. Second, the builder **declined it** on being told, on the grounds that the app is now in active daily use by the salesperson — so the database never approaches 7 consecutive idle days.

**The risk is therefore carried by daily usage, not by any mechanism.** That is a real mitigation while it holds, and it is not under anyone's control the way a cron is. The residual: **if usage stops for 7 consecutive days — holiday, illness, staff change, seasonal lull, or simply the salesperson moving on — the project pauses and the app is down until someone unpauses it manually** (~30 seconds, Supabase dashboard). The person most likely to hit that is the person least equipped to fix it, on exactly the Monday morning this assumption's "why it's critical" paragraph describes.

**Do not silently re-propose the cron.** It is a decided no, not an oversight. Re-open it only if the usage pattern changes — a second user, a handover, or a known period of inactivity — at which point it is ~10 minutes of setup and the original design in `README.md` still stands.

**Status:** [x] Accepted risk — mitigation revised 2026-08-17: carried by daily use, cron declined

---

### A-02 — Single-password auth not natively supported by Supabase Auth

**Category:** Service capability

**Assumption:** Supabase Auth can implement a "password only, no email" login experience.

**Why it's critical:** The login requirement is a single password field with no username or email. Supabase Auth requires an email address on every user account. If this cannot be implemented cleanly, the auth architecture needs to change.

**Resolution approach:** Research

**Resolution detail:**
Supabase Auth requires an email on every account — confirmed. However, the requirement can be fully satisfied with the following implementation:

- Create one Supabase Auth user at project setup with a fixed internal email: `admin@totetrack.app` (never shown to the user)
- The login screen presents a single password field only
- On submit, the app internally calls `supabase.auth.signInWithPassword({ email: 'admin@totetrack.app', password: enteredPassword })`
- The salesperson never sees, enters, or needs to know the email address

This approach retains Supabase Auth's built-in rate limiting, secure bcrypt password hashing, session management, and refresh token handling — with zero added complexity.

**Outcome:** Resolved. Use fixed dummy email + user-entered password. Login UI shows password field only. One Supabase Auth user created at project setup. No architectural change needed.

**Status:** [x] Resolved

---

### A-03 — Cold start: tool has low value before historical data is entered

**Category:** User behavior

**Assumption:** The salesperson will enter enough historical order and customer data for the tool's core features (Need-to-Contact logic, Volume Overview, purchase frequency) to be meaningful.

**Why it's critical:** On day one with no data: Dashboard Need-to-Contact list is empty, Volume Overview shows zeros, frequency calculations have nothing to work from. The tool is essentially a blank slate with no immediate value.

**Resolution approach:** Accepted risk

**Resolution detail:**
This cannot be validated before build — it depends entirely on the salesperson's willingness to enter backlog data in the first sessions. The tool is purpose-built for one person who is motivated to use it.

Contingency:
1. During build, prioritize making the new order form and customer creation flow fast to use — data entry must feel quick, not laborious
2. Build the Orders and Customers screens before the Dashboard so the salesperson can enter data before the dashboard is expected to be useful
3. Accept that sessions 1–3 will likely be data entry sessions before the dashboard becomes meaningful
4. No bulk import flow is in scope (confirmed in kickoff), but the manual entry UX must be optimized

**Outcome:** Accepted risk. Build sequence should prioritize data entry screens (Orders, Customers) before analytics/dashboard features.

**Status:** [x] Accepted risk

---

### A-04 — Framer Motion requires client components in Next.js App Router

**Category:** Technical feasibility

**Assumption:** Framer Motion animations can be implemented throughout the app without conflicting with Next.js App Router's server component model.

**Why it's critical:** Next.js App Router defaults to server components. Framer Motion requires browser APIs and cannot run server-side — all animated components must be marked `'use client'`. If this boundary is managed incorrectly, builds will fail or animations will silently not work.

**Resolution approach:** Accepted risk

**Resolution detail:**
Well-documented, well-understood constraint with a clear and consistent solution:
- Data-fetching wrappers and page shells → server components (fetch data, pass as props)
- Any component with a Framer Motion animation → `'use client'` client component
- The pattern: server component fetches and passes data → client component renders with animation

This is standard Next.js App Router + Framer Motion practice used in production apps. No performance or architectural concern.

**Contingency:** Architecture document (`docs/architecture.md`) must include an explicit component boundary rule so `@dev` does not accidentally mix server/client boundaries. The rule: if a component imports from `framer-motion`, it is a client component.

**Outcome:** Accepted risk. Component boundary rule to be documented explicitly in architecture.

**Status:** [x] Accepted risk

---

### A-05 — Touch drag-and-drop works on iPad inside a horizontally scrolling strip

**Category:** Technical feasibility

**Assumption:** `@dnd-kit`'s `TouchSensor` can distinguish a *drag* from a *scroll* on iPadOS well enough that a salesperson can drag a production card between day columns without accidentally scrolling the week strip, and without a long press that feels sluggish.

**Why it's critical:** iPad landscape is the documented primary device (`design-decisions.md` → Audience). The production calendar's core interaction is dragging cards, and the strip scrolls horizontally in exactly the same gesture space a drag starts in. If the two cannot be disambiguated, drag-and-drop is unusable on the only device that matters — and the feature's entire interaction model has to change, not just its tuning.

**Resolution approach:** Accepted risk — deliberately not validated before building.

**Resolution detail:**
No spike was run. The builder accepted the rework risk on 2026-07-26 and chose to discover the answer at implementation time rather than pay for a prototype first. Task 56 configures `TouchSensor` with a ~250ms activation delay and an 8px tolerance, which is the conventional setting for this exact problem: a press shorter than the delay, or a finger that travels past the tolerance, is treated as a scroll rather than a drag.

**Contingency:** If `TouchSensor` misbehaves on a real iPad, the agreed fallback is **tap-to-select then tap-target** — the card is selected by a tap, the destination column is chosen by a second tap, and no dragging occurs. This replaces the touch sensor rather than tuning it, and leaves the pointer and keyboard paths untouched.

**Outcome:** **Assumption failed on a real iPad (2026-07-27).** Drag was unusable ("botchy") in every iPad browser — all iPad browsers are WebKit underneath, so one engine's failure appears in all of them. Diagnosis: the sensor configuration was never the core problem. Three compounding causes: (1) nothing suppresses iPadOS's *own* long-press behaviours — at ~500ms the OS fires text-selection (magnifier/callout) and native drag on top of the 250ms `TouchSensor` drag, since no card sets `-webkit-touch-callout`, `user-select`, or `-webkit-user-drag`; (2) the 8px tolerance is tighter than natural fingertip drift over 250ms, so legitimate long-presses silently cancel and become scrolls; (3) there is no visual signal that activation happened, so users start moving before the delay elapses, which also cancels.

**Contingency revision (2026-07-27):** The original tap-to-select fallback is no longer viable — Task 58 shipped the card popup, so a plain tap is already taken. The builder chose a revised fallback instead: **long-press-to-arm, then tap-to-place** (Feature 13, Task 68). A ~350ms still-finger press arms the card (shake + bold outline); while armed, a tap on another card inserts at that card's position (cards below shift down), a tap on empty column space appends to that day, a tap on the unscheduled callout unschedules, and any other tap — including the armed card itself — cancels. The card is never glued to the finger, so the strip stays freely scrollable while armed and a distant week is reachable by ordinary scrolling. Desktop pointer drag and the keyboard path are unchanged; `TouchSensor` is removed rather than tuned.

**Status:** [x] **Resolved 2026-07-27** — contingency fired, replacement built (Task 68, `60abf0a`), and **validated on the real iPad by the builder the same day**: arm, cross-week place, same-day reorder, unschedule, cancel, and popup all confirmed working. A-05 is closed.

> **Bookkeeping note (2026-07-26, Task 56):** A-05 was referenced by `docs/plan.md` and `docs/session-handoff.md` for two sessions before this entry existed. It was written here during Task 56 because `@dev`'s pre-code assumption gate reads *this* file, and would have blocked on an assumption the builder had in fact already accepted. Same failure shape as the missing `manifest.md`: the decision was made and recorded, just not in the file the process checks.

---

### A-06 — PO extraction operating parameters

**Category:** Cost + Technical feasibility

**Assumption:** The five operating figures given by the builder on 2026-08-18 are accurate and stable enough to design the PO extraction feature against.

| Parameter | Stated value |
|---|---|
| Volume | 10–20 POs/day |
| SKU resolution | **Must resolve — strict.** Unmatched line items block the PO |
| Sender spread | 50–100 distinct customers |
| Cost of a missed error | A wrong shipment reaches the customer |
| Handwriting | Rare, under ~5% |
| Auto-accept | **None, ever.** Every PO is visually checked, however briefly |

**Why it's critical:** The last three are builder-set requirements and carry no validation risk. The first three were given from memory, never measured, and each changes the build if materially wrong:

- **Volume** — at 10–20/day model cost is under $1/day, so selection optimises purely for accuracy. At ~200/day cost returns and "no auto-accept" stops being sustainable.
- **Sender spread** — 50–100 is past hand-curating per-sender examples, so corrections must feed back automatically. Under ~10 makes hand-tuning viable and much cheaper.
- **Handwriting** — under 5% is an edge case. Above ~20% it drives model selection.

**Resolution approach:** Accepted. Each consequence above is reversible — model choice is config, not architecture.

**Outcome:** Volume and sender count are checkable against ToteTrack's own order and customer data — do this before sizing the resolver, whose difficulty scales directly with sender count. Handwriting validates itself when the Phase 0 benchmark set is assembled.

**Status:** [x] Accepted — verify volume and sender count against real data before sizing the resolver

> Source: design conversation 2026-08-18. Architecture rationale lives in `architecture-playbooks/playbooks/document-extraction.md` (separate repo).

---

## Summary

| # | Assumption | Category | Approach | Status |
|---|-----------|----------|----------|--------|
| A-01 | Supabase free tier project pausing | Service capability | Research + Accepted risk | Accepted — ~~keep-alive cron~~ **revised 2026-08-17: cron never built and now declined; carried by daily use** |
| A-02 | Single-password auth not natively supported | Service capability | Research | Resolved — fixed dummy email pattern |
| A-03 | Cold start: low value before data entered | User behavior | Accepted risk | Accepted — build data-entry screens first |
| A-04 | Framer Motion requires client components | Technical feasibility | Accepted risk | Accepted — document boundary rule in architecture |
| A-05 | iPad touch drag-and-drop inside a scrolling strip | Technical feasibility | Accepted risk | **Resolved 2026-07-27** — failed on device, contingency fired, replacement (long-press-to-arm + tap-to-place, Task 68) built and device-validated the same day |
| A-06 | PO extraction operating parameters (volume, senders, handwriting, strict resolution, no auto-accept) | Cost + Technical feasibility | Accepted | Accepted 2026-08-18 — verify volume and sender count against real data before sizing the resolver; handwriting validated at Phase 0 |

**Open count:** 0 — every assumption is resolved or accepted with its contingency exercised. A-05, the one assumption flagged as likely to fire, did fire and is now closed: its replacement interaction shipped and passed the real-device check on 2026-07-27.

> **Superseded 2026-10-07 by the "Added 2026-10-07" section below.** That count covered A-01 through A-06 only. Current open count across the whole file is **0** (A-12 closed 2026-10-08). The statement above remains accurate for A-01 through A-06.

A-06 carries one outstanding action, not a blocker: **verify volume and sender count against real data before sizing the resolver.**

---

## Spike Notes

No spikes were required. All assumptions were resolvable through research or accepted with contingencies.

---

## Added 2026-10-07 — Feature 16 (Email PO Ingestion) introduces new third-party services, a new data source, and a paid API

Mid-build re-run of `@assumptions`. A-01 through A-06 are closed and carried forward
untouched. Builder declined all three proposed spikes (2026-10-07); the three
assumptions they would have validated are therefore **accepted risks with
contingencies** rather than left Open.

**Why declining the spikes is reasonable here, recorded so it is not re-argued:** no PO
is ever auto-approved, so the review gate is itself the measuring instrument. Day one of
real use shows which fields came back empty, across every sender, at full volume — more
evidence than the handful of samples currently on hand would have produced. The spikes
were optional because the feature is self-diagnosing, not because the questions do not
matter.

Extends A-06, which already covers PO extraction operating parameters.

### A-07 — POs state container size and type recoverably across all senders

The six `qty_*` columns require both a size (275 / 330) and a type (reconditioned /
rebottled / brand new) per line. This assumes POs from 50–100 distinct senders state
both unambiguously enough to map. A PO reading "IBC x 40" with no size or type cannot
be mapped at any model accuracy — this is a source-data limit, not an extraction limit.

**Why not validated:** builder declined the spike. Cheaply validatable later from real
traffic.

**Contingency if false:** the quantity grid is left blank or partially filled and the
salesperson types quantities while reading the document in the side-by-side review.
Everything else — PO number, customer, address, delivery date, unit prices — still
pre-fills, so the feature degrades rather than fails. If it proves false for a large
share of senders, revisit whether per-sender field descriptions or exemplars close the
gap before concluding the mapping is impossible.

**Status:** [x] Accepted risk — detected automatically via the Feature 16 success metric
and visible empty fields from day one

### A-08 — OpenRouter serves GPT-4.1-mini with vision under ZDR enforcement

**Resolution: Research, completed 2026-10-07.** OpenRouter's ZDR documentation states
that enabling ZDR for the OpenAI model group "removes first-party OpenAI endpoints
(Azure remains available)." Three endpoints exist for `openai/gpt-4.1-mini`: OpenAI,
Azure, and Azure Sweden Central — all reporting `input_modalities: ["image","text","file"]`
and 1,047,576-token context. ZDR therefore leaves the two Azure routes. ZDR is set
account-wide per model group in privacy settings; the per-request `zdr` parameter ORs
with that. OpenRouter explicitly does not count in-memory implicit caching as retention,
which the `architecture-playbooks` document-extraction playbook already accepted.

Builder independently confirmed ZDR working in prior testing.

**Status:** [x] Resolved 2026-10-07

### A-09 — Gmail IMAP with an app password remains available

Ingestion authenticates to a dedicated Gmail account over IMAP using a 16-character app
password, which requires 2FA on the account and IMAP enabled. Google has progressively
restricted app passwords.

**Why not validated:** builder declined the spike. Task 96's first action is to connect,
so failure surfaces within minutes of starting that task.

**Contingency if false:** migrate to Gmail API with OAuth. Known fallback, costs a Google
Cloud project and an OAuth consent screen. Note the OAuth trap for whoever does it: while
the app is in "testing" mode refresh tokens expire after 7 days, which would silently kill
ingestion weekly until the app is published.

**Status:** [x] Accepted risk — failure mode is a loud auth error, not silent data loss

### A-10 — The salesperson actually checks extracted values rather than clicking through

The feature's whole safety model is that a human reviews every PO. Reviewing 10–20 POs in
one sitting trains reflexive approval, and items 8–15 receive less attention than 1–3.
A rubber-stamped wrong quantity reaches a customer as a wrong shipment — the stated cost
of error for this project.

**Why not validated:** behavioural, cannot be tested before real use.

**Contingency if false:** the Feature 16 success metric doubles as the tripwire — "% of POs
approved with zero field edits" sitting near 100% is evidence of rubber-stamping, not of
accuracy, and should be read that way. Mitigations already designed into the feature:
check-failures ordered first while attention is highest, source-quote highlighting so a
value can be traced to the document in one click, and deliberately sparse flagging so a
flag retains meaning.

**Status:** [x] Accepted risk — tripwire built into the success metric

### A-11 — A self-chaining function can drain a 20-PO batch within Vercel free-tier limits

Vercel Hobby caps a function at ~60s. One PO takes 5–8s, so a 20-PO batch cannot complete
in a single invocation. The design has each run process 4–5 POs then immediately invoke
itself, with the daily cron as a restart net. This assumes a fire-and-forget
self-invocation reliably survives the parent returning on the Hobby tier.

**Why not validated:** builder declined the spike. Surfaces at Task 101.

**Contingency if false:** revert to an external cron draining the queue every 5 minutes
(cron-job.org, already in use for the Supabase keep-alive). Changes only how the worker is
poked — no impact on schema, extraction, or review UI. A 20-PO batch would then take
~25 minutes instead of ~3, which the "partial with live count" dropdown already handles.

**Status:** [x] Accepted risk — fallback is strictly a scheduling change

### A-12 — `pg_trgm` is available on the Supabase free tier

The customer matcher ranks candidates by trigram similarity rather than exact match.
This requires the `pg_trgm` extension.

**Resolution: confirmed available, not yet enabled — 2026-10-08.** The builder ran
`select * from pg_available_extensions where name = 'pg_trgm'` against the live project:
one row, `default_version` **1.6**, `installed_version` **null**. So the extension ships
with this Supabase free-tier project and only needs switching on — `CREATE EXTENSION
IF NOT EXISTS pg_trgm;` — which **Task 100 must carry in its own migration**, not as an
ad-hoc statement. Until it runs, any `similarity()` or `%` operator fails as an unknown
function rather than silently degrading, so the enable statement and the first query that
needs it belong in the same migration.

**Contingency if false:** fall back to normalised exact matching (strip `Ltd` / `Limited` /
`PLC` / punctuation, lowercase) plus the address signal. Loses candidate *ranking* but keeps
matching. The existing `lib/actions/leads.convert.ts` already matches customers with
`ilike` on `company_name`, so there is precedent for the simpler approach.

**Status:** [x] Resolved 2026-10-08 — available (1.6), not installed; Task 100 enables it in its migration

### A-13 — Cost holds at real volume on free tiers

**API:** GPT-4.1-mini at $0.40/M input and $1.60/M output. ~1,500 input + ~500 output
tokens per PO is about **$0.0015 per PO**, or roughly **$8/year** at 15 POs/day. Builder's
independent side-testing suggested under $5/year. CONSTRAINT-07 is amended in Task 94 to
permit the spend without pinning a figure; the real number is measured over the first few
days and written in then.

**Storage:** Supabase free gives 1GB. At 15 POs/day with phone photos averaging ~500KB
uncompressed, the cap arrives in roughly 6 months. Images are compressed after review
completes (not before — full fidelity is needed during review), which stretches this to
roughly 2 years.

**Not applicable:** the command's 100-user and 1,000-user projections. The app is
single-user by architecture — one `ADMIN_EMAIL` per environment. Recorded so the absence
is not mistaken for an oversight.

**Contingency:** when storage approaches the cap, apply a retention policy deleting source
documents older than an agreed age. Orders retain their extracted values regardless; only
the source image is lost.

**Status:** [x] Accepted risk — contingency is a retention policy, not a paid upgrade

### A-14 — The PDF renderer runs in a Vercel function

**Added 2026-10-12, Task 98.** CONSTRAINT-35/36 make rendering PDFs to page images
load-bearing. The chosen renderer is `pdfjs-dist` drawing onto `@napi-rs/canvas`, a
**native** module (prebuilt binaries, no system libraries). It is verified locally on
Windows; it is **not** yet verified inside a Vercel serverless function (Linux), which is
where Task 101's worker will run it.

**Resolution:** accepted risk, approved with the Task 98 plan. **Verify at the first Vercel
deploy that exercises extraction** (Task 101/102) — render one synthetic PDF in a preview
deployment before any real PO depends on it.

**Deploy prerequisites found while building (2026-10-12), for Task 101/102:**
`next.config.js` will need `serverExternalPackages: ['pdfjs-dist', '@napi-rs/canvas']` — a
native `.node` binary cannot be bundled, and the renderer locates pdfjs's font/CMap files in
`node_modules`. The Vercel project must run **Node ≥ 22.13** (pdfjs-dist 6). The Linux
canvas binary is ~25–30 MB unpacked, counted against the function size limit.

**Update cadence (@security L-E):** both packages are pinned exactly and `@napi-rs/canvas`
wraps Skia (native C++) fed attacker-derived drawing data, so its security fixes never arrive
on their own. Check advisories for `pdfjs-dist` and `@napi-rs/canvas` before each deploy that
ships extraction, starting with Task 101.

**Contingency:** a WebAssembly renderer needs no native binary. `mupdf` was rejected for
its AGPL licence, so the fallback must be re-chosen then, not assumed.

### Summary of items added 2026-10-07

| ID | Assumption | Category | Resolution | Outcome |
|----|------------|----------|------------|---------|
| A-07 | POs state size + type recoverably across senders | Data availability | Accepted risk | Degrades to manual quantity entry; detected day one |
| A-08 | OpenRouter serves GPT-4.1-mini vision under ZDR | Service capability | Research | **Resolved 2026-10-07** — ZDR routes via Azure |
| A-09 | Gmail IMAP app password remains available | Service capability | Accepted risk | Fallback: Gmail API OAuth |
| A-10 | Salesperson checks rather than rubber-stamps | User behavior | Accepted risk | Tripwire: zero-edit rate near 100% |
| A-11 | Self-chaining drains a batch within free-tier limits | Technical feasibility | Accepted risk | Fallback: 5-minute external cron |
| A-12 | `pg_trgm` on Supabase free tier | Technical feasibility | Research | **Resolved 2026-10-08** — available (1.6), not installed; Task 100 enables it |
| A-13 | ~$8/yr API, 1GB storage holds ~2 years compressed | Cost | Accepted risk | Retention policy when cap nears |
| A-14 | `@napi-rs/canvas` PDF renderer runs on Vercel (added 2026-10-12) | Technical feasibility | Accepted risk | Verify on first preview deploy; fallback: WASM renderer, re-chosen |

**Open count: 0.** A-12 closed 2026-10-08 (see its entry above — the table row read
"Open" until 2026-10-11, three days after the entry itself recorded the resolution; a
hand-maintained count beside a hand-maintained entry drifts, which is the same failure
CONSTRAINT-32 took the number out of CONSTRAINT-05 for). A-01 through A-06 remain closed.
Tasks 94–97 depended on none of the above.

### Spike note (2026-10-07)

Three spikes were proposed (IMAP connect, extraction accuracy on real POs, Vercel
self-chaining) and all three were declined by the builder. Two were genuinely redundant —
Task 96 opens with an IMAP connection and Task 101 opens with a self-invocation, so each
task is its own spike with a known fallback. The third (extraction accuracy) was the one
with real information value; it is absorbed by A-07 and A-10, both of which are detected
automatically from real use because nothing auto-approves. Consistent with the original
note above: no spike has yet been required on this project.
