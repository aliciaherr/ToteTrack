# Data Model: ToteTrack

**Date:** 2026-04-25 (reconciled against live Supabase DB through migration `0008_po_multi_combo`)
**Status:** Approved — reflects production schema

---

## Enums

All enums implemented as Drizzle `pgEnum`. Never use raw strings in place of these values.

| Enum | Values |
|------|--------|
| `po_status` | `scheduled` \| `completed` \| `cancelled` \| `invoiced` |
| `container_size` | `275` \| `330` |
| `container_type` | `rebottled` \| `reconditioned` \| `brand_new` |
| `customer_status` | `active` \| `inactive` |
| `lead_status` | `hot` \| `warm` \| `cold` \| `converted` |
| `support_category` | `bug` \| `feature_request` \| `question` \| `other` |
| `support_priority` | `low` \| `standard` \| `high` \| `critical` |
| `ticket_status` | `open` \| `in_progress` \| `resolved` \| `closed` |

---

## Entities

---

### `customers`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom() | |
| `company_name` | text | NOT NULL | |
| `status` | customer_status | NOT NULL, default 'active' | |
| `contact_frequency_days` | integer | nullable | null = auto-calculated from order history |
| `notes` | text | nullable | |
| `default_delivery_address` | text | nullable | Pre-fills order delivery address (migration 0005) |
| `created_at` | timestamptz | NOT NULL, defaultNow() | |
| `updated_at` | timestamptz | NOT NULL, defaultNow() | |

**Relationships:**
- has many `customer_contacts` (cascade delete)
- has many `orders` (restrict delete — cannot delete customer with orders)
- has many `leads` via `converted_customer_id` (set null on delete)

---

### `customer_contacts`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom() | |
| `customer_id` | uuid | FK → customers.id, onDelete: cascade | |
| `name` | text | NOT NULL | |
| `role` | text | nullable | Job title / role |
| `email` | text | nullable | At least one of email/phone required (app-level) |
| `phone` | text | nullable | |
| `is_primary` | boolean | NOT NULL, default false | Only one primary per customer (app-enforced) |
| `created_at` | timestamptz | NOT NULL, defaultNow() | |
| `updated_at` | timestamptz | NOT NULL, defaultNow() | |

---

### `orders`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom() | |
| `po_number` | text | NOT NULL, UNIQUE | Manual entry by salesperson |
| `customer_id` | uuid | FK → customers.id, onDelete: restrict | Cannot delete customer with orders |
| `status` | po_status | NOT NULL, default 'scheduled' | See PO state machine in prd.md |
| `price` | numeric(10,2) | NOT NULL | Total PO price across all combos |
| `pickup_only` | boolean | NOT NULL, default false | |
| `delivery_address` | text | nullable | Required when pickup_only = false (app-level) |
| `requested_delivery_date` | date | nullable | Made optional in migration 0006 |
| `backhaul` | boolean | NOT NULL, default false | Pins to top of Pending Orders widget |
| `document_url` | text | nullable | Supabase Storage path (not a URL) |
| `notes` | text | nullable | |
| `invoice_id` | uuid | FK → invoices.id, onDelete: set null | null = not yet invoiced |
| `created_at` | timestamptz | NOT NULL, defaultNow() | |
| `updated_at` | timestamptz | NOT NULL, defaultNow() | |
| `qty_275_recon` | integer | NOT NULL, default 0 | 275L reconditioned |
| `qty_275_rebot` | integer | NOT NULL, default 0 | 275L rebottled |
| `qty_275_new` | integer | NOT NULL, default 0 | 275L brand new |
| `qty_330_recon` | integer | NOT NULL, default 0 | 330L reconditioned |
| `qty_330_rebot` | integer | NOT NULL, default 0 | 330L rebottled |
| `qty_330_new` | integer | NOT NULL, default 0 | 330L brand new |

**Multi-combo schema (Feature 9, migration 0008):** A single PO now holds quantities for all six size×type combinations in one wide row, replacing the old single `container_size` / `container_type` / `quantity` columns. Each `qty_*` column is a count for that combo; sum > 0 enforced app-level. The `container_size` and `container_type` enums still exist in the DB and encode the column-name suffixes.

**Indexes:** `customer_id`, `status`, `invoice_id`, `requested_delivery_date`

---

### `leads`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom() | |
| `name` | text | NOT NULL | |
| `title` | text | nullable | Job title |
| `company` | text | nullable | |
| `email` | text | nullable | At least one of email/phone required (app-level) |
| `phone` | text | nullable | |
| `status` | lead_status | NOT NULL, default 'warm' | |
| `lead_source` | text | nullable | Freeform text |
| `next_follow_up_date` | date | nullable | Drives dashboard Leads widget |
| `next_action_type` | text | nullable | 'call' \| 'email' \| 'visit' \| 'other' |
| `converted_customer_id` | uuid | FK → customers.id, onDelete: set null | null = not converted |
| `created_at` | timestamptz | NOT NULL, defaultNow() | |
| `updated_at` | timestamptz | NOT NULL, defaultNow() | |

**Indexes:** `status`, `next_follow_up_date`

---

### `lead_notes`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom() | |
| `lead_id` | uuid | FK → leads.id, onDelete: cascade | |
| `content` | text | NOT NULL | |
| `created_at` | timestamptz | NOT NULL, defaultNow() | Immutable — no updated_at |

**No `updated_at` column** — notes are append-only and never modified after creation.

---

### `invoices`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom() | |
| `invoice_number` | text | NOT NULL, UNIQUE | Format: INV-0001, INV-0002... auto-generated |
| `billing_month` | date | NOT NULL | Stored as first day of month (e.g., 2026-04-01) |
| `total_amount` | numeric(10,2) | NOT NULL | Sum of included orders' prices |
| `created_at` | timestamptz | NOT NULL, defaultNow() | |
| `updated_at` | timestamptz | NOT NULL, defaultNow() | |

**Indexes:** `billing_month`

**Invoice v3 (migration 0007):** Dropped `customer_id` and `status`. Invoices are no longer per-customer or status-tracked — an invoice is a billing-month rollup of orders (linked via `orders.invoice_id`).

**`billing_month` note:** Always stored as the first day of the month. Query example: `WHERE billing_month >= '2026-04-01' AND billing_month < '2026-05-01'`.

---

### `support_tickets`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom() | |
| `title` | text | NOT NULL | |
| `category` | support_category | NOT NULL | |
| `priority` | support_priority | NOT NULL | |
| `description` | text | NOT NULL | |
| `status` | ticket_status | NOT NULL, default 'open' | Developer updates this in Supabase dashboard |
| `developer_notes` | text | nullable | Developer updates this in Supabase dashboard |
| `created_at` | timestamptz | NOT NULL, defaultNow() | |
| `updated_at` | timestamptz | NOT NULL, defaultNow() | |

---

### `support_attachments`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | uuid | PK, defaultRandom() | |
| `ticket_id` | uuid | FK → support_tickets.id, onDelete: cascade | |
| `file_url` | text | NOT NULL | Supabase Storage path (not a public URL) |
| `file_name` | text | NOT NULL | Original filename for display |
| `created_at` | timestamptz | NOT NULL, defaultNow() | |

---

## Relationship Diagram

```
customers (1) ──────< customer_contacts (N)
customers (1) ──────< orders (N)
orders (N) >──────── invoices (1)    [invoice_id nullable]
leads (N) >────────  customers (1)   [converted_customer_id nullable]
leads (1) ──────────< lead_notes (N)
support_tickets (1) ─< support_attachments (N)
```

---

## Storage Buckets

| Bucket | Access | Path pattern | Max file size |
|--------|--------|-------------|---------------|
| `po-documents` | Private | `po-documents/[orderId]/[filename]` | 10MB |
| `support-attachments` | Private | `support-attachments/[ticketId]/[filename]` | 5MB |

Both buckets: serve files via signed URLs only (1-hour expiry). Never via public direct URLs.

---

## Drizzle Conventions (from `skills/db.md`)

- All PKs: `uuid`, `primaryKey()`, `defaultRandom()`
- All timestamps: `timestamptz`, `defaultNow()`, `notNull()`
- All enum columns: use `pgEnum` type — no raw strings
- All foreign keys: explicit `onDelete` behavior defined
- Column naming: `snake_case`
- No `select *` in queries — always list explicit columns
- Always use `.returning()` after inserts
- No raw SQL except for complex aggregations (Need-to-Contact calc, volume overview)
