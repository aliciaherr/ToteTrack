import { simpleParser, type Attachment, type ParsedMail } from 'mailparser'
import { MimeParseError } from '@/lib/errors'
import { boundHeader, canonicalMessageId, standInMessageId } from './identity'
import { refusedMessage, unparseableMessage } from './limits'
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
 * All three produce a stageable message with a usable identity, which is the
 * property H-02 was about: before this, route 3 threw out of the fetch loop
 * and discarded the whole batch, and route 2 could not stage a message that
 * carried no `Message-ID` at all. A message that cannot be staged cannot be
 * marked processed, so it returns on every run forever.
 *
 * Split out of `gmail.ts` to keep that file under the service-file cap
 * (CQ-02), the same way Task 97 split out `candidates.ts`. No database, no
 * storage, no socket — `parseMessage` takes bytes and the other two take a
 * listing entry, so all three are testable without a mailbox.
 */

function toInboundAttachment(attachment: Attachment): InboundAttachment {
  return {
    filename: attachment.filename ?? null,
    mimeType: attachment.contentType.toLowerCase(),
    bytes: attachment.content,
  }
}

/**
 * The identity for a parsed message: its own `Message-ID` where it has a
 * usable one, otherwise a stand-in derived from the mailbox UID.
 *
 * **A missing `Message-ID` used to throw, and that threw away the batch**
 * (H-02). Omitting the header is trivial from any MTA and routine in spam, so
 * one such email aborted the fetch, nothing was staged — including the
 * messages already parsed behind it — and because nothing was staged no
 * `message_id` was written, so every later run re-fetched it and died
 * identically. Ingestion stopped permanently and silently.
 *
 * A message with no header but a readable body and attachments is staged
 * **normally** under its stand-in identity: its purchase order is uploaded and
 * extractable, and the synthetic `message_id` is itself the visible record
 * that the identity was assigned (`identity.ts`). Only a message nothing could
 * be read from at all gets a `failures` entry, because only then is there
 * something a human has to go and look at.
 *
 * Still throws when there is no UID either — `parseMessage` is exported and
 * callable without one, and an identity cannot be invented from nothing.
 */
function identityOf(parsed: ParsedMail, uid: number | null): string {
  const messageId = parsed.messageId ? canonicalMessageId(parsed.messageId) : null
  if (messageId) return messageId
  if (uid === null) {
    throw new MimeParseError(
      'it carries no Message-ID header and no UID was supplied, so it has no identity to dedupe on or to mark processed',
      uid
    )
  }
  console.error(
    'parseMessage: message carries no Message-ID, staging it under a stand-in identity derived from its UID',
    { uid }
  )
  return standInMessageId(uid)
}

function toInboundMessage(parsed: ParsedMail, uid: number | null): InboundMessage {
  return {
    messageId: identityOf(parsed, uid),
    // Bounded at the boundary: both are sender-controlled (M-06).
    from: boundHeader(parsed.from?.text ?? null),
    subject: boundHeader(parsed.subject ?? null),
    receivedAt: parsed.date ?? null,
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

/**
 * The staging stand-in for a message refused on its declared size. Always
 * stageable now: where the envelope carried no `Message-ID`, the UID stand-in
 * supplies one, so a refused message can be marked processed instead of being
 * dropped with a log line and re-listed on every run (H-02).
 */
export function refusalFor(declared: DeclaredMessage, failure: IngestLimitFailure): InboundMessage {
  return refusedMessage(identityForDeclared(declared), declared, failure)
}

/**
 * The identity for a message known only from the listing: its envelope
 * `Message-ID`, or the same UID stand-in the parsed path uses.
 *
 * One rule for both paths. Before this, the refuse path could not stage a
 * message with no `Message-ID` at all and dropped it with a log line, while
 * the admit path threw and took the run down — two different answers to one
 * question, which is what H-02's point 3 called the tell.
 */
export function identityForDeclared(declared: DeclaredMessage): string {
  return declared.messageId ?? standInMessageId(declared.uid)
}

/**
 * The staging stand-in for a message whose MIME source could not be parsed.
 *
 * Nothing was recovered from it — no body, no attachment, no identity — so it
 * is staged under the UID stand-in with an `unparseable` entry, which puts it
 * at the top of the review queue. A genuinely malformed purchase order has to
 * be visible, not vanish into a log line, and the message must be marked
 * processed or it returns on every run forever (H-02).
 *
 * The cause is logged by UID only. `mailparser`'s message is **not** persisted
 * into the `failures` entry: it is an unbounded string derived from hostile
 * input and could quote a fragment of a real customer's email (L-12).
 */
export function unreadableMessage(declared: DeclaredMessage, cause: unknown): InboundMessage {
  console.error(
    'fetchUnprocessedMail: a message could not be parsed, staging it for review and continuing the batch',
    { uid: declared.uid, declaredSize: declared.declaredSize, cause }
  )
  return refusedMessage(identityForDeclared(declared), declared, unparseableMessage())
}
