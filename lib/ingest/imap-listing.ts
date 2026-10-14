import type { FetchMessageObject, MessageEnvelopeObject } from 'imapflow'
import { UidFetchError } from './imap-errors'
import { boundDate, boundHeader } from './message'
import type { DeclaredMessage, GmailImapConfig } from './types'

/**
 * One IMAP listing row as a `DeclaredMessage`: pure, no socket. Split out of
 * `imap-session.ts` to keep that file under the service-file cap (CQ-02);
 * `imap-session.ts` re-exports `toDeclaredMessage` for its existing callers.
 */

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
export function internalDate(value: Date | string | undefined): Date | null {
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
 * the message (SEC-05). It is a per-UID failure, not a connection one: the
 * listing goes on, and the UID is counted toward giving up (CONSTRAINT-37).
 *
 * Exported for its own unit test: the guard is the whole value of the byte
 * cap, and a fake `ImapSession` cannot exercise it.
 *
 * @param message One entry from the IMAP listing.
 * @param config The connection, named in a failure. Credentials are never read.
 * @throws {UidFetchError} when the size is not a usable byte count.
 */
export function toDeclaredMessage(
  message: FetchMessageObject,
  config: GmailImapConfig
): DeclaredMessage {
  if (!isUsableSize(message.size)) {
    throw new UidFetchError(
      message.uid,
      `listed on ${config.host} without a usable RFC822.SIZE, so the ingestion byte cap cannot be enforced on it`
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
