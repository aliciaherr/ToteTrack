import type { InboundPoSourceKind } from '@/db/queries/inbound-pos'
import { normalizeBodyForHash } from './hash'
import { ACCEPTED_MIME_TYPES, PO_DOCUMENT_EXTENSIONS, PO_DOCUMENT_FALLBACK_EXTENSION, PO_DOCUMENT_PATH_PREFIX } from './ingest.constants'
import { MAX_ATTACHMENTS_PER_EMAIL } from './limits.constants'
import {
  attachmentTooLarge,
  exceedsAttachmentCap,
  exceedsAttachmentCount,
  tooManyAttachments,
} from './limits'
import type { IngestLimitFailure, InboundAttachment, InboundMessage } from './types'

/**
 * Decides what in an email is a PO candidate, and where its document belongs
 * in storage (Feature 16, Task 97).
 *
 * Split out of `pipeline.ts` to keep that file under the service-file cap
 * (CQ-01). Pure functions over a parsed message: no database, no storage, no
 * mailbox, and `pipeline.ts` holds all the writing.
 *
 * The choice is **structural only** — an accepted attachment means "probably
 * a PO" and body text cannot be judged without the model, so Task 98 may
 * retroactively set `no_po_found`.
 */

/** Trailing marker of a wildcard entry in `ACCEPTED_MIME_TYPES`, e.g. `image/*`. */
const MIME_WILDCARD_SUFFIX = '/*'

/** `document_path` is NULL for exactly this source kind — there is no file. */
const BODY_SOURCE_KIND: InboundPoSourceKind = 'email_body'

/** The one content type that is a document rather than an image. */
const PDF_MIME_TYPE = 'application/pdf'

/** What one message yields: the candidates to stage, and what was refused. */
export interface CandidateSelection {
  candidates: PoCandidate[]
  /**
   * Per-attachment and per-count refusals (H-01). Each becomes its own
   * `inbound_pos` row carrying a `failures` entry, so nothing is dropped in
   * silence and a refusal reaches the top of the review queue.
   */
  rejections: IngestLimitFailure[]
}

/** An attachment or body chosen as a PO candidate, before it is hashed. */
export interface PoCandidate {
  sourceKind: InboundPoSourceKind
  /** Attachment bytes, or `null` for a body candidate. */
  bytes: Buffer | null
  /** The attachment's content type, or `null` for a body candidate. */
  mimeType: string | null
  /** Exactly what gets hashed: raw bytes, or the normalised body text. */
  hashInput: Buffer | string
}

function matchesAcceptedType(mimeType: string): boolean {
  return ACCEPTED_MIME_TYPES.some((pattern) => {
    if (!pattern.endsWith(MIME_WILDCARD_SUFFIX)) return mimeType === pattern
    const family = pattern.slice(0, -MIME_WILDCARD_SUFFIX.length)
    return mimeType.startsWith(`${family}/`)
  })
}

function sourceKindOf(mimeType: string): InboundPoSourceKind {
  return mimeType === PDF_MIME_TYPE ? 'pdf' : 'image'
}

/**
 * An accepted attachment with no bytes is dropped here rather than hashed —
 * `contentHash` refuses empty input, and one empty part must not fail the
 * whole email. Reported loudly, by index and content type: the sender's
 * filename can carry PO data, so it is not logged (SEC-05).
 */
function reportEmptyAttachment(index: number, mimeType: string, uid: number): void {
  console.error('selectCandidates: dropping an accepted attachment that carried no bytes', {
    uid,
    attachmentIndex: index,
    mimeType,
  })
}

/**
 * The accepted attachments worth hashing: the right content type, non-empty,
 * and within `MAX_ATTACHMENT_BYTES`.
 *
 * An oversized one is **refused, not dropped** — it is appended to
 * `rejections` so the caller stages a row for it, and the rest of the email
 * carries on. One hostile or mis-sent attachment must not discard a valid
 * purchase order attached to the same message (H-01).
 *
 * Indexes are the attachment's original position, so the `part` identifier on
 * a refusal still points at the right one after the filtering.
 */
function usableAttachments(
  message: InboundMessage,
  rejections: IngestLimitFailure[]
): InboundAttachment[] {
  const usable: InboundAttachment[] = []
  for (const [index, attachment] of message.attachments.entries()) {
    if (!matchesAcceptedType(attachment.mimeType)) continue
    if (attachment.bytes.length === 0) {
      reportEmptyAttachment(index, attachment.mimeType, message.uid)
      continue
    }
    if (exceedsAttachmentCap(attachment.bytes.length)) {
      rejections.push(attachmentTooLarge(index, attachment.bytes.length))
      continue
    }
    usable.push(attachment)
  }
  return usable
}

/**
 * Truncates to `MAX_ATTACHMENTS_PER_EMAIL`, recording one refusal naming the
 * full count. Truncated rather than rejected whole, so a message carrying both
 * genuine POs and padding still yields the genuine ones.
 */
function withinCountCap(
  usable: InboundAttachment[],
  rejections: IngestLimitFailure[]
): InboundAttachment[] {
  if (!exceedsAttachmentCount(usable.length)) return usable
  rejections.push(tooManyAttachments(usable.length))
  return usable.slice(0, MAX_ATTACHMENTS_PER_EMAIL)
}

function attachmentCandidate(attachment: InboundAttachment): PoCandidate {
  return {
    sourceKind: sourceKindOf(attachment.mimeType),
    bytes: attachment.bytes,
    mimeType: attachment.mimeType,
    hashInput: attachment.bytes,
  }
}

/**
 * The PO candidates in one message: every accepted attachment, or — when
 * there are none — the normalised body text. One email therefore yields
 * 0..n candidates.
 *
 * @param message A parsed message from `fetchUnprocessedMail`.
 * @returns The candidates in attachment order, plus any attachment or count
 *   refusals. No candidates *and* no rejections is the `no_po_found` case, and
 *   the caller still writes the email row for it.
 */
export function selectCandidates(message: InboundMessage): CandidateSelection {
  const rejections: IngestLimitFailure[] = []
  const attachments = withinCountCap(usableAttachments(message, rejections), rejections)
  if (attachments.length > 0) {
    return { candidates: attachments.map(attachmentCandidate), rejections }
  }
  const body = normalizeBodyForHash(message.bodyText)
  if (!body) return { candidates: [], rejections }
  return {
    candidates: [{ sourceKind: BODY_SOURCE_KIND, bytes: null, mimeType: null, hashInput: body }],
    rejections,
  }
}

/**
 * The storage key for a document: its content hash plus the extension its
 * content type implies, under one prefix inside `PO_DOCUMENTS_BUCKET`.
 *
 * Content-addressed on purpose — the same document uploaded twice lands on
 * one object, so a repeated batch creates no duplicate storage object. The
 * sender's filename is never used: it is untrusted input that could carry a
 * path (`types.ts`).
 *
 * @param hash The candidate's hex content hash.
 * @param mimeType The attachment's content type, which picks the extension.
 */
export function documentPathFor(hash: string, mimeType: string): string {
  const extension = PO_DOCUMENT_EXTENSIONS[mimeType] ?? PO_DOCUMENT_FALLBACK_EXTENSION
  return `${PO_DOCUMENT_PATH_PREFIX}/${hash}${extension}`
}
