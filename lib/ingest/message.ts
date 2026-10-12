import { simpleParser, type Attachment, type ParsedMail } from 'mailparser'
import { MimeParseError } from '@/lib/errors'
import { refusedMessage, unparseableMessage } from './limits'
import {
  HEADER_CONTROL_CHARACTERS,
  MAX_HEADER_BYTES,
  RECEIVED_AT_MAX_MS,
  RECEIVED_AT_MIN_MS,
} from './limits.constants'
import type { DeclaredMessage, IngestLimitFailure, InboundAttachment, InboundMessage } from './types'

/**
 * How an inbound message becomes an `InboundMessage`, by all three routes it
 * can take (Feature 16; H-02).
 *
 * 1. **Parsed** — its bytes were admitted, downloaded and read.
 * 2. **Refused** — the byte budget turned it away on its declared size, so
 *    nothing was downloaded.
 * 3. **Unreadable** — its bytes were downloaded but could not be parsed.
 *
 * All three carry the IMAP UID, which is the processed marker (CONSTRAINT-33),
 * so every one is stageable whatever its headers say. `Message-ID` is carried
 * as a bounded display label and nothing branches on it.
 *
 * Split out of `gmail.ts` to keep that file under the service-file cap
 * (CQ-02). No database, no storage, no socket — `parseMessage` takes bytes and
 * the other two take a listing entry, so all three are testable without a
 * mailbox.
 */

/**
 * One display header — `Message-ID`, `subject` or `from` — made storable:
 * control characters stripped, then bounded to `MAX_HEADER_BYTES`.
 *
 * Stripped first because Postgres cannot store U+0000, and a header that can
 * never be inserted pins the UID watermark forever (HIGH-02). Truncated
 * rather than digested, because these are labels nothing dedupes on: losing
 * the tail is harmless. Shortened by whole characters so a multi-byte
 * sequence is never split, which `Buffer.subarray` would do.
 *
 * @param raw The header as parsed, or `null` when absent.
 * @returns The storable value, or `null` unchanged.
 */
export function boundHeader(raw: string | null): string | null {
  if (raw === null) return null
  const value = raw.replace(HEADER_CONTROL_CHARACTERS, '')
  if (Buffer.byteLength(value, 'utf8') <= MAX_HEADER_BYTES) return value
  // Starting at MAX_HEADER_BYTES characters guarantees the character count is
  // already within the cap, so this only ever shrinks for multi-byte text.
  let bounded = value.slice(0, MAX_HEADER_BYTES)
  while (Buffer.byteLength(bounded, 'utf8') > MAX_HEADER_BYTES) {
    bounded = bounded.slice(0, -1)
  }
  return bounded
}

/**
 * A sender-written `Date:` as a storable value, or `null` when it is missing,
 * unparseable or outside the plausible window — a date Postgres would refuse
 * would otherwise fail the insert on every run (HIGH-02).
 *
 * @param date The header as parsed, or `null` when absent.
 */
export function boundDate(date: Date | null): Date | null {
  if (date === null) return null
  const time = date.getTime()
  if (Number.isNaN(time) || time < RECEIVED_AT_MIN_MS || time > RECEIVED_AT_MAX_MS) return null
  return date
}

function toInboundAttachment(attachment: Attachment): InboundAttachment {
  return {
    filename: attachment.filename ?? null,
    mimeType: attachment.contentType.toLowerCase(),
    bytes: attachment.content,
  }
}

function toInboundMessage(parsed: ParsedMail, uid: number): InboundMessage {
  return {
    uid,
    // Bounded at the boundary: all three are sender-controlled (M-06).
    messageId: boundHeader(parsed.messageId ?? null),
    from: boundHeader(parsed.from?.text ?? null),
    subject: boundHeader(parsed.subject ?? null),
    receivedAt: boundDate(parsed.date ?? null),
    // The source carries no INTERNALDATE; `gmail.ts` fills it from the listing.
    arrivedAt: null,
    bodyText: parsed.text ?? '',
    attachments: parsed.attachments.map(toInboundAttachment),
    // The normal path: this message's bytes were admitted and downloaded.
    rejection: null,
  }
}

/**
 * Parses one raw RFC822 message into an `InboundMessage`.
 *
 * Every attachment is returned as bytes with its MIME type, unfiltered —
 * deciding which are PO candidates is Task 97's job. A missing `Message-ID` is
 * not an error: the UID is the marker.
 *
 * @param raw The full message source as fetched from IMAP.
 * @param uid The IMAP UID, carried as the marker and named in a failure so
 *            the bad message is identifiable without logging its contents
 *            (SEC-05).
 * @throws {MimeParseError} when the source cannot be parsed.
 */
export async function parseMessage(raw: Buffer, uid: number): Promise<InboundMessage> {
  let parsed: ParsedMail
  try {
    parsed = await simpleParser(raw)
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    throw new MimeParseError(reason, uid, { cause })
  }
  return toInboundMessage(parsed, uid)
}

/** The staging stand-in for a message refused on its declared size. */
export function refusalFor(declared: DeclaredMessage, failure: IngestLimitFailure): InboundMessage {
  return refusedMessage(declared, failure)
}

/**
 * The staging stand-in for a message whose MIME source could not be parsed.
 *
 * Nothing was recovered from it, so it is staged with an `unparseable` entry,
 * which puts it at the top of the review queue: a genuinely malformed purchase
 * order has to be visible, not vanish into a log line (H-02).
 *
 * The cause is logged by UID only. `mailparser`'s message is **not** persisted
 * into the `failures` entry: it is an unbounded string derived from hostile
 * input and could quote a fragment of a real customer's email (L-12).
 */
export function unreadableMessage(declared: DeclaredMessage, cause: unknown): InboundMessage {
  console.error(
    'collectUnprocessed: a message could not be parsed, staging it for review and continuing the batch',
    { uid: declared.uid, declaredSize: declared.declaredSize, cause }
  )
  return refusedMessage(declared, unparseableMessage())
}
