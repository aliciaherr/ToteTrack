import type { InboundPoSourceKind } from '@/db/queries/inbound-pos'
import { normalizeBodyForHash } from './hash'
import {
  ACCEPTED_MIME_TYPES,
  PO_DOCUMENT_EXTENSIONS,
  PO_DOCUMENT_PATH_PREFIX,
  type AcceptedMimeType,
} from './ingest.constants'
import {
  MAX_ATTACHMENTS_PER_EMAIL,
  MAX_RECORDED_MIME_TYPE_LENGTH,
  RECORDABLE_MIME_TYPE_PATTERN,
} from './limits.constants'
import {
  attachmentPart,
  attachmentTooLarge,
  exceedsAttachmentCap,
  exceedsAttachmentCount,
  tooManyAttachments,
  WHOLE_MESSAGE_PART,
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
 *
 * **Nothing is dropped (CONSTRAINT-34).** Every attachment ends as a candidate
 * or a refusal, and a message with neither yields one `no_po_found` refusal,
 * so every message reaches the review queue in some form.
 */

/**
 * Unregistered alias some mail clients send for JPEG. Normalised before
 * matching so a real photo of a PO is not refused over a spelling.
 */
const JPEG_ALIAS = 'image/jpg'

/** `document_path` is NULL for exactly this source kind — there is no file. */
const BODY_SOURCE_KIND: InboundPoSourceKind = 'email_body'

/** The one content type that is a document rather than an image. */
const PDF_MIME_TYPE = 'application/pdf'

/** What one message yields: the candidates to stage, and what was refused. */
export interface CandidateSelection {
  candidates: PoCandidate[]
  /**
   * Every part that did not become a candidate, and why (H-01,
   * CONSTRAINT-34). Each becomes its own `inbound_pos` row carrying a
   * `failures` entry, so nothing is dropped in silence and a refusal reaches
   * the top of the review queue.
   */
  rejections: IngestLimitFailure[]
}

/** An attachment or body chosen as a PO candidate, before it is hashed. */
export interface PoCandidate {
  sourceKind: InboundPoSourceKind
  /** Attachment bytes, or `null` for a body candidate. */
  bytes: Buffer | null
  /** The attachment's content type, or `null` for a body candidate. */
  mimeType: AcceptedMimeType | null
  /** Exactly what gets hashed: raw bytes, or the normalised body text. */
  hashInput: Buffer | string
}

/** An attachment whose type is accepted, carried with the normalised type. */
interface UsableAttachment {
  mimeType: AcceptedMimeType
  bytes: Buffer
}

function isAcceptedMimeType(mimeType: string): mimeType is AcceptedMimeType {
  return (ACCEPTED_MIME_TYPES as readonly string[]).includes(mimeType)
}

/** The parser's type, lowercased and with the `image/jpg` alias folded in. */
function normalisedMimeType(mimeType: string): string {
  const lowered = mimeType.trim().toLowerCase()
  return lowered === JPEG_ALIAS ? 'image/jpeg' : lowered
}

/**
 * The sender's content type in a form safe to persist and show a reviewer, or
 * `undefined` when it is not a plain bounded `type/subtype`. Sender-controlled,
 * so it is checked rather than trusted (SEC-02).
 *
 * @param mimeType The attachment's content type as the parser reported it.
 */
export function recordableMimeType(mimeType: string): string | undefined {
  const bare = normalisedMimeType(mimeType.split(';')[0] ?? '')
  if (bare.length > MAX_RECORDED_MIME_TYPE_LENGTH) return undefined
  return RECORDABLE_MIME_TYPE_PATTERN.test(bare) ? bare : undefined
}

/** A part-level refusal that names the attachment's type, when it has a safe one. */
function partRefusal(
  reason: 'unsupported_format' | 'empty_attachment',
  index: number,
  mimeType: string
): IngestLimitFailure {
  const recorded = recordableMimeType(mimeType)
  const failure: IngestLimitFailure = { check: 'ingest_limit', reason, part: attachmentPart(index) }
  return recorded === undefined ? failure : { ...failure, mimeType: recorded }
}

/** The one refusal for a message that carried nothing to read (CONSTRAINT-34). */
export function noPoFound(): IngestLimitFailure {
  return { check: 'ingest_limit', reason: 'no_po_found', part: WHOLE_MESSAGE_PART }
}

function sourceKindOf(mimeType: AcceptedMimeType): InboundPoSourceKind {
  return mimeType === PDF_MIME_TYPE ? 'pdf' : 'image'
}

/**
 * One attachment as a usable candidate or as its refusal — never neither.
 * Type first, so an empty SVG reads as the format problem a vendor can fix.
 */
function triageAttachment(
  index: number,
  attachment: InboundAttachment
): { usable: UsableAttachment } | { refusal: IngestLimitFailure } {
  const mimeType = normalisedMimeType(attachment.mimeType)
  if (!isAcceptedMimeType(mimeType)) {
    return { refusal: partRefusal('unsupported_format', index, attachment.mimeType) }
  }
  if (attachment.bytes.length === 0) {
    return { refusal: partRefusal('empty_attachment', index, attachment.mimeType) }
  }
  if (exceedsAttachmentCap(attachment.bytes.length)) {
    return { refusal: attachmentTooLarge(index, attachment.bytes.length) }
  }
  return { usable: { mimeType, bytes: attachment.bytes } }
}

/**
 * The accepted attachments worth hashing: an accepted type, non-empty, and
 * within `MAX_ATTACHMENT_BYTES`. Every other attachment is **refused, not
 * dropped** — appended to `rejections` so the caller stages a row for it, and
 * the rest of the email carries on (H-01, CONSTRAINT-34).
 *
 * Indexes are the attachment's original position, so the `part` identifier on
 * a refusal still points at the right one after the filtering.
 */
function usableAttachments(
  message: InboundMessage,
  rejections: IngestLimitFailure[]
): UsableAttachment[] {
  const usable: UsableAttachment[] = []
  for (const [index, attachment] of message.attachments.entries()) {
    const outcome = triageAttachment(index, attachment)
    if ('refusal' in outcome) rejections.push(outcome.refusal)
    else usable.push(outcome.usable)
  }
  return usable
}

/**
 * Truncates to `MAX_ATTACHMENTS_PER_EMAIL`, recording one refusal naming the
 * full count. Truncated rather than rejected whole, so a message carrying both
 * genuine POs and padding still yields the genuine ones.
 */
function withinCountCap(
  usable: UsableAttachment[],
  rejections: IngestLimitFailure[]
): UsableAttachment[] {
  if (!exceedsAttachmentCount(usable.length)) return usable
  rejections.push(tooManyAttachments(usable.length))
  return usable.slice(0, MAX_ATTACHMENTS_PER_EMAIL)
}

function attachmentCandidate(attachment: UsableAttachment): PoCandidate {
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
 * @returns The candidates in attachment order, plus every refusal. A message
 *   with no candidate and no other refusal returns exactly one `no_po_found`
 *   refusal, so the caller always has at least one row to write.
 */
export function selectCandidates(message: InboundMessage): CandidateSelection {
  const rejections: IngestLimitFailure[] = []
  const attachments = withinCountCap(usableAttachments(message, rejections), rejections)
  if (attachments.length > 0) {
    return { candidates: attachments.map(attachmentCandidate), rejections }
  }
  const body = normalizeBodyForHash(message.bodyText)
  if (body) {
    return {
      candidates: [{ sourceKind: BODY_SOURCE_KIND, bytes: null, mimeType: null, hashInput: body }],
      rejections,
    }
  }
  return { candidates: [], rejections: rejections.length > 0 ? rejections : [noPoFound()] }
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
 * @param mimeType The attachment's accepted content type, which picks the extension.
 */
export function documentPathFor(hash: string, mimeType: AcceptedMimeType): string {
  return `${PO_DOCUMENT_PATH_PREFIX}/${hash}${PO_DOCUMENT_EXTENSIONS[mimeType]}`
}
