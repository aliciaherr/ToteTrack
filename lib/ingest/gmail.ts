import { ImapConnectionError, IngestConfigError } from '@/lib/errors'
import { assertUsableWatermark } from './imap-session'
import { admitMessage, exceedsMessageCount } from './limits'
import { MAX_MESSAGES_PER_RUN } from './limits.constants'
import { parseMessage, refusalFor, unreadableMessage } from './message'
import type {
  AdmissionWindow,
  CollectedMail,
  DeclaredMessage,
  GmailDeps,
  GmailImapConfig,
  ImapSession,
  InboundMessage,
} from './types'

/**
 * Reads the ingestion mailbox over IMAP and returns parsed messages.
 *
 * This module performs **no database and no storage write** and imports
 * nothing from `@/db`. It is handed the admission window — watermark and
 * already-staged UIDs — and hands back parsed messages; `runIngestion` reads
 * the window from the database and stages the result. Keeping it pure is what
 * lets its tests run with no database and no socket — the live connection
 * lives behind `ImapSession`, in `imap-session.ts`.
 *
 * Selection is by `(UIDVALIDITY, UID)` alone (CONSTRAINT-33). The inbox is
 * opened read-only, the `\Seen` flag is neither read nor written, and no
 * header participates in deciding what is new.
 *
 * Every message is admitted or refused on its **declared** size before any of
 * its bytes are downloaded; `limits.ts` owns that decision (H-01).
 */

/** Stands in for the app password anywhere a message could otherwise echo it. */
const REDACTED = '[redacted]'

/**
 * Just the string lookups the config reader needs. `process.env` satisfies it,
 * and so does a plain object literal in a test — unlike `NodeJS.ProcessEnv`,
 * which requires `NODE_ENV` and so cannot be written out by hand.
 */
type EnvLookup = Readonly<Record<string, string | undefined>>

function requireEnv(env: EnvLookup, name: string): string {
  const value = env[name]?.trim()
  if (!value) {
    throw new IngestConfigError(
      name,
      'is missing or empty. Set it in .env and in the Vercel environment; .env.example lists the expected shape.'
    )
  }
  return value
}

/**
 * Rejects an ingestion mailbox that is the same account as `ADMIN_EMAIL`.
 *
 * `ADMIN_EMAIL` is a live Supabase Auth credential (CONSTRAINT-04), not a
 * spare inbox. Pointing ingestion at it would stage the application's own
 * sign-in mail as purchase orders and read a mailbox nobody intended to
 * expose. Compared trimmed and case-insensitively, because two strings naming
 * the same Gmail account in different case are still the same mailbox.
 *
 * Neither address is interpolated into the message. The operator already knows
 * what they set, and CONSTRAINT-04 requires the production `ADMIN_EMAIL` to
 * stay out of any file — a log sink included.
 */
function assertNotAdminMailbox(user: string, adminEmail: string | undefined): void {
  const admin = adminEmail?.trim().toLowerCase()
  if (!admin || admin !== user.trim().toLowerCase()) return
  throw new IngestConfigError(
    'GMAIL_IMAP_USER',
    'is set to the same mailbox as ADMIN_EMAIL. The ingestion inbox must be a separate Gmail account: ADMIN_EMAIL is the live Supabase Auth login (CONSTRAINT-04), so reading that mailbox would ingest the sign-in mail of this application itself. Point GMAIL_IMAP_USER at the dedicated ingestion account.'
  )
}

/**
 * Resolves the IMAP credentials from the environment and runs the startup
 * guards. Throws `IngestConfigError` on a missing variable or on the
 * `ADMIN_EMAIL` collision — it never returns a partly-filled config.
 *
 * `env` is a parameter so tests can describe an environment without mutating
 * `process.env`. No value here has a default: a credential with a fallback is
 * a credential in source (SEC-01).
 */
export function readGmailImapConfig(env: EnvLookup = process.env): GmailImapConfig {
  const user = requireEnv(env, 'GMAIL_IMAP_USER')
  assertNotAdminMailbox(user, env.ADMIN_EMAIL)
  return {
    host: requireEnv(env, 'GMAIL_IMAP_HOST'),
    user,
    appPassword: requireEnv(env, 'GMAIL_IMAP_APP_PASSWORD'),
  }
}

/** Removes the app password from text that is about to be thrown or logged. */
function scrubSecret(text: string, secret: string): string {
  return secret ? text.split(secret).join(REDACTED) : text
}

function describeCause(cause: unknown, config: GmailImapConfig): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  const reason = scrubSecret(raw, config.appPassword)
  if (!/auth/i.test(reason)) return reason
  return `${reason}. Check GMAIL_IMAP_APP_PASSWORD — the account needs 2FA enabled and IMAP turned on, and Google has been retiring app passwords (A-09).`
}

/**
 * Opens the ingestion mailbox read-only through `deps.openSession`.
 *
 * @throws {ImapConnectionError} on a connection or authentication failure,
 *   with host and user in the message and the app password scrubbed out.
 */
export async function openMailbox(deps: GmailDeps): Promise<ImapSession> {
  try {
    return await deps.openSession(deps.config)
  } catch (cause) {
    throw new ImapConnectionError(
      deps.config.host,
      deps.config.user,
      describeCause(cause, deps.config),
      { cause }
    )
  }
}

/**
 * Closes the session after a read. A close failure cannot lose a message that
 * has already been read, so it is reported rather than rethrown — but it is
 * never swallowed silently (EH-01). The log line carries host and user only.
 */
export async function closeMailbox(session: ImapSession, config: GmailImapConfig): Promise<void> {
  try {
    await session.close()
  } catch (cause) {
    console.error(
      `closeMailbox: IMAP logout from ${config.host} as ${config.user} failed`,
      { cause }
    )
  }
}

/**
 * Reports a run that hit the message-count cap (M-05).
 *
 * A `defer`, like the byte budget's: the remaining messages are fine and wait
 * for the next run. The UID it stopped at halts the watermark, so nothing is
 * lost.
 */
function reportMessageCapReached(uid: number, admittedCount: number): void {
  console.error(
    'collectUnprocessed: message-count cap reached, leaving the rest of the mailbox for the next run',
    { uid, admittedCount, limit: MAX_MESSAGES_PER_RUN }
  )
}

/**
 * Reports the rest of the mailbox being left for the next run.
 *
 * Not a silent drop, and not a refusal: nothing was staged, so the watermark
 * halts below this UID and the next invocation starts here with a full budget.
 * The loop stops rather than skipping ahead to smaller messages, so the
 * backlog drains in arrival order and a large purchase order cannot be starved
 * by a stream of small ones behind it.
 */
function reportBudgetReached(declared: DeclaredMessage, remainingBytes: number): void {
  console.error(
    'collectUnprocessed: invocation byte budget reached, leaving the rest of the mailbox for the next run',
    { uid: declared.uid, declaredSize: declared.declaredSize, remainingBytes }
  )
}

/**
 * Downloads and parses one admitted message, turning a parse failure into a
 * staged row rather than letting it end the run (H-02).
 *
 * The `catch` is scoped to this one message on purpose. A re-raise of
 * `ImapConnectionError` is deliberate and load-bearing: if the socket has
 * gone, that is not this message's fault, and swallowing it would stage every
 * remaining message in the listing as unparseable.
 */
async function readOne(
  declared: DeclaredMessage,
  session: ImapSession,
  parseRaw: (raw: Buffer, uid: number) => Promise<InboundMessage>
): Promise<InboundMessage> {
  try {
    const message = await parseRaw(await session.fetchSource(declared.uid), declared.uid)
    return { ...message, arrivedAt: declared.arrivedAt }
  } catch (cause) {
    if (cause instanceof ImapConnectionError) throw cause
    return unreadableMessage(declared, cause)
  }
}

/** Is this UID new to the pipeline? The whole admission rule (rule 1). */
function isAdmissible(uid: number, window: AdmissionWindow): boolean {
  return uid > window.watermark && !window.stagedUids.has(uid)
}

/**
 * Layer two: the parsed message's UID checked against the window again
 * (architecture rule 3). A single-layer guard is what let M-07 and M-08 ship.
 * A failure is a bug, not a property of the mail, so it is loud.
 */
function passesRecheck(
  message: InboundMessage,
  declared: DeclaredMessage,
  window: AdmissionWindow
): boolean {
  if (message.uid === declared.uid && isAdmissible(message.uid, window)) return true
  console.error('collectUnprocessed: post-parse UID re-check rejected a message; it halts the watermark', {
    listedUid: declared.uid,
    parsedUid: message.uid,
    watermark: window.watermark,
  })
  return false
}

function emptyCollection(): CollectedMail {
  return { messages: [], alreadyStagedUids: [], deferredUids: [], rejectedUids: [], arrivals: new Map() }
}

/**
 * Walks the listing above the watermark, applies the byte budget to each
 * declared size, and downloads only what it admits.
 *
 * A message is admitted iff its UID is above `window.watermark` and not in
 * `window.stagedUids` — decided from the listing, before any bytes move
 * (H-01), with no header taking part. A message that can never fit the budget
 * is returned carrying `rejection` so the pipeline stages it for review; one
 * that merely does not fit this run stops the loop and is reported deferred.
 * See `limits.ts` for why those are different outcomes.
 *
 * Throws `ImapConnectionError` on a lost connection. **A parse failure does
 * not abort the read** — that one message is staged as unparseable (H-02).
 *
 * @param session An open mailbox, from `openMailbox`.
 * @param window The watermark and the UIDs already staged above it.
 * @param deps The optional parser override.
 * @returns The messages to stage, and every other listed UID by outcome.
 * @throws {IngestConfigError} when the watermark is not a usable UID.
 */
export async function collectUnprocessed(
  session: ImapSession,
  window: AdmissionWindow,
  deps: Pick<GmailDeps, 'parseRaw'> = {}
): Promise<CollectedMail> {
  const sinceUid = window.watermark + 1
  assertUsableWatermark(sinceUid)
  const parseRaw = deps.parseRaw ?? parseMessage
  const result = emptyCollection()
  let bytesAdmitted = 0
  for await (const declared of session.listFrom(sinceUid)) {
    // `UID FETCH n:*` answers with the newest message even when n is above
    // every UID, so the server can list one the watermark already passed.
    if (declared.uid <= window.watermark) continue
    result.arrivals.set(declared.uid, declared.arrivedAt)
    if (!isAdmissible(declared.uid, window)) {
      result.alreadyStagedUids.push(declared.uid)
      continue
    }
    if (exceedsMessageCount(result.messages.length)) {
      reportMessageCapReached(declared.uid, result.messages.length)
      result.deferredUids.push(declared.uid)
      break
    }
    const admission = admitMessage(declared, bytesAdmitted)
    if (admission.verdict === 'defer') {
      reportBudgetReached(declared, admission.remainingBytes)
      result.deferredUids.push(declared.uid)
      break
    }
    if (admission.verdict === 'refuse') {
      result.messages.push(refusalFor(declared, admission.failure))
      continue
    }
    bytesAdmitted += declared.declaredSize
    const message = await readOne(declared, session, parseRaw)
    if (passesRecheck(message, declared, window)) result.messages.push(message)
    else result.rejectedUids.push(declared.uid)
  }
  return result
}
