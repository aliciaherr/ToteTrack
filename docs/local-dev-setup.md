# Local Dev Database Setup — Lifting CONSTRAINT-20

**Created:** 2026-10-11 · **Status:** ✅ Complete 2026-10-12 — see "Outcome" at the end

> **Why this file exists:** the install requires a reboot, which ends the Claude session that
> planned it. This is the durable copy — the install steps for the builder, and the approved
> Phase 2 plan for whichever session picks it up afterwards.

---

## Background

Under **CONSTRAINT-20** local dev, prod, the seed/wipe scripts and the admin auth user all
point at the **same** Supabase project. There is no sandbox. Feature 16 Task 98 ends that:
it feeds 4 real customer POs through extraction, which **writes rows** to `inbound_emails` /
`inbound_pos` and **uploads documents** to the prod `po-documents` bucket, twenty-plus times
over while the field schema is tuned.

CONSTRAINT-20 lifts on "a separate dev project **or** a local Supabase CLI stack."

**The cloud option is unavailable:** the builder's Supabase account is at its 2-project
free-tier limit and Pro is declined. **Do not re-propose a second cloud project.**
So: local stack. Decided 2026-10-11.

### What was found while planning (all three change the shape of the work)

1. **No Docker, no WSL2 on this machine.** `docker`, `wsl`, `supabase` and `psql` are all
   absent. `npx supabase` works (2.120.0). Hence Phase 1.

2. **The safety boundary is `.env`, not `.env.local` — the handoff had this wrong.**
   There is no `.env.local` file. **`.env` holds the real production values** (live project
   URL, `sb_publishable_…`, prod session-pooler `DATABASE_URL`). It is gitignored and
   untracked. The two config readers disagree:

   | Reader | Loads | If we merely added `.env.local` |
   |---|---|---|
   | Next.js (`npm run dev`) | `.env.local` over `.env` | → local ✅ |
   | drizzle-kit (`db:generate`/`migrate`/`studio`) | `dotenv/config` = **`.env` only** | → **still PROD** ❌ |
   | `db:seed` / `db:wipe` | `--env-file=.env.local` | → local (**currently broken** — file never existed) |

   Verified: `node_modules/drizzle-kit` imports `dotenv/config`, which loads `.env` and
   **not** `.env.local`. So the documented plan ("repoint `.env.local`") would sandbox the
   app while leaving every schema command pointed at production — the handoff's own trap,
   one layer deeper than it describes. **The prod string must leave `.env`, not be shadowed.**

3. **Migrations cannot be replayed by the tooling.** `db/migrations/meta/_journal.json`
   lists only `0001`. `drizzle-kit migrate` would apply the initial schema and believe
   0002–0016 do not exist. Any new database must replay all 16 files in order.

### Accepted costs of the local stack

- No session pooler and a different storage backend, so **CONSTRAINT-28 is not exercised
  locally** — a pooler-specific failure can now only surface in prod. Accepted 2026-10-11.
- Needs Docker running; `npx supabase stop` releases the containers, data persists.

---

## Phase 1 — Builder install steps (requires admin + reboot)

### 1. Open an elevated terminal
**Win + X** → **Terminal (Administrator)** → **Yes** on the UAC prompt. The title bar must
say *Administrator*.

### 2. Install WSL2
```powershell
wsl --install --no-distribution
```
`--no-distribution` installs the WSL2 engine without Ubuntu — Docker Desktop ships its own
distro, and this skips the UNIX username/password prompt. If it errors, fall back to plain
`wsl --install`.

### 3. Reboot
Required; virtualization features do not activate until you do.

### 4. Verify WSL
```powershell
wsl --version
```
Expect `WSL version: 2.x.x` plus a `Kernel version` line. If it still says "not installed",
stop and report it.

### 5. Install Docker Desktop
Download from **https://www.docker.com/products/docker-desktop/** → *Download for Windows
(AMD64)*. On the config screen keep **"Use WSL 2 instead of Hyper-V"** checked. Reboot or
sign out if asked.

### 6. First launch
Accept the service agreement, **skip the sign-in** ("Continue without signing in" — no
Docker account needed), skip the survey. Wait for the tray whale icon to go steady.

### 7. Memory
**Settings → Resources** → **Memory ≥ 4 GB** (6 is better; Supabase runs ~8 containers) →
**Apply & Restart**. If no sliders appear, the WSL2 backend is managing memory — fine, skip.

### 8. Verify Docker
```powershell
docker info
docker run --rm hello-world
```
Expect a `Server Version:` line, then "Hello from Docker!".

**Licensing:** Docker Desktop is free for personal use and businesses under 250 employees /
$10M revenue. ToteTrack is well inside that.

---

## Phase 2 — Approved plan (Claude executes once `docker info` responds)

Approved by the builder 2026-10-11. Seven steps, in order.

**1. Start the stack.** `npx supabase init` then `npx supabase start`. Yields a local API URL
(`http://127.0.0.1:54321`), an anon key, and Postgres on `127.0.0.1:54322`.

**2. Build the schema.** New `db/migrate-local.ts` replaying `db/migrations/0001…0016` in
order via the `postgres` driver already in dependencies (`tsx` is also present) — no psql, no
new tooling, and `db/migrations/` stays the single source of truth. **Do not** copy the SQL
into `supabase/migrations/`; two copies drift. Migration `0003` creates the `po-documents`
and `support-attachments` buckets and their policies, so storage comes along.

**3. Create the local auth user.** One user matching `ADMIN_EMAIL`, reusing the existing
QA identity per CONSTRAINT-04 — not a new one. The local service-role key is passed at call
time only and **written to no file** (`@security` T84-L02 removed it from `.env.example`
deliberately).

**4. Swap the env files — the load-bearing step.**

| File | Holds | Loaded by |
|---|---|---|
| `.env` | **local** values | Next.js **and** drizzle-kit ✅ |
| `.env.prod.reference` | prod strings, backup copy | **nothing** — inert |

Prod's real home remains the Vercel dashboard. **Add `.env.prod.reference` to `.gitignore`
in the same commit** — the existing rules (`.env`, `.env.local`, `.env.*.local`) do **not**
match that name, and an uncovered env file in this repo is how customer data leaked once
before (`@security` H-01, August).

Local values: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, the local anon key,
`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`. `NEXT_PUBLIC_APP_URL`
and `ADMIN_EMAIL` unchanged.

**5. Make `db:seed` / `db:wipe` safe to exist.** They point at `--env-file=.env.local`, which
has never existed — being broken is the only reason they have not destroyed production.
Repoint them at `.env` **and** add a guard at the top of `db/seed.ts` that refuses to run
unless `DATABASE_URL` is localhost, failing loudly. Without the guard, step 4 converts a
broken script into a working production wipe.

**6. Verify the boundary.** The hard requirement from the handoff: insert one row into
`inbound_emails` locally → confirm present locally → connect to prod read-only and confirm
**absent**. No real PO touches the system until this passes.

**7. Update the record.** Amend CONSTRAINT-20 (lifted, with conditions — amend, do not
delete), `docs/testing-setup.md:39`, `.env.example` comments, and log in
`docs/session-log.md`.

### Scope notes agreed at approval

- **This is not a plan task.** No `[ ]` exists for it; it is operational prep, logged in
  `session-log.md`. `@create-plan` stays reserved for Tasks 98+.
- **Gmail vars are absent from `.env` entirely** (`GMAIL_IMAP_USER`,
  `GMAIL_IMAP_APP_PASSWORD`, `GMAIL_IMAP_HOST`), so ingestion cannot run locally even after
  this. That is handoff item #2 — the blocker standing directly behind this one.

---

## How to resume after the reboot

Start a new Claude Code session in the project and say:

> Read `docs/local-dev-setup.md`. WSL and Docker are installed — run Phase 2.

Everything needed is in this file; no other context from the planning session is required.

---

## Outcome (2026-10-12)

All seven steps done. Deviations from the plan above:

- **`.env.prod.reference` was created, then deleted** at the builder's call. Nothing on the dev
  machine needs prod values (prod migrations go through the Supabase SQL editor; the live app
  reads Vercel), so a local copy was risk with no use. Prod's only home is Vercel. The
  `.gitignore` line stays as a backstop.
- **The guard lives in `db/local-guard.ts`** and covers `db:migrate-local` as well as seed/wipe.
- **Local schema tracking:** `db/migrate-local.ts` records applied files in
  `public._local_migrations` (local only), so re-runs apply only new migrations.
- **Boundary check:** marker `boundary-test-20261012` inserted locally; the builder ran a
  `SELECT count(*)` in the prod SQL editor → **0**. (Claude Code's auto-mode classifier blocked
  Claude from reading prod directly — correct behaviour.)
- `supabase_vector` (log collector) restart-loops on Windows. Harmless; the DB does not use it.
