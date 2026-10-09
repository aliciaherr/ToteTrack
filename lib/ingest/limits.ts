import type {
  InboundPoSourceKind,
  InboundPoStatus,
  InsertInboundPoInput,
} from '@/db/queries/inbound'
import { MAX_ATTACHMENTS_PER_EMAIL, MAX_ATTACHMENT_BYTES, MAX_MESSAGES_PER_RUN, MAX_TOTAL_INGEST_BYTES } from './limits.constants'
import type { DeclaredMessage, IngestLimitFailure, IngestLimitReason, InboundMessage } from './types'

/**
 * The three ingestion caps, and how a refusal is recorded (H-01 / SEC-02).
 *
 * The ingestion mailbox is the application's only unauthenticated inbound
 * content path: anyone who learns the address can write to this pipeline with
 * no credential, no session and no rate limit in front of them. Without a cap,
 * one stranger's email exhausts the function's memory, and a repeat kills
 * ingestion permanently (CWE-770, CWE-400).
 *
 * **The order of the two layers is the whole design.**
 *
 * 1. `MAX_TOTAL_INGEST_BYTES` is checked against the size IMAP *declares*,
 *    before a message is downloaded. This is the layer that protects memory,
 *    because it is the only one that can refuse bytes without holding them.
 * 2. `MAX_ATTACHMENT_BYTES` and `MAX_ATTACHMENTS_PER_EMAIL` are checked after
 *    parsing, inside a message layer 1 has already bounded. They protect
 *    storage, the database row count and (from Task 98) the metered extraction
 *    spend — all of which survive a restart, unlike memory.
 *
 * Nothing here is fatal to an email and nothing is dropped in silence: every
 * refusal becomes an `inbound_pos` row carrying a `failures` entry, which is
 * what sorts it to the top of the review queue. Split out of `gmail.ts` to
 * keep that file under the service-file cap (CQ-02), the same way Task 97
 * split out `candidates.ts`. Pure functions over declared sizes and counts: no
 * database, no storage, no mailbox.
 */

/** `part` for a refusal about a whole message rather than one attachment. */
const WHOLE_MESSAGE_PART = 'message'

/**
 * `source_kind` on every row that records a refusal.
 *
 * `email_body` rather than `image` or `pdf`, and not a lie: the Task 95
 * invariant is that `document_path` is NULL *exactly* when `source_kind` is
 * `email_body` (`db/migrations/0016_inbound_email_ingestion.sql:36`), a
 * refused candidate has no stored document by definition, and `email_body` is
 * the one enum value that means "no file". Which attachment was refused, and
 * why, lives in the `failures` entry instead — where the review queue reads
 * it. Widening the enum would need a migration, and the point of recording a
 * refusal this way is that the existing schema already carries it.
 */
export const REFUSED_SOURCE_KIND: InboundPoSourceKind = 'email_body'

/** What the byte budget decided about one message, before downloading it. */
export type MessageAdmission =
  /** Fetch it. Its declared size fits the bytes left in this invocation. */
  | { verdict: 'admit' }
  /**
   * Never fetch it: it exceeds the whole-invocation ceiling on its own, so no
   * future run would admit it either. Staged with `failure` for review.
   */
  | { verdict: 'refuse'; failure: IngestLimitFailure }
  /**
   * Not this run. It would fit an empty budget but not the bytes left, so it
   * is left in the mailbox and drains on the next run. **Deliberately not
   * staged:** writing an `inbound_pos` row would also write the unique
   * `message_id`, which would mark a perfectly good purchase order processed
   * and refused forever on the strength of when it happened to arrive.
   */
  | { verdict: 'defer'; remainingBytes: number }

function limitFailure(
  reason: IngestLimitReason,
  part: string,
  measured: number,
  limit: number,
  unit: IngestLimitFailure['unit']
): IngestLimitFailure {
  return { check: 'ingest_limit', reason, part, measured, limit, unit }
}

/** The `part` identifier for attachment `index`. An index, never a filename (SEC-05). */
export function attachmentPart(index: number): string {
  return `attachment-${index}`
}

/**
 * Decides whether to download one message, from the size IMAP declared for it
 * and the bytes this invocation has already taken on.
 *
 * Measured against `MAX_TOTAL_INGEST_BYTES` rather than
 * `MAX_ATTACHMENT_BYTES`, because a declared size covers headers, MIME
 * overhead and base64 inflation — a legitimate 15MB document arrives as
 * roughly 20MB of RFC822, so checking it against the per-attachment cap would
 * refuse exactly the documents the cap was chosen to accept.
 *
 * @param declared The message as the IMAP listing reports it, with no bytes.
 * @param bytesAdmitted Declared bytes already admitted in this invocation.
 * @returns The verdict — see `MessageAdmission` for why `refuse` and `defer`
 *   are different outcomes rather than one.
 */
export function admitMessage(declared: DeclaredMessage, bytesAdmitted: number): MessageAdmission {
  // Fails closed on a size that is not a usable number (L-13). Every
  // comparison against NaN is false, so without this the verdict would be
  // `admit` and `bytesAdmitted += NaN` would then make the budget NaN —
  // admitting every remaining message in the run unconditionally. A negative
  // size is worse still: it *credits* the budget and raises the ceiling.
  if (!Number.isSafeInteger(declared.declaredSize) || declared.declaredSize < 0) {
    return { verdict: 'refuse', failure: sizeNotDeclared() }
  }
  if (declared.declaredSize > MAX_TOTAL_INGEST_BYTES) {
    return {
      verdict: 'refuse',
      failure: limitFailure(
        'message_too_large',
        WHOLE_MESSAGE_PART,
        declared.declaredSize,
        MAX_TOTAL_INGEST_BYTES,
        'bytes'
      ),
    }
  }
  const remainingBytes = MAX_TOTAL_INGEST_BYTES - bytesAdmitted
  if (declared.declaredSize > remainingBytes) return { verdict: 'defer', remainingBytes }
  return { verdict: 'admit' }
}

/**
 * Records a message the byte budget could not measure (L-13).
 *
 * No `measured`: the value the server sent was not a finite number, so there
 * is nothing truthful to put there. The `limit` is kept, because the cap that
 * could not be applied is still what a reviewer needs to understand the row.
 */
function sizeNotDeclared(): IngestLimitFailure {
  return {
    check: 'ingest_limit',
    reason: 'size_not_declared',
    part: WHOLE_MESSAGE_PART,
    limit: MAX_TOTAL_INGEST_BYTES,
    unit: 'bytes',
  }
}

/**
 * Records a message whose MIME source could not be parsed (H-02).
 *
 * No measurement and no cap — nothing was exceeded, the bytes simply could not
 * be read. The mailbox UID is not repeated here either: it is already in the
 * row's stand-in `message_id` (`identity.ts`), which is where a human looking
 * at the queue will find it.
 */
export function unparseableMessage(): IngestLimitFailure {
  return { check: 'ingest_limit', reason: 'unparseable', part: WHOLE_MESSAGE_PART }
}

/** Has this invocation already admitted as many messages as it may? */
export function exceedsMessageCount(admittedCount: number): boolean {
  return admittedCount >= MAX_MESSAGES_PER_RUN
}

/** Is this decoded attachment over the per-attachment cap? */
export function exceedsAttachmentCap(byteLength: number): boolean {
  return byteLength > MAX_ATTACHMENT_BYTES
}

/** Records one attachment refused for its decoded size. */
export function attachmentTooLarge(index: number, byteLength: number): IngestLimitFailure {
  return limitFailure(
    'attachment_too_large',
    attachmentPart(index),
    byteLength,
    MAX_ATTACHMENT_BYTES,
    'bytes'
  )
}

/** Is this email carrying more accepted attachments than the per-email cap? */
export function exceedsAttachmentCount(acceptedCount: number): boolean {
  return acceptedCount > MAX_ATTACHMENTS_PER_EMAIL
}

/**
 * Records an email truncated to the per-email attachment cap. One entry for
 * the message, not one per discarded part: the count is what a human acts on.
 */
export function tooManyAttachments(acceptedCount: number): IngestLimitFailure {
  return limitFailure(
    'too_many_attachments',
    WHOLE_MESSAGE_PART,
    acceptedCount,
    MAX_ATTACHMENTS_PER_EMAIL,
    'attachments'
  )
}

/**
 * The `check_results` value for a row that records a refusal: one entry in the
 * `failures` array, which is the Task 95 contract the review queue sorts on
 * (`db/queries/inbound.ts`), so the row arrives at the top rather than being
 * dropped.
 *
 * @param failure The refusal to record.
 */
export function checkResultsFor(failure: IngestLimitFailure): { failures: IngestLimitFailure[] } {
  return { failures: [failure] }
}

/**
 * The `InboundMessage` standing in for a message refused on its declared size.
 *
 * Carries the envelope headers the listing already reported and **no content**
 * — no attachments and an empty body — because none of its bytes were
 * downloaded. The pipeline recognises it by `rejection` and stages it for
 * review.
 *
 * @param messageId The refused message's `Message-ID`, which the caller has
 *   already confirmed is present — a message with none cannot be staged.
 * @param declared The message as the IMAP listing reported it.
 * @param failure The refusal to record against it.
 */
export function refusedMessage(
  messageId: string,
  declared: DeclaredMessage,
  failure: IngestLimitFailure
): InboundMessage {
  return {
    messageId,
    from: declared.from,
    subject: declared.subject,
    receivedAt: declared.receivedAt,
    bodyText: '',
    attachments: [],
    rejection: failure,
  }
}

/**
 * Status for a row that records a refusal: `pending_review`, not the
 * `pending_extraction` column default.
 *
 * A refused candidate has no stored document, so extraction can never advance
 * it. Left at the default it would wait forever on a worker that finds nothing
 * and would never appear in the queue it exists to appear in — its `failures`
 * entry only sorts it to the top of a list it is already on
 * (`db/queries/inbound.ts`). This is the one row this pipeline sets a status
 * on, and it skips extraction because there is nothing to extract.
 */
const REFUSED_STATUS: InboundPoStatus = 'pending_review'

/**
 * `InsertInboundPoInput` plus the two columns a refused row needs.
 *
 * Declared here rather than in `db/queries/inbound.ts` because the staging
 * shape is this module's concern and that file sits at its line cap. Both
 * columns already exist on the table (`db/schema/inbound.ts`), so recording a
 * refusal needs **no migration and no schema change** — which is the point of
 * the surrogate hash and the `failures` entry. `insertInboundPo` remains
 * usable as the injected implementation: a function accepting the narrower
 * input satisfies this wider parameter.
 */
export type StagedPoInput = InsertInboundPoInput & {
  /**
   * Omitted on the normal path, so `status` and `attempt_count` keep their
   * column defaults and the starting state has one definition.
   */
  status?: InboundPoStatus
  /** The `failures` array the review queue sorts on. Refused rows only. */
  check_results?: { failures: IngestLimitFailure[] }
}

/**
 * The extra columns a refused row carries, and nothing at all for a real
 * candidate — spread in, so a genuine PO's insert is the same object Task 97
 * wrote and its `status` keeps the column default.
 */
export function refusalColumns(failure: IngestLimitFailure | null): Partial<StagedPoInput> {
  if (!failure) return {}
  return { status: REFUSED_STATUS, check_results: checkResultsFor(failure) }
}

/**
 * Hashes and uploads every candidate before the email row is written, so the
 * stored classification already reflects whether the documents made it into
 * the bucket. On a failure the email is classified `failed` and no candidate
 * is staged — the Task 95 data layer has no classification update, so the
 * value has to be right the first time it is written.
 */
