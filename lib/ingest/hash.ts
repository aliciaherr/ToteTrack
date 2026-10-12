import { createHash } from 'node:crypto'
import { ContentHashError } from '@/lib/errors'
import {
  CONTENT_HASH_ALGORITHM,
  CONTENT_HASH_DIGEST_ENCODING,
  QUOTE_MARKER_PATTERN,
  RELAY_NOISE_LINE_PATTERNS,
  SIGNATURE_DELIMITER_PATTERN,
} from './ingest.constants'
import type { IngestLimitFailure } from './types'

/**
 * Content hashing for the ingestion dedupe layer (Feature 16, Task 97).
 *
 * The UID marker (`inbound_emails (uid_validity, uid)`, CONSTRAINT-33) stops
 * one message being staged twice, and the save-time PO-number check is the
 * backstop. This layer sits between them — it catches the same document
 * arriving as two different messages, which is what a forwarded or re-sent
 * purchase order looks like, and the re-ingest after a UIDVALIDITY change.
 *
 * A hash match is a **flag, not a rejection**: the caller still stages the
 * row and sets `duplicate_of_id`, so a human decides (plan, Task 97). That
 * asymmetry is why this module errs towards under-stripping — a missed
 * duplicate reaches the review queue, while a false match would mislabel a
 * genuinely new PO as a copy of an unrelated one.
 *
 * No database, no storage, no mailbox: pure functions over bytes and text, so
 * the tests need none of the three.
 */

/**
 * SHA-256 of the given bytes or text, hex encoded.
 *
 * Empty input **throws** rather than returning the digest of nothing. Every
 * empty candidate hashes identically, so the first would be staged and all
 * later ones flagged as duplicates of a document that has no content —
 * dedupe would go quiet instead of loud. A caller with nothing to hash has no
 * PO candidate and must classify the email `no_po_found` instead.
 *
 * @param input Document bytes, or the already-normalised body text.
 * @returns The lowercase hex digest.
 * @throws {ContentHashError} when the buffer is zero length, or the string is
 *   empty once trimmed (whitespace alone is no more content than '').
 */
export function contentHash(input: Buffer | string): string {
  assertHashable(input)
  return createHash(CONTENT_HASH_ALGORITHM).update(input).digest(CONTENT_HASH_DIGEST_ENCODING)
}

function assertHashable(input: Buffer | string): void {
  if (typeof input === 'string') {
    if (input.trim().length > 0) return
    throw new ContentHashError(
      'string',
      'the text is blank, so every blank candidate would share one hash and be flagged as a duplicate of the first. Classify the email no_po_found instead.'
    )
  }
  if (input.length > 0) return
  throw new ContentHashError(
    'buffer',
    'the attachment carried no bytes, so there is no document to stage or extract from.'
  )
}

/**
 * Reduces an email body to the part a forward does not rewrite, so that two
 * forwards of one purchase order hash equal.
 *
 * Quote markers (`>`, nested or not) are stripped from the front of each
 * line rather than used to discard it: in a forwarded email the purchase
 * order *is* the quoted block, so dropping those lines would throw the PO
 * away. Dropped outright, per `RELAY_NOISE_LINE_PATTERNS`: forward and reply
 * separators, Gmail's "On … wrote:" attribution, Outlook's underscore rule,
 * and the re-emitted `From:`/`Sent:`/`To:`/`Date:`/`Subject:` header block.
 * Everything from a `--` signature delimiter onwards is dropped too. What
 * survives is whitespace-collapsed, because clients re-wrap lines and
 * re-indent at will.
 *
 * That set and no more. Each entry is text a mail client *adds* or rewords
 * when relaying a message, which is exactly the noise that makes the same PO
 * hash differently twice. Anything the sender typed is kept, because this
 * module cannot tell an irrelevant sentence from the PO number.
 *
 * Case is preserved: no client changes it, so lowercasing would only widen
 * the chance of two different POs colliding on one hash.
 *
 * This is the weakest dedupe layer by design (plan, Task 97) — some forwards
 * will still reach the queue as new candidates. Accepted: nothing
 * auto-approves.
 *
 * @param body The plain-text body, as `InboundMessage.bodyText` carries it.
 * @returns The normalised text, or `''` when nothing survived — which the
 *   caller must treat as "no body candidate", not hash.
 */
export function normalizeBodyForHash(body: string): string {
  const kept: string[] = []
  for (const line of body.split(/\r?\n/)) {
    const unquoted = line.replace(QUOTE_MARKER_PATTERN, '')
    if (SIGNATURE_DELIMITER_PATTERN.test(unquoted)) break
    if (isRelayNoise(unquoted)) continue
    kept.push(unquoted)
  }
  return collapseWhitespace(kept.join(' '))
}

function isRelayNoise(line: string): boolean {
  return RELAY_NOISE_LINE_PATTERNS.some((pattern) => pattern.test(line))
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * The `content_hash` for a row that records a refusal.
 *
 * **A surrogate over the mailbox position, not over content, and it has to
 * be.** `content_hash` is `NOT NULL`, and the point of a refusal is that the
 * bytes were never read — there is nothing to hash. Do not "fix" this into a
 * hash of the absent bytes: `contentHash` refuses empty input because every
 * empty candidate would share one digest and be flagged a duplicate of the
 * first unrelated one.
 *
 * Built from the server-assigned marker, the part and the measurement, so it
 * is **stable** across re-runs and cannot be steered by any header a sender
 * writes. Two sends of one oversized document get different surrogates —
 * honest, since a hash that never saw the content cannot recognise it.
 *
 * @param uidValidity The mailbox UIDVALIDITY the message belongs to.
 * @param uid The refused message's IMAP UID.
 * @param failure The refusal this row records.
 */
export function refusalHash(uidValidity: number, uid: number, failure: IngestLimitFailure): string {
  // `unmeasured` stands in where nothing could be measured, so the string is
  // never built out of `undefined` and stays stable for those refusals too.
  const measure =
    failure.unit === undefined ? 'unmeasured' : `${failure.unit}:${failure.measured}`
  return contentHash(
    `ingest-limit:${failure.reason}|mailbox:${uidValidity}/${uid}|part:${failure.part}|${measure}`
  )
}
