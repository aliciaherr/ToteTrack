/**
 * Shared shapes for email PO ingestion (Feature 16).
 *
 * Deliberately free of every runtime import — no `imapflow`, no `mailparser`,
 * no `@/db`. The ingestion modules and their tests both depend on this file,
 * and keeping it import-free is what lets a test describe a mailbox without
 * opening a socket. Same split, and for the same reason, as
 * `db/queries/calendar.constants.ts`.
 */

/** Which of the three ingestion caps refused something (H-01). */
export type IngestLimitReason =
  /** The size IMAP declared for the whole message exceeds the batch ceiling. */
  | 'message_too_large'
  /** One decoded attachment exceeds `MAX_ATTACHMENT_BYTES`. */
  | 'attachment_too_large'
  /** The email carried more accepted attachments than `MAX_ATTACHMENTS_PER_EMAIL`. */
  | 'too_many_attachments'
  /**
   * The MIME source could not be parsed at all, so nothing was recovered from
   * it — not a body, not an attachment, not even an identity (H-02). The row
   * exists so a genuinely malformed purchase order is visible in the review
   * queue rather than vanishing into a log line.
   */
  | 'unparseable'
  /**
   * The IMAP listing reported no usable `RFC822.SIZE`, so the byte budget
   * could not measure the message. Fails closed: refused rather than admitted
   * (L-13), because a cap that guesses is not a cap.
   */
  | 'size_not_declared'

/**
 * One refusal, written verbatim as an entry in the `failures` array on
 * `inbound_pos.check_results` — the Task 95 contract that
 * `db/queries/inbound.ts` sorts the review queue on, so a refused row arrives
 * at the top of the queue rather than being dropped.
 *
 * **Every field here is safe to persist and to log.** There is deliberately no
 * filename, subject, sender or body content: those are production customer
 * data (CONSTRAINT-30, SEC-05), and `check_results` is read back by the review
 * UI. `part` is an index-derived identifier for the same reason — it says
 * *which* attachment without quoting anything the sender wrote.
 */
export interface IngestLimitFailure {
  /** Discriminator, so a later check suite can tell its entries from these. */
  check: 'ingest_limit'
  reason: IngestLimitReason
  /** `message`, or `attachment-<index>`. Never a filename (SEC-05). */
  part: string
  /**
   * What was measured — bytes, or a count of attachments. **Omitted when
   * nothing could be measured**, which is the honest shape for a refusal that
   * is not about exceeding a cap: an unparseable message has no size that
   * means anything, and a message whose size was never declared has no
   * measurement by definition. Forcing a number into those rows would put a
   * fabricated figure in front of a reviewer.
   */
  measured?: number
  /** The cap `measured` was compared against. Omitted when there was no cap. */
  limit?: number
  unit?: 'bytes' | 'attachments'
}

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
  /**
   * Set when the byte budget refused this message on its **declared** size,
   * before any of it was downloaded (H-01); `null` on the normal path.
   *
   * A refused message therefore carries no attachments and an empty body —
   * none of its bytes were ever read, which is the entire point of the cap.
   * The pipeline still stages it, so it reaches the review queue flagged
   * rather than vanishing.
   */
  rejection: IngestLimitFailure | null
}

/**
 * One message as the IMAP listing declares it, **before any of its bytes are
 * fetched**: the size and the envelope headers the server reports, and nothing
 * from the body.
 *
 * This is the shape the byte budget decides on. It exists so the size check
 * can happen before the download rather than after it — checking a decoded
 * attachment still protects storage, the database and the extraction spend,
 * but not memory, which is the failure that kills the function (H-01).
 */
export interface DeclaredMessage {
  /** The IMAP UID, used as the selection watermark and to fetch the source. */
  uid: number
  /**
   * `RFC822.SIZE` — the octets the server says the whole message occupies,
   * MIME overhead and transfer encoding included. It therefore runs well above
   * the decoded size of the documents inside, which is why it is measured
   * against the batch ceiling and not against the per-attachment cap.
   */
  declaredSize: number
  /**
   * The `Message-ID` from `ENVELOPE`, or `null` when the header is absent.
   * Lets an already-staged message be skipped, and a refused one be recorded,
   * without downloading it.
   */
  messageId: string | null
  /** The `From:` header as display text, or `null` when absent. */
  from: string | null
  subject: string | null
  /** The `Date:` header, or `null` when absent or unparseable. */
  receivedAt: Date | null
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

/**
 * The IMAP surface the reader actually uses — three methods, not the whole
 * `imapflow` client. Narrow on purpose: a fake in a test is three functions,
 * and nothing else in the module can reach the connection.
 *
 * **Listing and downloading are deliberately separate calls.** A single call
 * that handed back message bytes would make every cap in `limits.ts`
 * unenforceable, because the bytes would already be in memory by the time
 * their size was known (H-01). Anything that merges them back together
 * reintroduces the vulnerability.
 */
export interface ImapSession {
  /**
   * Declared metadata for every message with UID >= `sinceUid`, ascending,
   * and **none of their bytes**. Selection is by UID only; the `\Seen` flag is
   * never read or written, so opening the inbox in Gmail cannot change what
   * ingestion sees.
   */
  listFrom(sinceUid: number): AsyncIterable<DeclaredMessage>
  /**
   * The full RFC822 source of one message. Called only for a message the byte
   * budget has already admitted — this is the only call that transfers
   * attachment bytes, so it is the one the caps exist to gate.
   */
  fetchSource(uid: number): Promise<Buffer>
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
  /**
   * MIME parser. Defaults to `parseMessage`; overridden only in tests.
   *
   * **The UID is part of the contract, not an extra.** Without it the parser
   * cannot mint a stand-in identity for a message that carries no
   * `Message-ID`, so such a message is staged as unparseable and its
   * attachments are discarded — the stranding H-02's fix exists to prevent
   * (M-07). The production default is passed the UID for exactly this reason.
   */
  parseRaw?: (raw: Buffer, uid: number) => Promise<InboundMessage>
  /**
   * Lowest UID to consider. Defaults to the first valid IMAP UID, i.e. the
   * whole mailbox. Advancing this watermark across runs is `runIngestion`'s job
   * (Task 99) — this module holds no state and reads no database.
   */
  sinceUid?: number
}
