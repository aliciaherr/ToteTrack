import type {
  InboundEmailClassification,
  InboundPoSourceKind,
  InsertInboundEmailInput,
  InsertInboundPoInput,
} from '@/db/queries/inbound'
import { DocumentUploadError } from '@/lib/errors'
import { documentPathFor, selectCandidates, type PoCandidate } from './candidates'
import { contentHash } from './hash'
import { HASH_LOG_PREFIX_LENGTH, PO_DOCUMENTS_BUCKET } from './ingest.constants'
import type { InboundMessage } from './types'

/**
 * Stages fetched mail into the ingestion queue (Feature 16, Task 97).
 *
 * One email yields **0..n** POs: every accepted attachment is a candidate,
 * and an email with none falls back to its body text (`candidates.ts`
 * decides which). The module writes through injected collaborators only — it
 * imports no runtime value from `@/db` or `@/lib/supabase`, exactly as
 * `gmail.ts` does not, so its tests need neither a database nor a bucket.
 * Production wiring belongs to the trigger (Task 102).
 *
 * **Classification here is provisional and structural.** An accepted
 * attachment means "probably a PO"; body text cannot be judged without the
 * model, so Task 98 may retroactively set `no_po_found`.
 *
 * **A duplicate is flagged, never rejected.** A repeat `content_hash` still
 * inserts an `inbound_pos` row at `pending_extraction` with `duplicate_of_id`
 * pointing at the first sighting, so a human decides. Nothing here discards a
 * message silently and nothing auto-approves.
 */

/**
 * The writes the pipeline performs, injected rather than imported.
 *
 * Every field is required with no default, which is the point: there is no
 * code path that reaches the live database or the live bucket because a test
 * forgot to stub something (the same rule `GmailDeps.openSession` follows).
 * Production passes `insertInboundEmail`, `insertInboundPo`,
 * `findPoByContentHash` and a Supabase Storage upload.
 */
export interface IngestDeps {
  /** Records the email. `{ duplicate: true }` means it was already staged. */
  insertEmail: (input: InsertInboundEmailInput) => Promise<{ id: string } | { duplicate: true }>
  /** Stages one PO candidate. Always inserts, duplicates included. */
  insertPo: (input: InsertInboundPoInput) => Promise<{ id: string }>
  /** Earliest row carrying this hash, or `null` on a first sighting. */
  findPoByHash: (hash: string) => Promise<{ id: string } | null>
  /**
   * Writes one document to `PO_DOCUMENTS_BUCKET` (CONSTRAINT-30 — never to
   * the repository or any non-gitignored path). Keys are content-addressed,
   * so a re-run writes the same key: the implementation must overwrite rather
   * than fail, which is what makes a repeated batch produce no duplicate
   * storage object.
   */
  uploadDocument: (path: string, bytes: Buffer, contentType: string) => Promise<void>
}

/** What one batch did. Counts and message ids only — never PO content. */
export interface IngestSummary {
  messagesSeen: number
  /** New `inbound_emails` rows, classification irrelevant. */
  emailsStaged: number
  /** Already present by `message_id`; nothing was written for these. */
  alreadyStaged: number
  posStaged: number
  /** Of `posStaged`, how many carry a `duplicate_of_id`. */
  duplicatesFlagged: number
  /** Message ids classified `failed`. One bad email never aborts the batch. */
  failedMessageIds: string[]
}

/** A candidate whose document is already in the bucket and whose hash is known. */
interface StagedCandidate {
  sourceKind: InboundPoSourceKind
  hash: string
  /** The object key, or `null` for a body candidate. */
  documentPath: string | null
}

function hashPrefix(hash: string): string {
  return hash.slice(0, HASH_LOG_PREFIX_LENGTH)
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Hashes one candidate and, when it is a file, puts it in the bucket before
 * the row that will point at it exists. An upload failure throws
 * `DocumentUploadError` and the caller writes no `inbound_pos` row — no row
 * may reference a missing object.
 */
async function stageCandidate(candidate: PoCandidate, deps: IngestDeps): Promise<StagedCandidate> {
  const hash = contentHash(candidate.hashInput)
  if (!candidate.bytes || !candidate.mimeType) {
    return { sourceKind: candidate.sourceKind, hash, documentPath: null }
  }
  const documentPath = documentPathFor(hash, candidate.mimeType)
  try {
    await deps.uploadDocument(documentPath, candidate.bytes, candidate.mimeType)
  } catch (cause) {
    throw new DocumentUploadError(PO_DOCUMENTS_BUCKET, documentPath, describe(cause), { cause })
  }
  return { sourceKind: candidate.sourceKind, hash, documentPath }
}

function emailRow(
  message: InboundMessage,
  classification: InboundEmailClassification
): InsertInboundEmailInput {
  return {
    message_id: message.messageId,
    classification,
    from_address: message.from,
    subject: message.subject,
    received_at: message.receivedAt,
  }
}

/**
 * Writes one `inbound_pos` row per staged candidate, flagging a repeat hash
 * against its first sighting. The row is inserted either way, at
 * `pending_extraction`, so a duplicate reaches the review queue.
 */
async function insertStagedPos(
  emailId: string,
  staged: StagedCandidate[],
  deps: IngestDeps
): Promise<{ inserted: number; duplicates: number }> {
  let duplicates = 0
  for (const candidate of staged) {
    const original = await deps.findPoByHash(candidate.hash)
    if (original) duplicates += 1
    await deps.insertPo({
      inbound_email_id: emailId,
      source_kind: candidate.sourceKind,
      document_path: candidate.documentPath,
      content_hash: candidate.hash,
      duplicate_of_id: original?.id ?? null,
    })
  }
  return { inserted: staged.length, duplicates }
}

/**
 * Hashes and uploads every candidate before the email row is written, so the
 * stored classification already reflects whether the documents made it into
 * the bucket. On a failure the email is classified `failed` and no candidate
 * is staged — the Task 95 data layer has no classification update, so the
 * value has to be right the first time it is written.
 */
async function stageDocuments(
  message: InboundMessage,
  deps: IngestDeps
): Promise<{ staged: StagedCandidate[]; classification: InboundEmailClassification }> {
  const candidates = selectCandidates(message)
  const staged: StagedCandidate[] = []
  try {
    for (const candidate of candidates) staged.push(await stageCandidate(candidate, deps))
  } catch (cause) {
    console.error('ingestMessages: staging the documents of one message failed', {
      messageId: message.messageId,
      candidateCount: candidates.length,
      stagedBeforeFailure: staged.map((item) => hashPrefix(item.hash)),
      cause,
    })
    return { staged: [], classification: 'failed' }
  }
  return { staged, classification: staged.length > 0 ? 'po_found' : 'no_po_found' }
}

async function ingestOne(
  message: InboundMessage,
  deps: IngestDeps,
  summary: IngestSummary
): Promise<void> {
  const { staged, classification } = await stageDocuments(message, deps)
  if (classification === 'failed') summary.failedMessageIds.push(message.messageId)
  const email = await deps.insertEmail(emailRow(message, classification))
  if ('duplicate' in email) {
    summary.alreadyStaged += 1
    return
  }
  summary.emailsStaged += 1
  const { inserted, duplicates } = await insertStagedPos(email.id, staged, deps)
  summary.posStaged += inserted
  summary.duplicatesFlagged += duplicates
}

function emptySummary(messagesSeen: number): IngestSummary {
  return {
    messagesSeen,
    emailsStaged: 0,
    alreadyStaged: 0,
    posStaged: 0,
    duplicatesFlagged: 0,
    failedMessageIds: [],
  }
}

/**
 * Stages a batch of parsed messages: one `inbound_emails` row each, plus one
 * `inbound_pos` row per PO candidate at `pending_extraction`.
 *
 * Idempotent. `message_id` is unique, so a message already staged is reported
 * as a duplicate by the insert and no PO rows follow; document keys are
 * content-addressed, so a repeated upload is the same object.
 *
 * A failure on one message is caught, logged with that message's id, recorded
 * in `failedMessageIds`, and the loop continues — one bad email never aborts
 * the batch (EH-01 / EH-02). Logged context carries identifiers, counts and
 * hash prefixes only: no body text, no attachment contents, no customer or PO
 * data (SEC-01 / SEC-05).
 *
 * @param messages Parsed messages from `fetchUnprocessedMail`.
 * @param deps The injected database and storage writes. No defaults.
 * @returns Counts for the batch, plus the ids of the messages that failed.
 */
export async function ingestMessages(
  messages: InboundMessage[],
  deps: IngestDeps
): Promise<IngestSummary> {
  const summary = emptySummary(messages.length)
  for (const message of messages) {
    try {
      await ingestOne(message, deps, summary)
    } catch (cause) {
      if (!summary.failedMessageIds.includes(message.messageId)) {
        summary.failedMessageIds.push(message.messageId)
      }
      console.error('ingestMessages: staging one message failed, continuing with the batch', {
        messageId: message.messageId,
        cause,
      })
    }
  }
  return summary
}
