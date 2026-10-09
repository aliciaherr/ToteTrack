import { contentHash } from './hash'
import { MAX_HEADER_BYTES } from './limits.constants'
import type { IngestLimitFailure } from './types'

/**
 * How an inbound message is identified, and how sender-controlled header
 * strings are bounded before they reach the database (H-02 / M-06).
 *
 * `inbound_emails.message_id` is `NOT NULL UNIQUE` and is doing two jobs: it
 * is the dedupe key *and* the processed marker that replaces the IMAP `\Seen`
 * flag (Task 95). A message with no usable identity therefore cannot be
 * staged, cannot be marked handled, and — before this module existed — took
 * the whole run down with it and came back on every subsequent run forever.
 *
 * **Every identity this module mints is deterministic.** That is the property
 * the whole thing turns on: a message re-listed on the next run must derive
 * the same identity, or it is staged again as a brand new row every fifteen
 * minutes.
 *
 * **And every identity this module mints is visibly synthetic.** A real
 * `Message-ID` is `<id-left@id-right>` (RFC 5322) — angle brackets, with an
 * `@` inside. Both prefixes below use a `scheme:` form with no angle brackets
 * and no `@`, so nothing downstream can mistake one for a header the sender
 * actually sent, and an operator reading the review queue can see at a glance
 * that the identity was assigned rather than received.
 *
 * Pure string functions: no database, no mailbox, no storage.
 */

/**
 * Prefix for an identity derived from the mailbox UID, used when a message
 * carries no `Message-ID` of its own.
 *
 * The UID is the right basis: IMAP UIDs are stable for the lifetime of a
 * mailbox, so the same message derives the same identity on every run, which
 * is what lets it be marked processed and skipped thereafter.
 */
const STANDIN_IDENTITY_PREFIX = 'ingest-uid:'

/**
 * Prefix for an identity that replaces an over-long `Message-ID` with a
 * bounded digest of it.
 */
const BOUNDED_IDENTITY_PREFIX = 'ingest-longid:'

/**
 * Prefix for an identity that replaces a sender-supplied `Message-ID` which
 * tried to claim one of the prefixes above (M-08).
 */
const CLAIMED_IDENTITY_PREFIX = 'ingest-claimed:'

/**
 * Every prefix this module reserves. A `Message-ID` arriving from a sender
 * may not be stored under any of them — see `canonicalMessageId`.
 */
const RESERVED_PREFIXES = [
  STANDIN_IDENTITY_PREFIX,
  BOUNDED_IDENTITY_PREFIX,
  CLAIMED_IDENTITY_PREFIX,
] as const

/**
 * The identity for a message that carries no usable `Message-ID`.
 *
 * Deterministic in the UID, so the next run derives the same value and the
 * message is recognised as already staged rather than inserted again.
 *
 * **Known limitation, for whoever writes Task 102:** IMAP UIDs are unique
 * within a mailbox *for a given `UIDVALIDITY`*. If the mailbox is recreated,
 * UIDVALIDITY changes and UIDs restart, so a new message could derive an
 * identity already in the table and be skipped as a duplicate. Task 102 owns
 * the watermark and should fold `UIDVALIDITY` into the persisted state; until
 * a watermark exists at all this cannot be addressed here.
 *
 * @param uid The message's IMAP UID.
 * @returns A visibly synthetic, deterministic identity.
 */
export function standInMessageId(uid: number): string {
  return `${STANDIN_IDENTITY_PREFIX}${uid}`
}

/**
 * The `Message-ID` bounded to `MAX_HEADER_BYTES`, as a digest when the real
 * one is too long for the unique index.
 *
 * **A digest, deliberately not a truncation.** Truncating would map every
 * over-long `Message-ID` sharing a prefix onto one identity, so two unrelated
 * messages would collide and the second would be silently skipped as a
 * duplicate of the first — a false dedupe key is worse than the problem it
 * solves. A digest of the whole value is bounded, collision-free in practice,
 * and still **faithful**: the same over-long header always derives the same
 * identity, so genuine dedupe keeps working and the message stays ingestible
 * instead of failing its insert forever (M-06).
 *
 * **Canonicalised first, and that is not cosmetic (H-03).** The same header
 * reaches this code in two different spellings: `imapflow` yields ENVELOPE
 * field 9 exactly as the sender wrote it, while `mailparser` *adds* the angle
 * brackets RFC 5322 delimits a `msg-id` with, so `Message-ID: bare-id` arrives
 * as `bare-id` from the listing and `<bare-id>` from the parse. The listing
 * form keys the already-processed pre-filter and the parsed form is what gets
 * stored, so without one canonical form a bare, unbracketed `Message-ID`
 * never matches itself: it is re-downloaded on **every run, forever**, and 200
 * of them fill `MAX_MESSAGES_PER_RUN` on every run so legitimate mail behind
 * them is never reached. The unique index stops the duplicate row; it does not
 * stop the re-download.
 *
 * **The canonical form is the bare `addr-spec`, brackets stripped.** RFC 5322
 * defines `msg-id = "<" id-left "@" id-right ">"`, so the brackets are
 * delimiters of the field, not part of the identifier — stripping them
 * normalises away a difference that is purely about how the header was
 * serialised, and leaves the identity itself. Stripping is also the direction
 * that needs no knowledge of what the other layer did, where adding brackets
 * would have to reason about values that already carry them. What it does and
 * does not normalise is spelled out on `stripDelimiters`.
 *
 * @param messageId The `Message-ID` as the sender sent it.
 * @returns The canonical identity, or `null` when nothing usable remains —
 *   which the caller must treat as "no `Message-ID`" and replace with a
 *   stand-in, exactly as an absent header.
 */
export function canonicalMessageId(messageId: string): string | null {
  const canonical = stripDelimiters(messageId)
  if (!canonical) return null
  // A sender may not store a value under a prefix this module assigns, so a
  // claim on one is digested rather than kept (M-08). Checked on the canonical
  // form, so bracketing cannot be used to slip past it.
  if (claimsReservedPrefix(canonical)) {
    return `${CLAIMED_IDENTITY_PREFIX}${contentHash(canonical)}`
  }
  if (Buffer.byteLength(canonical, 'utf8') <= MAX_HEADER_BYTES) return canonical
  return `${BOUNDED_IDENTITY_PREFIX}${contentHash(canonical)}`
}

/**
 * Trims, then removes a leading `<` and a trailing `>` **independently**.
 *
 * Independently, not as a matched pair, because an unbalanced delimiter is the
 * one spelling the two layers still disagreed on: `mailparser` balances
 * `Message-ID: <a@b` into `<a@b>`, so a pair-only strip left the pre-filter
 * keyed on `<a@b` and the stored row on `a@b` — H-03's exact mechanism, in the
 * two spellings an earlier version of this comment wrongly called impossible.
 *
 * It strips at most one delimiter from each end and does **not** normalise
 * arbitrarily nested ones: `<<a@b>>` becomes `<a@b>`. That is sufficient, and
 * the reason is worth stating precisely — the property relied on is not that
 * this reaches a fixed point, but that **both layers apply this identical
 * transform to their own input**, so they agree on a single key.
 */
function stripDelimiters(messageId: string): string {
  let canonical = messageId.trim()
  if (canonical.startsWith('<')) canonical = canonical.slice(1)
  if (canonical.endsWith('>')) canonical = canonical.slice(0, -1)
  return canonical.trim()
}

/**
 * Does a sender-supplied value claim an identity form this module assigns?
 *
 * Built from the same list `isSyntheticMessageId` reads, so the gate and the
 * predicate cannot drift onto different prefixes.
 */
function claimsReservedPrefix(messageId: string): boolean {
  return RESERVED_PREFIXES.some((prefix) => messageId.startsWith(prefix))
}

/**
 * Was this identity assigned by `lib/ingest/` rather than sent by the sender?
 *
 * Exposed so a reviewer-facing surface can label such a row, and so a test can
 * assert the reserved prefixes are distinguishable from a real header rather
 * than taking it on trust.
 *
 * Reads the same `RESERVED_PREFIXES` list the gate in `canonicalMessageId`
 * uses, so a row this returns `true` for is exactly a row this module minted —
 * a sender cannot produce one.
 *
 * @param messageId A value from `inbound_emails.message_id`.
 */
export function isSyntheticMessageId(messageId: string): boolean {
  return claimsReservedPrefix(messageId)
}

/**
 * One display header — `subject` or `from` — bounded to `MAX_HEADER_BYTES`.
 *
 * Truncated rather than digested, which is the opposite of the `Message-ID`
 * rule and for the opposite reason: these are display values that nothing
 * dedupes on, so losing the tail is harmless, while a digest would destroy the
 * only thing they are good for. Shortened by whole characters so a multi-byte
 * sequence is never split, which `Buffer.subarray` would do.
 *
 * @param value The header as parsed, or `null` when absent.
 * @returns The value within the byte cap, or `null` unchanged.
 */
export function boundHeader(value: string | null): string | null {
  if (value === null || Buffer.byteLength(value, 'utf8') <= MAX_HEADER_BYTES) return value
  // Starting at MAX_HEADER_BYTES characters guarantees the character count is
  // already within the cap, so this only ever shrinks for multi-byte text.
  let bounded = value.slice(0, MAX_HEADER_BYTES)
  while (Buffer.byteLength(bounded, 'utf8') > MAX_HEADER_BYTES) {
    bounded = bounded.slice(0, -1)
  }
  return bounded
}

/**
 * The `content_hash` for a row that records a refusal.
 *
 * **This is a surrogate over identity, not over content, and it has to be.**
 * `content_hash` is `NOT NULL`, and the whole point of a refusal is that the
 * bytes were never read — so there is nothing to hash. Do not "fix" this into
 * a hash of the absent bytes: `contentHash` refuses empty input precisely
 * because every empty candidate would otherwise share one digest and each
 * refusal would be flagged a duplicate of the first unrelated one.
 *
 * Built from the message id, the part identifier and the measured size, so it
 * is **stable**: re-fetching the same message produces the same surrogate and
 * a re-run stays idempotent. It is correspondingly *not* a content match — two
 * separate sends of one oversized document carry different `Message-ID`s and
 * so get different surrogates, which is the honest outcome, since a hash over
 * identity cannot recognise content it never saw.
 *
 * @param messageId The refused message's identity, synthetic or not.
 * @param failure The refusal this row records.
 */
export function surrogateContentHash(messageId: string, failure: IngestLimitFailure): string {
  // `unmeasured` stands in where nothing could be measured, so the string is
  // never built out of `undefined` and stays stable for those refusals too.
  const measure =
    failure.unit === undefined ? 'unmeasured' : `${failure.unit}:${failure.measured}`
  return contentHash(
    `ingest-limit:${failure.reason}|message:${messageId}|part:${failure.part}|${measure}`
  )
}
