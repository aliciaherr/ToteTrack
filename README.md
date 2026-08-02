# ToteTrack

Single-user sales operations CRM for an IBC tote salesperson. Tracks customers, purchase orders, leads, and invoices — with built-in prompting on who to contact next.

## Stack

Next.js 14 (App Router) · Supabase (PostgreSQL + Auth + Storage) · Drizzle ORM · shadcn/ui · Tailwind CSS · Framer Motion · Recharts · Vercel (free tier).

## Local Development

```bash
cp .env.example .env.local
# Fill in real values in .env.local — see "Environment Variables" below
npm install
npm run dev
```

Build / start in production mode:

```bash
npm run build
npm start
```

## Tests

```bash
npm test
```

Runs the full Vitest suite (unit tests only — no external services required).

## Environment Variables

All six variables must be set in `.env.local` for local dev and in the Vercel project settings for production.

| Variable | Source | Used by |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project settings → API → Project URL | Browser + server Supabase clients |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project settings → API → `anon` public key | Browser + server Supabase clients |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings → API → `service_role` secret | Server-only (`lib/supabase/server.ts`) — never exposed to the browser |
| `DATABASE_URL` | Supabase project settings → Database → Connection string (URI) | `db/index.ts` + Drizzle CLI (`db:generate` / `db:migrate`) |
| `ADMIN_EMAIL` | Fixed value: `admin@totetrack.app` | `signIn` server action — never shown in UI (per CONSTRAINT-04). Must match the email of the single Supabase Auth user you create below. |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` locally · your deployed URL in production | Reserved for app-wide URL references |

See `.env.example` for placeholder values. Do not commit `.env` or `.env.local` — both are in `.gitignore`.

## Supabase Setup (First-Time)

Do this once per Supabase project. The migrations and auth user are persistent — subsequent deploys only need the env vars in Vercel.

### 1. Create the project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and create a new project on the free tier.
2. Copy the values listed above (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`) into your `.env.local` and into the Vercel project environment.

### 2. Apply the database migrations

There are **thirteen** migration files under `db/migrations/`. They must **all** run, **in numerical order**, on a fresh Supabase project. Skipping any of them leaves the schema behind the application code and screens will fail at query time.

- `0001_initial_schema.sql` — tables, enums, foreign keys (generated from the Drizzle schema)
- `0002_rls_policies.sql` — enables Row Level Security on all eight tables (CONSTRAINT-05 — mandatory, never disable)
- `0003_storage_buckets.sql` — creates the private `po-documents` and `support-attachments` storage buckets (CONSTRAINT-06)
- `0004_drop_pending_status.sql` — PO status model v2
- `0005_customer_default_delivery_address.sql`
- `0006_optional_delivery_date.sql` — makes `requested_delivery_date` nullable
- `0007_invoice_v3_drop_status_and_customer.sql` — invoice model v3 (CONSTRAINT-17)
- `0008_po_multi_combo.sql` — the six `qty_*` columns (Feature 9 / CONSTRAINT-09)
- `0009_po_unit_prices.sql` — the six `unit_price_*` columns; `price` becomes a derived total (Feature 10)
- `0010_production_calendar.sql` — `production_date`, `same_day_delivery`, `production_sort_index` (Feature 11 / CONSTRAINT-19)
- `0011_backfill_production_date.sql` — **data migration, no schema change.** Writes a starting `production_date` for existing rows. Must run *after* `0010`. Idempotent, and a no-op on a genuinely fresh database with no orders.
- `0012_customer_addresses.sql` — the `customer_addresses` table (saved delivery addresses, Feature 14), backfilled from `customers.default_delivery_address`, with RLS enabled
- `0013_customer_addresses_unique.sql` — collapses any duplicate saved addresses, then adds a `UNIQUE (customer_id, address)` index. Must run *after* `0012`.

There is **no CLI migration runner** in this repo. Apply each file by pasting it into the Supabase SQL Editor and running them in sequence:

1. Open the Supabase Dashboard → SQL Editor → New query.
2. Paste the contents of `db/migrations/0001_initial_schema.sql` → Run.
3. Repeat for each remaining file **in numerical order**, through `0013`.

Verify the result by running `SELECT tablename FROM pg_tables WHERE schemaname = 'public';` — you should see `customers`, `customer_contacts`, `customer_addresses`, `orders`, `leads`, `lead_notes`, `invoices`, `support_tickets`, and `support_attachments`.

### 3. Create the single Auth user

ToteTrack is single-user. Create one Supabase Auth user whose email matches `ADMIN_EMAIL`.

1. Supabase Dashboard → Authentication → Users → **Add user** → **Create new user**.
2. Set:
   - **Email:** `admin@totetrack.app` (this value is fixed — it must match the `ADMIN_EMAIL` env var exactly)
   - **Password:** choose the salesperson's password
   - **Auto Confirm User:** ✅ checked
3. Save.

> ⚠ **Never change this email.** `CONSTRAINT-04` binds the login flow to the value in `ADMIN_EMAIL`; the salesperson never sees or enters an email, only the password. If you change the email here you must also update `ADMIN_EMAIL` in every environment (locally and on Vercel) — otherwise every login attempt will fail.

Lost password: reset it via Supabase Dashboard → Authentication → Users → edit user. There is no in-app forgot-password flow (single-user project).

## Vercel Deployment

1. Push the repo to GitHub (`main` branch).
2. Import the repo in the Vercel dashboard.
3. Set all six env vars from the table above in **Settings → Environment Variables** (apply to Production + Preview).
4. Trigger a deploy. Subsequent pushes to `main` auto-deploy.

## Keep-Alive Cron (Required for Production)

Supabase free-tier projects are paused after **7 consecutive days of no database activity**. For a salesperson who might not open the app every day, this means the tool silently goes dark until someone manually unpauses it from the Supabase dashboard.

The fix is a free external cron that pings the database on a schedule (every 5 days — well inside the 7-day window). See `docs/assumptions.md` A-01 for the rationale.

### Setup at [cron-job.org](https://cron-job.org) (free)

1. Sign up / sign in.
2. **Cronjobs → Create cronjob.**
3. Configure:

   | Field | Value |
   |---|---|
   | **Title** | `ToteTrack keep-alive` (anything — for your reference) |
   | **URL** | `[NEXT_PUBLIC_SUPABASE_URL]/rest/v1/customers?select=id&limit=1` |
   | **Schedule** | Every 5 days (e.g. `0 12 */5 * *` — noon UTC every 5th day) |
   | **Request method** | `GET` |
   | **Headers** | `apikey: [NEXT_PUBLIC_SUPABASE_ANON_KEY]` |

   Replace `[NEXT_PUBLIC_SUPABASE_URL]` and `[NEXT_PUBLIC_SUPABASE_ANON_KEY]` with the real values from your Supabase project settings — do **not** use the `service_role` key here (the anon key is correct; RLS protects the data).

4. Save and enable the cronjob. The execution history tab confirms each ping returned `200 OK`.

The query hits a public REST endpoint with RLS active, so it returns no data even though it keeps the project warm. Zero read / zero bandwidth impact.

## If Supabase Is Paused

If the keep-alive cron misses a window (or hasn't been set up yet) and the project pauses, the app will return database errors on every screen.

To recover (~30 seconds):

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) and open the ToteTrack project.
2. The project banner will say **Paused** with a **Restore project** button — click it.
3. Wait 20–30 seconds for the project to come back online.
4. Refresh the app. No code or env-var changes required.

After restoring, confirm the keep-alive cron is still active at cron-job.org so the pause doesn't repeat.

## Operational Notes

- **Developer replies on support tickets.** `developer_notes` and ticket `status` are edited directly in the Supabase dashboard table editor (Table Editor → `support_tickets`). There is no developer-facing UI — by design.
- **File downloads expire.** Signed URLs for PO documents and support attachments expire after 1 hour. Clicking the download link again generates a fresh URL.
- **Storage budget.** The free tier allows 1 GB across both buckets combined. Current usage is visible in Supabase Dashboard → Storage.
