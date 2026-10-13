import { ImapFlow, type FetchMessageObject, type MessageEnvelopeObject } from 'imapflow'
import { ImapConnectionError, IngestConfigError } from '@/lib/errors'
import { boundDate, boundHeader } from './message'
import type { DeclaredMessage, GmailImapConfig, ImapSession } from './types'

/**
 * The live `imapflow` adapter — the only module in `lib/ingest/` that opens a
 * socket.
 *
 * Split out of `gmail.ts` so that file stays under the service-file cap
 * (CQ-02) and so the one piece of this feature that cannot be exercised
 * without a real mailbox sits behind the narrow `ImapSession` contract rather
 * than being tangled with the parsing and budget logic that can. Everything
 * else in the pipeline talks to that interface, which is why the rest of the
 * suite needs no socket.
 *
 * **The two reads are deliberately separate.** `listFrom` asks for sizes and
 * envelopes only; `fetchSource` is the single call that transfers message
 * bytes. Keeping them apart is what lets the byte budget refuse a message
 * before it is downloaded (H-01) — merging them back into one `source: true`
 * fetch would restore the vulnerability in full.
 */

/** IMAPS. Fixed by the protocol, not a Feature 16 tunable, so not a constants-file entry. */
const IMAPS_PORT = 993

/**
 * Gmail's inbox path — the only mailbox ingestion reads, and the key its
 * watermark is stored under (`ingest_mailbox_state.mailbox`).
 */
export const INBOX_PATH = 'INBOX'

/**
 * The lowest valid IMAP UID — i.e. "the whole mailbox". Protocol-fixed, so it
 * lives here with the other protocol facts rather than in the tunables file,
 * and is exported so the reader's watermark default and this module's
 * validation cannot drift onto different numbers.
 */
export const FIRST_IMAP_UID = 1

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
  let uidValidity: number
  try {
    uidValidity = usableUidValidity(client.mailbox ? client.mailbox.uidValidity : undefined, config)
  } catch (cause) {
    lock.release()
    await client.logout()
    throw cause
  }
  return {
    uidValidity,
    async *listFrom(sinceUid: number): AsyncIterable<DeclaredMessage> {
      assertUsableWatermark(sinceUid)
      const range = { uid: `${sinceUid}:*` }
      // `size`, `envelope` and `internalDate`, and pointedly **not** `source`:
      // this listing is what the byte budget decides on, so it must cost no
      // attachment bytes. Adding `source` here would silently restore H-01
      // (`types.ts`). `internalDate` is the server's arrival time, which the
      // give-up placeholder carries (CONSTRAINT-37).
      const query = { uid: true, size: true, envelope: true, internalDate: true }
      // The listing is read to the end **before** anything is yielded.
      // imapflow runs one command at a time and parks its reader while a
      // `fetch()` consumer works on a row, so a `fetchSource` issued from
      // inside a live `fetch()` loop waits on a FETCH that waits on it: a
      // deadlock that hangs the run until the platform kills it. The listing
      // is sizes and envelopes only, so buffering it costs no message bytes.
      const listed: DeclaredMessage[] = []
      for await (const message of client.fetch(range, query, { uid: true })) {
        listed.push(toDeclaredMessage(message, config))
      }
      yield* listed
    },
    async fetchSource(uid: number): Promise<Buffer> {
      let message: FetchMessageObject | false | undefined
      try {
        message = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
      } catch (cause) {
        // A failed download is the connection's fault, never the message's:
        // `readOne` (gmail.ts) re-raises only `ImapConnectionError`, and would
        // otherwise stage this and every later message as unparseable. Class
        // name only — imapflow's message is not ours to vouch for (SEC-05).
        const reason = cause instanceof Error ? cause.name : typeof cause
        throw new ImapConnectionError(config.host, config.user, `UID ${uid} download failed (${reason})`, { cause })
      }
      if (!message || !message.source) {
        throw new ImapConnectionError(config.host, config.user, `UID ${uid} returned no source bytes`)
      }
      return message.source
    },
    async close(): Promise<void> {
      lock.release()
      await client.logout()
    },
  }
}

/**
 * Rejects a watermark that is not a usable IMAP UID, before it is interpolated
 * into the fetch range (L-14).
 *
 * The TypeScript type is `number`, and a type is not a runtime check: this
 * value is read back from `ingest_mailbox_state`, and whatever it is read from
 * is a place that could otherwise rewrite the IMAP command.
 *
 * Called both here, where the value is interpolated into the protocol string,
 * and in `gmail.ts` where it enters the pipeline — so every `ImapSession`
 * implementation is covered, not only the live one.
 *
 * @param sinceUid The watermark to read from.
 * @throws {IngestConfigError} when it is not a safe integer UID.
 */
export function assertUsableWatermark(sinceUid: number): void {
  if (Number.isSafeInteger(sinceUid) && sinceUid >= FIRST_IMAP_UID) return
  throw new IngestConfigError(
    'sinceUid',
    `is not a usable IMAP UID watermark. It must be a safe integer of at least ${FIRST_IMAP_UID}; it is interpolated into the IMAP fetch range, so it is validated rather than trusted (L-14).`
  )
}

/**
 * The open mailbox's UIDVALIDITY as a number. `imapflow` reports a `bigint`;
 * the value is unsigned 32-bit by RFC 3501, so it converts exactly. Anything
 * else means the watermark cannot be trusted, so it throws rather than guess.
 *
 * Exported for its own unit test, as `toDeclaredMessage` is: a fake
 * `ImapSession` cannot exercise it.
 *
 * @param value `client.mailbox.uidValidity`, or `undefined` if no mailbox is open.
 * @param config The connection, named in a failure. Credentials are never read.
 * @throws {ImapConnectionError} when it is absent or not a positive safe integer.
 */
export function usableUidValidity(value: bigint | undefined, config: GmailImapConfig): number {
  const asNumber = value === undefined ? Number.NaN : Number(value)
  if (Number.isSafeInteger(asNumber) && asNumber >= 1) return asNumber
  throw new ImapConnectionError(
    config.host,
    config.user,
    `${INBOX_PATH} opened without a usable UIDVALIDITY (${String(value)}), so the UID watermark cannot be applied`
  )
}

/** A declared size the byte budget can actually measure against. */
function isUsableSize(size: number | undefined): size is number {
  return Number.isSafeInteger(size) && (size as number) >= 0
}

/** The `From:` display text from an envelope, or `null`. */
function envelopeFrom(envelope: MessageEnvelopeObject | undefined): string | null {
  const sender = envelope?.from?.[0]
  if (!sender) return null
  if (!sender.name) return sender.address ?? null
  return sender.address ? `${sender.name} <${sender.address}>` : sender.name
}

/** The envelope `Date:` as a `Date`, or `null` when absent or unparseable. */
function envelopeDate(envelope: MessageEnvelopeObject | undefined): Date | null {
  const date = envelope?.date
  if (!date) return null
  return boundDate(date instanceof Date ? date : new Date(date))
}

/** IMAP `INTERNALDATE` as a `Date`, or `null` when absent or out of range. */
function internalDate(value: Date | string | undefined): Date | null {
  if (!value) return null
  return boundDate(value instanceof Date ? value : new Date(value))
}

/**
 * One listing entry as a `DeclaredMessage`.
 *
 * A listing with no usable `RFC822.SIZE` **throws** rather than defaulting the
 * size. Any default is wrong: a low one refuses legitimate mail, and a zero
 * one admits every message unconditionally, which is a security control
 * failing open and in silence. `Number.isSafeInteger` rather than `typeof`,
 * because `typeof NaN === 'number'` — and one `NaN` reaching the budget makes
 * `bytesAdmitted` `NaN`, after which every comparison is false and every
 * remaining message in the run is admitted (L-13). A negative size is worse
 * still: it credits the budget and raises the ceiling.
 *
 * Gmail always reports the size, so this is a loud assertion about the server
 * rather than an expected path, and it names the UID only — never any part of
 * the message (SEC-05).
 *
 * Exported for its own unit test: the guard is the whole value of the byte
 * cap, and a fake `ImapSession` cannot exercise it.
 *
 * @param message One entry from the IMAP listing.
 * @param config The connection, named in a failure. Credentials are never read.
 */
export function toDeclaredMessage(
  message: FetchMessageObject,
  config: GmailImapConfig
): DeclaredMessage {
  if (!isUsableSize(message.size)) {
    throw new ImapConnectionError(
      config.host,
      config.user,
      `UID ${message.uid} was listed without a usable RFC822.SIZE, so the ingestion byte cap cannot be enforced on it`
    )
  }
  return {
    uid: message.uid,
    declaredSize: message.size,
    // Bounded here, at the boundary, rather than where they are written: all
    // three are sender-controlled display text (M-06).
    messageId: boundHeader(message.envelope?.messageId ?? null),
    from: boundHeader(envelopeFrom(message.envelope)),
    subject: boundHeader(message.envelope?.subject ?? null),
    receivedAt: envelopeDate(message.envelope),
    arrivedAt: internalDate(message.internalDate),
  }
}
