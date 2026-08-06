# Design Decisions

**Source of Truth:** Google Stitch mockup — https://stitch.withgoogle.com/projects/8828216289252503548
**Fidelity Directive:** Build to match the Stitch mockup with high accuracy. Deviations are only permitted where technically impossible or where the mockup creates a layout problem specific to iPad viewing. All deliberate deviations are documented below.

---

## Visual Direction
**Type:** Internal SaaS
**Feeling:** Clean, professional, and purposeful — like a logistics command center that respects the user's time. Linear meets logistics.
**Reference products:** Linear, Notion, the Stitch mockup (primary)

---

## Design System — Industrial Slate

### Color Palette (from Stitch mockup)
| Role | Hex |
|------|-----|
| Primary (teal) | `#007A8A` |
| Secondary (slate) | `#475569` |
| Tertiary (blue-gray) | `#5C799B` |
| Neutral | `#64748B` |
| Background (app shell) | Light blue-gray (`~#F0F4F8`) |
| Card background | White `#FFFFFF` |
| Sidebar background | White / off-white |
| Overdue / warning | Red-orange (as shown in mockup) |

### Typography
- **Font:** ~~Inter (both headline and body)~~ — **as-built: the system sans stack.** `app/layout.tsx` loads Inter via `next/font/google` and sets `--font-inter`, but nothing maps `--font-sans` to it in the `@theme` block of `app/globals.css`, so `font-sans` resolves to Tailwind's default. Discovered 2026-07-26 during Feature 11 design review. Accepted as-is — see Deliberate Deviations.
- **Display numbers** ($ amounts, PO counts): Large, bold, dark
- **Category labels:** Small caps / uppercase, teal or neutral gray
- **Body:** Regular weight, slate gray

### Spacing & Shape
- **Border radius:** 8–12px on cards and buttons
- **Touch targets:** 44px minimum (iPad touch-first)
- **Card shadow:** Subtle (low elevation)
- **Density:** Moderate — not spreadsheet-tight, not spacious — match the mockup exactly

### Iconography
- ~~Material-style icons (as used in the mockup)~~ — **as-built: `lucide-react` (`^1.8.0`).** No Material icon package is or ever was installed; every icon in `components/**` comes from lucide. Discovered 2026-08-06. Accepted as-is — swapping icon sets now touches every screen for no user-facing gain.
- Consistent sizing across nav and table rows — `h-5 w-5` in nav, `size-4` inside buttons.

---

## Audience
**Primary user:** Single salesperson, non-technical, iPad landscape daily driver
**Platform priority:** Tablet-first (iPad landscape 1024px+), desktop secondary
**Use frequency:** Daily — animations should be subtle and fast, never decorative delays

---

## Screen-by-Screen Design Reference

### Global Shell
- **No top bar** on authenticated routes — chrome reduced to the pill hamburger only (see Deliberate Deviations table). No logo, no global search, no notification bell, no user avatar.
- **Pill hamburger:** white pill (44×44px, `rounded-full`, `shadow-md`), fixed top-left at `top-6 left-6` (24px from viewport edges, aligned with page content gutter). Tapping opens the Nav Drawer.
- **Navigation drawer:** slide-over overlay containing 6 nav items + a Sign Out button pinned at the bottom. Closes on nav item tap, backdrop tap, or Esc. Resting state: hidden.
- **Active nav item:** Left border teal accent + semi-bold label
- **Login screen exempt:** `/login` does not render the pill hamburger or any chrome — centered ToteTrack wordmark + password field only.

### Dashboard
- Page title: "Command Overview" / subtitle: "Real-time logistics matrix."
- Monthly/Yearly toggle: top right, pill-style toggle buttons
- Two hero cards side-by-side (light blue-gray background):
  - Left: TOTAL INVOICED (large $ display, delta badge with arrow, prior period comparison)
  - Right: PURCHASE ORDERS (large pending count, smaller confirmed count, arrow button)
- Two cards below (side-by-side):
  - Left: "Need to Contact" — customer rows with initials avatar, overdue badge in teal/red
  - Right: "Pending Orders" — PO rows with route info, BACKHAUL badge on pinned orders

### Customers
- Two-panel layout: customer list (left ~35%) + customer detail (right ~65%)
- List panel: search bar top, Active/Inactive toggle, sort dropdown (Alphabetical default)
- Customer rows: name, contact name + role, last sale date, "CONTACT NEEDED" badge
- Detail panel: customer name header, Edit + New Order buttons, contact card (name, role, email, phone, "X days ago — Contact Recommended"), Order History section with 1M/3M/6M/1Y/YTD tab filter, collapsible Pending Orders and Confirmed Orders subsections, Volume Overview (Per PO) grid showing 275gal and 330gal avg units with Reconditioned/Rebottled/Brand New breakdown as progress bars

### Orders
- Page title: "Active Shipments"
- "+ New Order" teal button top right
- Dense table columns: PO#, Customer (with avatar initial), Quantity/Size, Type (badge: Rebottled/Recon/New), Logistics (Req date or Pickup flag + BACKHAUL badge), Price
- Type badge colors: Rebottled (blue tint), Recon (teal tint), New (dark/inverted)
- Pagination row at bottom ("Showing X to Y of Z orders")

### Leads
- Two-panel layout: lead cards list (left) + lead detail (right)
- Lead cards: name, company, status badge (Warm/Cold/Hot), last contact date, next follow-up date, notes preview
- Detail panel: name, title, company, Edit + Email buttons, email + phone, Engagement section (Last Contact date, Lead Source, Status), Next Action panel (date picker, time, Action Type dropdown, Set Reminder button), Notes section with Add Note, Upcoming Reminders list

### Invoices
- Two-panel layout: Generate Invoice (left) + Invoice Ledger (right)
- Left panel: "Generate Invoice" heading, Billing Month picker, "PENDING PURCHASE ORDERS" checklist (PO ID, description, checkbox, price per line), Draft Total display, "Create Draft Invoice" teal button
- Right panel: "Invoice Ledger" heading with Filter button, table (Invoice ID, Period, Amount, Status badge: Sent/Paid/Draft)

### Support
- Two-panel layout: issues list (left) + Log New Issue form (right)
- Issues list: rows with priority badge (HIGH PRIORITY / STANDARD / LOW / CRITICAL, color-coded) + status pill (In Progress / Open / Resolved / Closed)
- Log New Issue form: Issue Title input, Category dropdown, Priority dropdown, Detailed Description textarea, Attachments upload zone (PNG/JPG up to 5MB), Cancel + Submit Issue buttons

---

## Component Approach
**Primary library:** shadcn/ui — closest match to the clean, low-chrome component style in the mockup
**Accent libraries:** None — the mockup's design is self-contained; no motion or hero libraries needed
**Rationale:** shadcn/ui gives unstyled-by-default components that can be precisely styled to match Industrial Slate. Avoids opinionated defaults that would fight the mockup fidelity goal.

---

## Interaction Principles
**Motion:** Subtle and purposeful — every animation communicates state change, not decoration. Use Framer Motion.
**Density:** Moderate — match the mockup. Tables use zebra striping (as shown). Cards use consistent padding (~16–20px).
**Feedback:** Toasts for save/create/delete confirmations. Inline validation on forms. No full-page reloads.

### Animation Specs

| Trigger | Animation | Duration | Easing |
|---------|-----------|----------|--------|
| Page / route transition | Fade + slight upward slide (4px) | 200ms | ease-out |
| Tab switching (1M/3M/6M etc., Monthly/Yearly) | Crossfade content, underline slides to new tab | 150ms | ease-in-out |
| Sidebar drawer open | Slide in from left + backdrop fade in | 200ms | ease-out |
| Sidebar drawer close | Slide out left + backdrop fade out | 150ms | ease-in |
| Modal / form panel open | Scale from 0.97 → 1 + fade in | 180ms | ease-out |
| Modal / form panel close | Scale 1 → 0.97 + fade out | 130ms | ease-in |
| Primary action (Save, Create, Submit) | Button press scale (0.97) + loading spinner swap | 100ms press | ease-in-out |
| Success / complete | Toast slides in from top-right, auto-dismisses | 250ms in / 200ms out | ease-out |
| Cancel / dismiss | Fade out + slight downward slide | 150ms | ease-in |
| Destructive action confirm | Shake micro-animation on the element | 300ms | ease-in-out |
| Row / card appear (list load) | Staggered fade-in per item (0–8 items max) | 150ms per item, 30ms stagger | ease-out |
| Badge / status change | Color crossfade in place | 200ms | ease-in-out |
| Collapsible section open/close | Height expand/collapse + chevron rotation | 200ms | ease-in-out |
| Chart data toggle (per-period ↔ cumulative) | Bar height animate to new values | 300ms | ease-in-out |
| Speed-dial FAB toggle (collapsed ↔ expanded) | "+" icon rotates 45° to "×" | 150ms | ease-in-out |
| Speed-dial FAB option fan-out (open) | Each option scale 0.8→1 + upward translate 8px→0; 30ms stagger between options, fan from FAB upward | 150ms per option | ease-out |
| Speed-dial FAB option fan-in (close) | Reverse of fan-out; 30ms stagger, options collapse back toward FAB | 130ms per option | ease-in |

**Rules:**
- Never animate layout shifts that move other content unexpectedly
- Respect `prefers-reduced-motion` — disable all animations except critical feedback (toasts) when set
- No looping animations in the resting state

---

## Deliberate Deviations from Mockup

| Deviation | Mockup | Build | Reason |
|-----------|--------|-------|--------|
| Navigation | Persistent left sidebar (always visible) | Hamburger slide-over drawer (hidden by default) | iPad landscape: persistent 200px sidebar = 20% of viewport permanently consumed. Slide-over gives full screen real estate to content. User explicitly requested this change. |
| Typeface | Inter | System sans stack (`ui-sans-serif, system-ui, …`) | Inter is loaded but never wired to `--font-sans`, so the app has always rendered in system sans. Found 2026-07-26. Left as-is by decision — switching now changes type metrics on every screen for no user-facing gain, and the build is internally consistent. Fix is one line in `app/globals.css` (`--font-sans: var(--font-inter)`) if ever wanted. |
| Drag-and-drop | Not in the mockup — no calendar screen exists there | `@dnd-kit/core` + `@dnd-kit/sortable` | Feature 11 needs sortable reordering, edge auto-scroll, keyboard drag, and touch drag-vs-scroll disambiguation on iPad. "Accent libraries: None" refers to motion/hero libraries; this is interaction behaviour, not visual styling. Approved by Builder 2026-07-26 without `@cto` review — no existing rule prohibits a dependency addition. |
| Calendar column width | n/a — screen not in mockup | 176px columns, not the 196px first drafted | 5 columns + gaps + the 80px pill gutter must total ≤1024px so a full Mon–Fri fits iPad landscape, the documented primary device. |
| Top bar | Full bar with logo, search, notification bell, user avatar | No top bar — pill-contained hamburger top-left only | Single-user internal tool — no need for avatar/notifications/branding inside the app. Global search would either be inert (Dashboard) or duplicate scoped per-screen search (list screens). Removing it recovers ~56–64px of vertical real estate (8–9% of iPad-landscape viewport). Decided 2026-04-23, see PRD Cross-cutting: App Shell Chrome (D10). |

All other visual decisions — colors, typography, layout, spacing, component shapes, density — must match the Stitch mockup as closely as possible.

---

## What to Avoid
- No persistent visible sidebar (replaced with hamburger — see deviations table)
- No rounded pill nav (mockup uses rectangular items with left-border active state)
- No dark mode (mockup is light only)
- No heavy drop shadows (mockup uses subtle elevation)
- No skeleton loaders with animation (subtle spinner only)
- No decorative gradients or background patterns
- No bottom tab bar (this is not a mobile native pattern)

---

## Open Questions for @cto
- Chart library for the invoice trend bar chart (4 modes: per-period monthly/annual + cumulative monthly/annual) — needs a library that can handle toggle-based dataset switching cleanly. Recharts vs. Chart.js vs. Tremor?
- File upload for PO documents — Supabase Storage vs. direct browser handling?
