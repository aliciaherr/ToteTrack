import { ImapFlow } from 'imapflow'
import { simpleParser, type Attachment, type ParsedMail } from 'mailparser'
import { ImapConnectionError, IngestConfigError, MimeParseError } from '@/lib/errors'
import type {
  GmailDeps,
  GmailImapConfig,
  ImapSession,
  InboundAttachment,
  InboundMessage,
  RawImapMessage,
} from './types'

/**
 * Reads the ingestion mailbox over IMAP and returns parsed messages.
 *
 * This module performs **no database and no storage write** and imports
 * nothing from `@/db`. It takes the already-processed message ids as an
 * argument and hands back parsed messages; staging them is Task 97's job.
 * Keeping it pure is what lets its tests run with no database and no socket.
 *
 * Read state is never used. Selection is by UID watermark plus the supplied
 * processed-id set — the inbox is opened read-only and the `\Seen` flag is
 * neither read nor written, so opening the mailbox in Gmail cannot change
 * what ingestion sees.
 */

/** IMAPS. Fixed by the protocol, not a Feature 16 tunable, so not a constants-file entry. */
const IMAPS_PORT = 993

/** The lowest valid IMAP UID — i.e. "the whole mailbox". Also protocol-fixed. */
const FIRST_IMAP_UID = 1

/** Gmail's inbox path. The only mailbox ingestion reads. */
const INBOX_PATH = 'INBOX'

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
      'is missing or empty. Set it in .env.local and in the Vercel environment; .env.example lists the expected shape.'
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
 * Opens a real `imapflow` session against `config`, read-only.
 *
 * This is the production value for `GmailDeps.openSession`. It is exported
 * separately rather than defaulted inside `fetchUnprocessedMail`, so no test
 * can reach a live mailbox by forgetting to inject a fake.
 */
export async function createImapSession(config: GmailImapConfig): Promise<ImapSession> {
  const client = new ImapFlow({
    host: config.host,
    port: IMAPS_PORT,
    secure: true,
    auth: { user: config.user, pass: config.appPassword },
    // The client's own logger writes the IMAP conversation, LOGIN line
    // included, to stdout. Off, unconditionally (SEC-01).
    logger: false,
  })
  await client.connect()
  const lock = await client.getMailboxLock(INBOX_PATH, { readOnly: true })
  return {
    async *fetchFrom(sinceUid: number): AsyncIterable<RawImapMessage> {
      const range = { uid: `${sinceUid}:*` }
      for await (const message of client.fetch(range, { uid: true, source: true }, { uid: true })) {
        if (!message.source) {
          throw new ImapConnectionError(
            config.host,
            config.user,
            `UID ${message.uid} returned no source bytes`
          )
        }
        yield { uid: message.uid, source: message.source }
      }
    },
    async close(): Promise<void> {
      lock.release()
      await client.logout()
    },
  }
}

function toInboundAttachment(attachment: Attachment): InboundAttachment {
  return {
    filename: attachment.filename ?? null,
    mimeType: attachment.contentType.toLowerCase(),
    bytes: attachment.content,
  }
}

function toInboundMessage(parsed: ParsedMail, uid: number | null): InboundMessage {
  const messageId = parsed.messageId?.trim()
  if (!messageId) {
    throw new MimeParseError(
      'it carries no Message-ID header, so it has no identity to dedupe on or to mark processed',
      uid
    )
  }
  return {
    messageId,
    from: parsed.from?.text ?? null,
    subject: parsed.subject ?? null,
    receivedAt: parsed.date ?? null,
    bodyText: parsed.text ?? '',
    attachments: parsed.attachments.map(toInboundAttachment),
  }
}

/**
 * Parses one raw RFC822 message into an `InboundMessage`.
 *
 * Every attachment is returned as bytes with its MIME type, unfiltered —
 * deciding which are PO candidates is Task 97's job. Throws `MimeParseError`
 * when the source is unparseable or carries no `Message-ID`; the message is
 * never returned in a degraded form, because one with no id cannot be deduped
 * or marked processed.
 *
 * @param raw The full message source as fetched from IMAP.
 * @param uid The IMAP UID, named in a failure so the bad message is
 *            identifiable without logging any of its contents (SEC-05).
 */
export async function parseMessage(raw: Buffer, uid: number | null = null): Promise<InboundMessage> {
  let parsed: ParsedMail
  try {
    parsed = await simpleParser(raw)
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    throw new MimeParseError(reason, uid, { cause })
  }
  return toInboundMessage(parsed, uid)
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
 * Fetches every message at or above the UID watermark that is not already
 * known to have been processed.
 *
 * `processedIds` holds the caller's `inbound_emails.message_id` values — this
 * module reads no database, so the set is supplied rather than queried. The
 * watermark comes from `deps.sinceUid` and defaults to the whole mailbox;
 * advancing it between runs belongs to the trigger (Task 102).
 *
 * Throws `ImapConnectionError` on a connection or authentication failure, with
 * the host and username in the message and the app password scrubbed out of
 * it. Nothing is caught and ignored: a parse failure aborts the fetch, because
 * a message silently dropped here would never reach the review queue.
 */
export async function fetchUnprocessedMail(
  processedIds: Set<string>,
  deps: GmailDeps
): Promise<InboundMessage[]> {
  const parseRaw = deps.parseRaw ?? ((raw: Buffer) => parseMessage(raw))
  const sinceUid = deps.sinceUid ?? FIRST_IMAP_UID
  const session = await openSession(deps)
  const unprocessed: InboundMessage[] = []
  try {
    for await (const raw of session.fetchFrom(sinceUid)) {
      const message = await parseRaw(raw.source)
      if (!processedIds.has(message.messageId)) unprocessed.push(message)
    }
  } finally {
    await closeSession(session, deps.config)
  }
  return unprocessed
}
