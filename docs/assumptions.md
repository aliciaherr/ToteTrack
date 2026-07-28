# Assumptions: ToteTrack

> Per-project file. Produced by `@assumptions` command.
> Loaded by `@session-start` alongside `architecture.md` and `constraints.md`.
> This file is complete when every critical assumption is either validated or explicitly accepted as a known risk with a contingency. Nothing invisible. A known risk is acceptable. An unexamined assumption is not.

---

## Status

**Overall:** [x] Complete — all assumptions resolved or accepted

**Last updated:** 2026-04-19

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

**Status:** [x] Accepted risk

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

## Summary

| # | Assumption | Category | Approach | Status |
|---|-----------|----------|----------|--------|
| A-01 | Supabase free tier project pausing | Service capability | Research + Accepted risk | Accepted — keep-alive cron mitigation |
| A-02 | Single-password auth not natively supported | Service capability | Research | Resolved — fixed dummy email pattern |
| A-03 | Cold start: low value before data entered | User behavior | Accepted risk | Accepted — build data-entry screens first |
| A-04 | Framer Motion requires client components | Technical feasibility | Accepted risk | Accepted — document boundary rule in architecture |
| A-05 | iPad touch drag-and-drop inside a scrolling strip | Technical feasibility | Accepted risk | **Resolved 2026-07-27** — failed on device, contingency fired, replacement (long-press-to-arm + tap-to-place, Task 68) built and device-validated the same day |

**Open count:** 0 — every assumption is resolved or accepted with its contingency exercised. A-05, the one assumption flagged as likely to fire, did fire and is now closed: its replacement interaction shipped and passed the real-device check on 2026-07-27.

---

## Spike Notes

No spikes were required. All assumptions were resolvable through research or accepted with contingencies.
