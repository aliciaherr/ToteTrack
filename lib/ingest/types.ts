/**
 * Shared shapes for email PO ingestion (Feature 16).
 *
 * Deliberately free of every runtime import — no `imapflow`, no `mailparser`,
 * no `@/db`. The ingestion modules and their tests both depend on this file,
 * and keeping it import-free is what lets a test describe a mailbox without
 * opening a socket. Same split, and for the same reason, as
 * `db/queries/calendar.constants.ts`.
 */

/** One file carried by an inbound email, already decoded to bytes. */
export interface InboundAttachment {
  /**
   * The sender's filename, or `null` when the MIME part carried none.
   * Never trusted as a path — Task 97 derives the storage key itself.
   */
  filename: string | null
  /** The part's `Content-Type`, e.g. `application/pdf`. Lowercase, no parameters. */
  mimeType: string
  bytes: Buffer
}

/**
 * One parsed inbound email. This is the whole contract between the IMAP reader
 * and the ingestion pipeline: `fetchUnprocessedMail` produces these and
 * `ingestMessages` (Task 97) consumes them, so neither half needs a mailbox or
 * a database to be tested.
 */
export interface InboundMessage {
  /**
   * The `Message-ID` header, angle brackets included. Required, not optional:
   * it is both dedupe layer 1 and the processed marker that replaces the IMAP
   * `\Seen` flag (Task 95), so a message without one cannot be staged at all.
   */
  messageId: string
  /** The `From:` header as display text, or `null` when absent. */
  from: string | null
  subject: string | null
  /** The `Date:` header, or `null` when absent or unparseable. */
  receivedAt: Date | null
  /** The plain-text body, or `''` when the message carried no text part. */
  bodyText: string
  /** Every attachment, unfiltered — Task 97 decides which are PO candidates. */
  attachments: InboundAttachment[]
}

/**
 * IMAP credentials, resolved from the environment by `readGmailImapConfig`.
 * Passed in rather than read inside the fetch so that no test can reach the
 * real mailbox by forgetting to stub something (SEC-01).
 */
export interface GmailImapConfig {
  host: string
  user: string
  /**
   * The Gmail app password. Never logged, never put in an error message, and
   * never written to a committed file — `.env.example` carries a placeholder
   * only. Requires 2FA plus IMAP enabled on the account (A-09).
   */
  appPassword: string
}

/** One message as IMAP hands it over, before MIME parsing. */
export interface RawImapMessage {
  /** The IMAP UID, used as the selection watermark. */
  uid: number
  /** The full RFC822 source. */
  source: Buffer
}

/**
 * The IMAP surface the reader actually uses — two methods, not the whole
 * `imapflow` client. Narrow on purpose: a fake in a test is two functions, and
 * nothing else in the module can reach the connection.
 */
export interface ImapSession {
  /**
   * Raw messages with UID >= `sinceUid`, ascending. Selection is by UID only;
   * the `\Seen` flag is never read or written, so opening the inbox in Gmail
   * cannot change what ingestion sees.
   */
  fetchFrom(sinceUid: number): AsyncIterable<RawImapMessage>
  /** Releases the mailbox lock and logs out. Called even when the read throws. */
  close(): Promise<void>
}

/**
 * Injected collaborators for `fetchUnprocessedMail`.
 *
 * `config` and `openSession` are both required with no defaults, which is the
 * point: there is no code path that silently falls back to a live connection.
 * Production callers pass `readGmailImapConfig()` and `createImapSession`.
 */
export interface GmailDeps {
  config: GmailImapConfig
  openSession: (config: GmailImapConfig) => Promise<ImapSession>
  /** MIME parser. Defaults to `parseMessage`; overridden only in tests. */
  parseRaw?: (raw: Buffer) => Promise<InboundMessage>
  /**
   * Lowest UID to consider. Defaults to the first valid IMAP UID, i.e. the
   * whole mailbox. Advancing this watermark across runs is the trigger's job
   * (Task 102) — this module holds no state and reads no database.
   */
  sinceUid?: number
}
