import { createHash } from 'node:crypto'
import { ContentHashError } from '@/lib/errors'
import {
  CONTENT_HASH_ALGORITHM,
  CONTENT_HASH_DIGEST_ENCODING,
  QUOTE_MARKER_PATTERN,
  RELAY_NOISE_LINE_PATTERNS,
  SIGNATURE_DELIMITER_PATTERN,
} from './ingest.constants'

/**
 * Content hashing for the ingestion dedupe layer (Feature 16, Task 97).
 *
 * Two layers sit above this one: `inbound_emails.message_id` is unique, and
 * the save-time PO-number check is the backstop. This layer is the middle
 * one — it catches the same document arriving twice under different message
 * ids, which is what a forwarded or re-sent purchase order looks like.
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
