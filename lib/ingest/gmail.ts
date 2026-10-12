import { ImapConnectionError, IngestConfigError } from '@/lib/errors'
import { assertUsableWatermark, FIRST_IMAP_UID } from './imap-session'
import { admitMessage, exceedsMessageCount } from './limits'
import { MAX_MESSAGES_PER_RUN } from './limits.constants'
import { identityForDeclared, parseMessage, refusalFor, unreadableMessage } from './message'
import type {
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
 * nothing from `@/db`. It takes the already-processed message ids as an
 * argument and hands back parsed messages; staging them is Task 97's job.
 * Keeping it pure is what lets its tests run with no database and no socket —
 * the live connection lives behind `ImapSession`, in `imap-session.ts`.
 *
 * Read state is never used. Selection is by UID watermark plus the supplied
 * processed-id set — the inbox is opened read-only and the `\Seen` flag is
 * neither read nor written, so opening the mailbox in Gmail cannot change
 * what ingestion sees.
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

async function openSession(deps: GmailDeps): Promise<ImapSession> {
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
async function closeSession(session: ImapSession, config: GmailImapConfig): Promise<void> {
  try {
    await session.close()
  } catch (cause) {
    console.error(
      `fetchUnprocessedMail: IMAP logout from ${config.host} as ${config.user} failed after a successful read`,
      { cause }
    )
  }
}

/**
 * Reports a run that hit the message-count cap (M-05).
 *
 * A `defer`, like the byte budget's: the remaining messages are perfectly fine
 * and simply wait for the next run. Nothing is staged and nothing is marked
 * processed, so nothing is lost.
 */
function reportMessageCapReached(admittedCount: number): void {
  console.error(
    'fetchUnprocessedMail: message-count cap reached, leaving the rest of the mailbox for the next run',
    { admittedCount, limit: MAX_MESSAGES_PER_RUN }
  )
}

/**
 * Reports the rest of the mailbox being left for the next run.
 *
 * Not a silent drop, and not a refusal: nothing was staged and no
 * `message_id` was written, so the message is still in the mailbox and the
 * next invocation starts with a full budget and picks it up. The loop stops
 * here rather than skipping ahead to smaller messages, so the backlog drains
 * in arrival order and a large purchase order cannot be starved by a stream of
 * small ones behind it.
 */
function reportBudgetReached(declared: DeclaredMessage, remainingBytes: number): void {
  console.error(
    'fetchUnprocessedMail: invocation byte budget reached, leaving the rest of the mailbox for the next run',
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
 * remaining message in the listing as unparseable — filling the review queue
 * with false rows and marking real purchase orders processed without ever
 * having read them.
 */
async function readOne(
  declared: DeclaredMessage,
  session: ImapSession,
  parseRaw: (raw: Buffer, uid: number) => Promise<InboundMessage>
): Promise<InboundMessage> {
  try {
    return await parseRaw(await session.fetchSource(declared.uid), declared.uid)
  } catch (cause) {
    if (cause instanceof ImapConnectionError) throw cause
    return unreadableMessage(declared, cause)
  }
}

/**
 * Walks the listing, applies the byte budget to each declared size, and
 * downloads only what it admits. Separated from the session lifecycle so the
 * close in `fetchUnprocessedMail`'s `finally` covers every exit from this loop.
 *
 * The post-parse `processedIds` re-check the original loop had is gone: the
 * pre-filter above now covers it, and in the one case the two could disagree —
 * an envelope with no `Message-ID` whose MIME body has one — the unique
 * `message_id` index is the real guard and `insertEmail` already reports that
 * as `{ duplicate: true }` rather than failing.
 */
async function collectUnprocessed(
  session: ImapSession,
  processedIds: Set<string>,
  deps: GmailDeps
): Promise<InboundMessage[]> {
  const parseRaw = deps.parseRaw ?? parseMessage
  const collected: InboundMessage[] = []
  let bytesAdmitted = 0
  const sinceUid = deps.sinceUid ?? FIRST_IMAP_UID
  assertUsableWatermark(sinceUid)
  for await (const declared of session.listFrom(sinceUid)) {
    if (exceedsMessageCount(collected.length)) {
      reportMessageCapReached(collected.length)
      break
    }
    // Skipped from the listing, before any download — unlike the original
    // version of this loop, where the same filter ran after a full fetch and
    // parse and so saved nothing. The stand-in identity is matched here too,
    // so a message staged under one is not re-staged next run.
    if (processedIds.has(identityForDeclared(declared))) continue
    const admission = admitMessage(declared, bytesAdmitted)
    if (admission.verdict === 'defer') {
      reportBudgetReached(declared, admission.remainingBytes)
      break
    }
    if (admission.verdict === 'refuse') {
      collected.push(refusalFor(declared, admission.failure))
      continue
    }
    bytesAdmitted += declared.declaredSize
    collected.push(await readOne(declared, session, parseRaw))
  }
  return collected
}

/**
 * Fetches every message at or above the UID watermark that is not already
 * known to have been processed, and that the invocation's byte budget admits.
 *
 * `processedIds` holds the caller's `inbound_emails.message_id` values — this
 * module reads no database, so the set is supplied rather than queried. The
 * watermark comes from `deps.sinceUid` and defaults to the whole mailbox;
 * advancing it between runs belongs to `runIngestion` (Task 99).
 *
 * **The byte budget is the memory half of H-01.** Each message is admitted or
 * refused on the size IMAP declares for it, before `fetchSource` transfers
 * anything, so an oversized message costs no memory at all. A message that
 * can never fit is returned carrying `rejection` so the pipeline stages it for
 * review; one that merely does not fit this run stops the loop and stays in
 * the mailbox. See `limits.ts` for why those are different outcomes.
 *
 * Throws `ImapConnectionError` on a connection or authentication failure, with
 * the host and username in the message and the app password scrubbed out of
 * it. **A parse failure does not abort the fetch** — it costs that one message,
 * which is staged for review under a stand-in identity so it is neither lost
 * nor re-fetched forever (H-02). Nothing is caught and ignored.
 *
 * @param processedIds `message_id` values already staged, skipped from the
 *   listing without being downloaded.
 * @param deps The IMAP config, session factory and optional parser override.
 * @returns The messages to stage, refused ones included.
 */
export async function fetchUnprocessedMail(
  processedIds: Set<string>,
  deps: GmailDeps
): Promise<InboundMessage[]> {
  const session = await openSession(deps)
  try {
    return await collectUnprocessed(session, processedIds, deps)
  } finally {
    await closeSession(session, deps.config)
  }
}
