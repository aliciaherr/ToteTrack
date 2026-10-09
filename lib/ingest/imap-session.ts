import { ImapFlow, type FetchMessageObject, type MessageEnvelopeObject } from 'imapflow'
import { ImapConnectionError, IngestConfigError } from '@/lib/errors'
import { boundHeader, canonicalMessageId } from './identity'
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

/** Gmail's inbox path. The only mailbox ingestion reads. */
const INBOX_PATH = 'INBOX'

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
  return {
    async *listFrom(sinceUid: number): AsyncIterable<DeclaredMessage> {
      assertUsableWatermark(sinceUid)
      const range = { uid: `${sinceUid}:*` }
      // `size` and `envelope`, and pointedly **not** `source`: this listing is
      // what the byte budget decides on, so it must cost no attachment bytes.
      // Adding `source` here would silently restore H-01 (`types.ts`).
      const query = { uid: true, size: true, envelope: true }
      for await (const message of client.fetch(range, query, { uid: true })) {
        yield toDeclaredMessage(message, config)
      }
    },
    async fetchSource(uid: number): Promise<Buffer> {
      const message = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
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
 * value crosses a real boundary the moment Task 102 starts reading it back
 * from persisted state, and whatever it is read from then becomes a place that
 * can rewrite the IMAP command. One assertion makes that boundary explicit for
 * whoever writes that task.
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
  const parsed = date instanceof Date ? date : new Date(date)
  return Number.isNaN(parsed.getTime()) ? null : parsed
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
  const envelopeMessageId = message.envelope?.messageId
  return {
    uid: message.uid,
    declaredSize: message.size,
    // Bounded here, at the boundary, rather than where they are written: these
    // three are sender-controlled and `message_id` is a unique index key with
    // a hard size limit (M-06).
    messageId: envelopeMessageId ? canonicalMessageId(envelopeMessageId) : null,
    from: boundHeader(envelopeFrom(message.envelope)),
    subject: boundHeader(message.envelope?.subject ?? null),
    receivedAt: envelopeDate(message.envelope),
  }
}
