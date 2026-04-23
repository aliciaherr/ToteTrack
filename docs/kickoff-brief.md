# Kickoff Brief: ToteTrack

**Date:** 2026-04-19

## One-Line Description
A single-user sales operations CRM for a tote salesperson to track customers, purchase orders, leads, and invoices — with built-in prompting on who to contact next.

## Problem
The salesperson currently manages their business through a mix of PDF uploads and manual entries — no single source of truth, no visibility into who is overdue for contact, and no structured way to generate invoices from purchase order history. The tool replaces that with a purpose-built, clean operations tool tailored to the IBC tote business.

## Target User
One salesperson running an IBC tote (industrial bulk container) resale business. Buys from a single supplier, sells to multiple customers. Works primarily on an iPad in landscape mode. Not technical. Needs a tool that feels like a modern business app, not a spreadsheet.

## Core Scope

### In
- **Dashboard** — time period toggle (monthly/yearly), hero cards (total invoiced, pending/scheduled PO counts), invoice trend bar chart with 4 modes (per-period monthly, per-period annual, cumulative monthly, cumulative annual; monthly view capped at 12 months), Need-to-Contact customer list, leads-to-follow-up list, pending orders list with backhaul orders pinned to top
- **Customer List** — active/inactive toggle, sort options (alphabetical, order count, need-to-contact), customer detail view with multiple contact emails/phones, last sale date, order history across time windows (1M/3M/6M/1Y/YTD), averages panel (typical totes per PO by size: 275/330 gallon, and type: Rebottled/Reconditioned/Brand New)
- **Orders** — PO tracking with: PO number, customer, price, container size, container type, pickup-only flag, requested delivery date, quantity, delivery address, backhaul flag (yes/no), PO document upload; statuses: scheduled → pending → completed / cancelled / invoiced
- **Leads** — follow-up scheduling, last contact date, notes, reminders, manual conversion to customer
- **Invoices** — select month + customer (or all customers), view all POs for that period as rows (PO number, customer, quantity, price), running total at bottom, save as single invoice record; prior invoices list; read-only (no export or email delivery)
- **Support** — salesperson submits bugs/feature requests to developer; view prior submissions and status
- **Auth** — single password, no username
- **Need-to-Contact logic** — auto-calculated purchase frequency from order history, with manual override per customer; sorted by most overdue first
- **PO statuses** — scheduled, pending, completed, cancelled, invoiced (auto-set when invoice is created for that month)
- **Backhaul** — yes/no flag on PO, pins order to top of pending list on dashboard

### Explicitly Out
- Supplier management (single supplier, managed outside the tool)
- Invoice delivery (no PDF export, no email send)
- Offline support
- Multi-user
- External integrations (QuickBooks, email, calendar)
- Margin / profitability tracking

## Risks and Assumptions
- **Data quality dependency** — Need-to-Contact logic and averages panel rely on consistent order entry. If the salesperson doesn't keep data updated, the dashboard becomes noise. Mitigate with clear UI feedback on data staleness.
- **Historical data migration** — Backlog exists as PDFs and manual entries. Getting clean historical data in is tedious; averages and frequency calculations start from zero without it. A manual bulk-entry flow may be needed.
- **Single-password auth is a security risk** — No username means one credential to steal. No self-service recovery path; compromise requires developer intervention. Flagged for `@assumptions` to validate whether this is acceptable long-term.
- **Invoice read-only may become a blocker sooner than expected** — Customers likely need to receive something. Phase 2 has a way of never arriving. Monitor post-launch.

## Platform Target
Web — responsive (primary: tablet/iPad landscape; secondary: desktop browser)

## Stack
TBD — deferred to `@recruit` / `@cto`. Known constraints:
- Database: Supabase (free tier) is a strong candidate — covers database + auth + file storage at $0
- Hosting: must be $0 — Vercel free tier is the likely frontend host
- Full stack decision to be finalized at `@recruit`

## Constraints
- **Deadline:** 2026-04-26 (1 week from kickoff)
- **Budget:** $0 for hosting
- **Build:** Claude builds; user owns planning and decisions. Target under 10 build hours.

## ASCII Wireframe

```
[Login — single password]
        |
        v
+-------------------------------+
|         DASHBOARD             |
|  [Total Invoiced] [PO Counts] |
|  [Invoice Trend Chart]        |
|  [Need to Contact]            |
|  [Leads to Follow Up]         |
|  [Pending Orders]             |
+-------------------------------+
   |           |           |
   v           v           v
+--------+ +--------+ +--------+
|CUSTOMER| | ORDER  | | LEADS  |
| DETAIL | | DETAIL | | DETAIL |
+--------+ +--------+ +--------+

[Invoices]
   |
   v
Select Month → Select Customer (or All)
   |
   v
+------------------------------------------+
|  PO #    | Customer  | Qty  | Price      |
|  PO #001 | Acme Co   |  10  | $500       |
|  PO #002 | Beta Inc  |   5  | $250       |
|  PO #003 | Acme Co   |   8  | $400       |
|------------------------------------------|
|  TOTAL:  $1,150                          |
+------------------------------------------+
   |
   v
Save Invoice

[Support] → Submit issue → View prior issues
```

## Open Questions
- Single-password auth: acceptable long-term security posture for a single-user tool with business-sensitive data? Flag for `@assumptions`.
- Historical data entry: does the salesperson need a bulk import flow, or will they enter history manually over time?
- Container sizes and types: are 275/330 gallon and Rebottled/Reconditioned/Brand New exhaustive, or should these be configurable?
- Purchase frequency unit: is "expected purchases per month" the right unit, or does the salesperson think in weeks or days?
