import type { ReviewSourceRow } from '@/db/queries/review-source'
import { MAX_ATTACHMENTS_PER_EMAIL, MAX_ATTACHMENT_BYTES } from '@/lib/ingest/limits.constants'
import type { IngestLimitFailure, IngestLimitReason } from '@/lib/ingest/types'
import { ReviewSourceShapeError, UnknownRefusalReasonError } from './errors'

/**
 * What the review overlay shows on its left pane (Task 106), worked out from
 * one PO row. Pure: no database, no storage. Signing file URLs is the
 * action's job (`lib/actions/review.ts`).
 */

/** A refusal in plain language, for the reason card. */
export interface RefusalDescription {
  title: string
  nextStep: string
  /** The refused file's type, e.g. `application/zip`; shown as plain text only (LOW-NEW-2). */
  fileType: string | null
}

/** The email a refused row came from. Every field is optional on a placeholder row. */
export interface ReviewEmail {
  from: string | null
  subject: string | null
  /** ISO timestamp. */
  receivedAt: string | null
  /** A Gmail search for this message, or `null` without a Message-ID. */
  gmailUrl: string | null
}

export type ReviewSource =
  | { kind: 'pdf' | 'image'; url: string }
  | { kind: 'text'; text: string }
  | { kind: 'refused'; refusal: RefusalDescription; email: ReviewEmail }

const BYTES_PER_MEGABYTE = 1024 * 1024
const MAX_ATTACHMENT_MEGABYTES = Math.round(MAX_ATTACHMENT_BYTES / BYTES_PER_MEGABYTE)
const OPEN_IN_GMAIL = 'Open it in Gmail to see the PO.'

/** Title and next step for every `IngestLimitReason`. A `Record`, so a new reason fails the type check. */
const REFUSAL_WORDING: Record<IngestLimitReason, Pick<RefusalDescription, 'title' | 'nextStep'>> = {
  message_too_large: { title: 'Email too large to import', nextStep: OPEN_IN_GMAIL },
  attachment_too_large: {
    title: `Attachment over ${MAX_ATTACHMENT_MEGABYTES} MB`,
    nextStep: 'Ask the sender for a smaller file, or open it in Gmail.',
  },
  too_many_attachments: {
    title: `More than ${MAX_ATTACHMENTS_PER_EMAIL} attachments`,
    nextStep: `Only the first ${MAX_ATTACHMENTS_PER_EMAIL} were imported. Open it in Gmail to check the rest.`,
  },
  unparseable: { title: "Email couldn't be read", nextStep: OPEN_IN_GMAIL },
  size_not_declared: {
    title: 'Email size unknown',
    nextStep: "It wasn't downloaded, to be safe. Open it in Gmail to see the PO.",
  },
  unsupported_format: { title: 'File type not supported', nextStep: 'Ask the sender to re-send it as a PDF or JPG.' },
  empty_attachment: { title: 'Attachment was empty', nextStep: 'Ask the sender to re-send the file.' },
  no_po_found: {
    title: 'No PO found in this email',
    nextStep: "Open it in Gmail to check. If it isn't a PO, it can be discarded.",
  },
  staging_failed: { title: "Couldn't be imported", nextStep: 'Open it in Gmail to recover the PO.' },
}

function isIngestLimitFailure(value: unknown): value is IngestLimitFailure {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as { check?: unknown; reason?: unknown }
  return entry.check === 'ingest_limit' && typeof entry.reason === 'string'
}

/**
 * The row's ingestion refusal, if it has one.
 *
 * @param checkResults `inbound_pos.check_results`, any shape.
 * @returns The first `ingest_limit` entry in `failures`, or `null`.
 */
export function refusalOf(checkResults: unknown): IngestLimitFailure | null {
  if (typeof checkResults !== 'object' || checkResults === null) return null
  const failures = (checkResults as { failures?: unknown }).failures
  if (!Array.isArray(failures)) return null
  return failures.find(isIngestLimitFailure) ?? null
}

/**
 * A refusal in plain language.
 *
 * @throws {UnknownRefusalReasonError} for a reason with no wording.
 */
export function describeRefusal(failure: IngestLimitFailure): RefusalDescription {
  const wording = Object.hasOwn(REFUSAL_WORDING, failure.reason) ? REFUSAL_WORDING[failure.reason] : undefined
  if (!wording) throw new UnknownRefusalReasonError(failure.reason)
  return { ...wording, fileType: failure.mimeType ?? null }
}

/**
 * A Gmail search that finds one message by its Message-ID.
 *
 * @returns The URL, or `null` without an id.
 */
export function gmailSearchUrl(messageId: string | null): string | null {
  if (!messageId) return null
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`rfc822msgid:${messageId}`)}`
}

/**
 * The source of a row with no stored file: its email text, or its refusal.
 *
 * @throws {ReviewSourceShapeError} when the row has neither.
 * @throws {UnknownRefusalReasonError} for a refusal with no wording.
 */
export function bodySourceOf(row: ReviewSourceRow): Exclude<ReviewSource, { kind: 'pdf' | 'image' }> {
  if (row.body_text !== null) return { kind: 'text', text: row.body_text }
  const failure = refusalOf(row.check_results)
  if (!failure) throw new ReviewSourceShapeError(row.id, 'has no file, no body text and no refusal')
  return {
    kind: 'refused',
    refusal: describeRefusal(failure),
    email: {
      from: row.from_address,
      subject: row.subject,
      receivedAt: row.received_at,
      gmailUrl: gmailSearchUrl(row.message_id),
    },
  }
}
