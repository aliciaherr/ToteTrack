# Backlog: ToteTrack

> **Known work that is not a planned task yet.** When an item is planned it becomes a task in
> `docs/plan.md` and a line in `docs/roadmap.md`, and is removed from here. When it is done
> or dropped, it is removed with a session-log note.
> Security findings are listed by ID only: their details stay in the gitignored
> `docs/security-report.md` (SEC-07).

---

## Decisions owed (builder)

- **Brenntag branches (`@cpo`, before Task 107).** Should an exact parent-name match skip the
  customer pre-fill when a *different* customer matches the ship-to address?

## Verifications owed

- **A-14:** the first deploy renders a PDF in a Vercel function (go-live checklist, `roadmap.md`).
- **A-15:** pdf.js draws PDFs in iPad Safari (Task 117 is not done until this is checked).
- **`@security` on Task 114 (HIGH-02R):** the plan recorded a re-run as owed, and the report
  that would show it was overwritten by later audits. Confirm it was covered, or run it.

## Code

- **Safe error logging app-wide.** `db/queries/*` still log the raw drizzle `cause`, which can
  carry query params. Adopt `loggableFailure` / `parameterFreeCause` everywhere, as one task.
- **Unique-violation checks miss drizzle's wrapping:** `lib/actions/orders.ts` (~line 59) and
  `lib/actions/invoices.ts` (~line 216) check `code` on the top-level error only, so a duplicate
  is reported as a generic failure. `inbound-emails.ts` `isMarkerViolation` shows the fix.

## Operations

- **Vercel `DATABASE_URL`** is flagged "needs attention" (not marked Sensitive). Save the value
  first, then re-add it as Sensitive.
- **Delete `docs/customers-export.csv`** (real customer data, gitignored) once it is no longer needed.

## Open security Lows (details in `docs/security-report.md`)

- LOW-T104-3: Vercel config; covered by the go-live checklist.
- LOW-T116-2: no minimum secret length; settled by the 64-hex go-live secrets.
- LOW-T115-1, LOW-T115-2: accepted.
- LOW-T103-1 to -3.
- LOW-NEW-1 to -6: the review UI. NEW-1/-4 (stuck-import alert) shipped in Task 105; NEW-2/-3
  are in Task 106; NEW-5 (label quotes "found in document text") belongs to Task 107.

## Deferred by decision (2026-10-12 `@code-review`)

- Retry empty or non-JSON model replies instead of parking the row at once (today
  `ExtractionResponseError` is permanent).
- Log message-free stack traces (EH-03) alongside `loggableFailure`'s class names.
