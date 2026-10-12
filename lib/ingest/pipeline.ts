import type {
  InboundEmailClassification,
  InsertInboundEmailInput,
  StageEmailResult,
} from '@/db/queries/inbound-emails'
import type { InboundPoSourceKind } from '@/db/queries/inbound-pos'
import { DocumentUploadError } from '@/lib/errors'
import { loggableFailure } from '@/lib/loggable-failure'
import { documentPathFor, selectCandidates, type PoCandidate } from './candidates'
import { contentHash, refusalHash } from './hash'
import { HASH_LOG_PREFIX_LENGTH, PO_DOCUMENTS_BUCKET } from './ingest.constants'
import { refusalColumns, REFUSED_SOURCE_KIND, type StagedPoInput } from './limits'
import type { IngestLimitFailure, InboundMessage } from './types'

/**
 * Stages fetched mail into the ingestion queue (Feature 16, Task 97).
 *
 * One email yields **0..n** POs: every accepted attachment is a candidate,
 * and an email with none falls back to its body text (`candidates.ts`
 * decides which). The module writes through injected collaborators only — it
 * imports no runtime value from `@/db` or `@/lib/supabase`, exactly as
 * `gmail.ts` does not, so its tests need neither a database nor a bucket.
 * Production wiring belongs to the trigger (Task 104).
 *
 * **Classification here is provisional and structural.** An accepted
 * attachment means "probably a PO"; body text cannot be judged without the
 * model, so Task 98 may retroactively set `no_po_found`.
 *
 * **One message, one transaction.** The email row and all its PO rows are
 * written by a single `stageEmail` call, so a message is either fully staged
 * — and its UID may pass the watermark — or not staged at all (Task 99).
 *
 * **A duplicate is flagged, never rejected.** A repeat `content_hash` still
 * inserts an `inbound_pos` row with `duplicate_of_id` pointing at the first
 * sighting, so a human decides. Nothing here discards a message silently and
 * nothing auto-approves.
 */

/**
 * The writes the pipeline performs, injected rather than imported.
 *
 * Every field is required with no default, which is the point: there is no
 * code path that reaches the live database or the live bucket because a test
 * forgot to stub something (the same rule `GmailDeps.openSession` follows).
 * Production passes `stageEmailWithPos` and a Supabase Storage upload.
 */
export interface IngestDeps {
  /**
   * Writes the email and its PO rows atomically, flagging repeat hashes.
   * `{ duplicate: true }` means this UID was already staged.
   */
  stageEmail: (email: InsertInboundEmailInput, pos: StagedPoInput[]) => Promise<StageEmailResult>
  /**
   * Writes one document to `PO_DOCUMENTS_BUCKET` (CONSTRAINT-30 — never to
   * the repository or any non-gitignored path). Keys are content-addressed,
   * so a re-run writes the same key: the implementation must overwrite rather
   * than fail, which is what makes a repeated batch produce no duplicate
   * storage object.
   */
  uploadDocument: (path: string, bytes: Buffer, contentType: string) => Promise<void>
}

/** What one batch did. Counts and UIDs only — never PO content (SEC-05). */
export interface IngestSummary {
  messagesSeen: number
  /** New `inbound_emails` rows, classification irrelevant. */
  emailsStaged: number
  /** Already present by `(uid_validity, uid)`; nothing was written for these. */
  alreadyStaged: number
  posStaged: number
  /** Of `posStaged`, how many carry a `duplicate_of_id`. */
  duplicatesFlagged: number
  /**
   * Rows recording a refused message or attachment (H-01). Counted apart from
   * `posStaged` so a run that refused a hostile email does not read as a run
   * that staged purchase orders.
   */
  refusalsRecorded: number
  /** UIDs that now have a row — staged here or found already staged. */
  committedUids: number[]
  /**
   * UIDs whose staging threw: nothing was written, so each halts the
   * watermark and is retried next run. One bad email never aborts the batch.
   */
  failedUids: number[]
}

/** A candidate whose document is already in the bucket and whose hash is known. */
interface StagedCandidate {
  sourceKind: InboundPoSourceKind
  hash: string
  /** The object key, or `null` for a body candidate or a refusal. */
  documentPath: string | null
  /** The refusal this row records, or `null` for a real PO candidate. */
  failure: IngestLimitFailure | null
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
    return { sourceKind: candidate.sourceKind, hash, documentPath: null, failure: null }
  }
  const documentPath = documentPathFor(hash, candidate.mimeType)
  try {
    await deps.uploadDocument(documentPath, candidate.bytes, candidate.mimeType)
  } catch (cause) {
    throw new DocumentUploadError(PO_DOCUMENTS_BUCKET, documentPath, describe(cause), { cause })
  }
  return { sourceKind: candidate.sourceKind, hash, documentPath, failure: null }
}

/**
 * The row that records one refusal. Nothing is uploaded and no bytes are read
 * — for a message-level refusal they never were — so `document_path` stays
 * NULL and the hash is a surrogate over the mailbox position (`hash.ts`).
 */
function refusedRow(uidValidity: number, uid: number, failure: IngestLimitFailure): StagedCandidate {
  return {
    sourceKind: REFUSED_SOURCE_KIND,
    hash: refusalHash(uidValidity, uid, failure),
    documentPath: null,
    failure,
  }
}

function emailRow(
  message: InboundMessage,
  uidValidity: number,
  classification: InboundEmailClassification
): InsertInboundEmailInput {
  return {
    uid_validity: uidValidity,
    uid: message.uid,
    message_id: message.messageId,
    classification,
    from_address: message.from,
    subject: message.subject,
    received_at: message.receivedAt,
  }
}

function poRow(candidate: StagedCandidate): StagedPoInput {
  return {
    source_kind: candidate.sourceKind,
    document_path: candidate.documentPath,
    content_hash: candidate.hash,
    ...refusalColumns(candidate.failure),
  }
}

/**
 * An email that staged at least one real PO is `po_found`, whatever else it
 * also carried. One that staged none but refused something is `failed` — the
 * operator needs to know a document arrived and was not taken. One that
 * carried nothing recognisable is `no_po_found`.
 */
function classifyStaged(poCount: number, refusalCount: number): InboundEmailClassification {
  if (poCount > 0) return 'po_found'
  return refusalCount > 0 ? 'failed' : 'no_po_found'
}

async function stageDocuments(
  message: InboundMessage,
  uidValidity: number,
  deps: IngestDeps
): Promise<{ staged: StagedCandidate[]; classification: InboundEmailClassification }> {
  // Refused on its declared size, before a byte of it was fetched. There is
  // nothing to select from and nothing to upload — only a row to write.
  if (message.rejection) {
    return {
      staged: [refusedRow(uidValidity, message.uid, message.rejection)],
      classification: 'failed',
    }
  }
  const { candidates, rejections } = selectCandidates(message)
  const refused = rejections.map((failure) => refusedRow(uidValidity, message.uid, failure))
  const staged: StagedCandidate[] = []
  try {
    for (const candidate of candidates) staged.push(await stageCandidate(candidate, deps))
  } catch (cause) {
    console.error('ingestMessages: staging the documents of one message failed', {
      uid: message.uid,
      candidateCount: candidates.length,
      stagedBeforeFailure: staged.map((item) => hashPrefix(item.hash)),
      cause,
    })
    // The refusals still go in: an upload failure elsewhere in the email is no
    // reason to lose the record that something was turned away.
    return { staged: refused, classification: 'failed' }
  }
  return {
    staged: [...staged, ...refused],
    classification: classifyStaged(staged.length, refused.length),
  }
}

async function ingestOne(
  message: InboundMessage,
  uidValidity: number,
  deps: IngestDeps,
  summary: IngestSummary
): Promise<void> {
  const { staged, classification } = await stageDocuments(message, uidValidity, deps)
  const email = emailRow(message, uidValidity, classification)
  const result = await deps.stageEmail(email, staged.map(poRow))
  summary.committedUids.push(message.uid)
  if ('duplicate' in result) {
    summary.alreadyStaged += 1
    return
  }
  const refusals = staged.filter((candidate) => candidate.failure !== null).length
  summary.emailsStaged += 1
  summary.posStaged += staged.length - refusals
  summary.refusalsRecorded += refusals
  summary.duplicatesFlagged += result.duplicatesFlagged
}

function emptySummary(messagesSeen: number): IngestSummary {
  return {
    messagesSeen,
    emailsStaged: 0,
    alreadyStaged: 0,
    posStaged: 0,
    duplicatesFlagged: 0,
    refusalsRecorded: 0,
    committedUids: [],
    failedUids: [],
  }
}

/**
 * Stages a batch of parsed messages: one `inbound_emails` row each, plus one
 * `inbound_pos` row per PO candidate, each message in its own transaction.
 *
 * Idempotent. `(uid_validity, uid)` is unique, so a message already staged is
 * reported as a duplicate and nothing is written; document keys are
 * content-addressed, so a repeated upload is the same object.
 *
 * A failure on one message is caught, logged with its UID, recorded in
 * `failedUids`, and the loop continues — one bad email never aborts the batch
 * (EH-01 / EH-02). Logged context carries UIDs, counts and hash prefixes only:
 * no header, body text, attachment contents or PO data (SEC-01 / SEC-05).
 *
 * @param messages Parsed messages from `collectUnprocessed`.
 * @param uidValidity The mailbox UIDVALIDITY every message's UID belongs to.
 * @param deps The injected database and storage writes. No defaults.
 * @returns Counts for the batch, plus the committed and failed UIDs.
 */
export async function ingestMessages(
  messages: InboundMessage[],
  uidValidity: number,
  deps: IngestDeps
): Promise<IngestSummary> {
  const summary = emptySummary(messages.length)
  for (const message of messages) {
    try {
      await ingestOne(message, uidValidity, deps, summary)
    } catch (cause) {
      summary.failedUids.push(message.uid)
      // Never the error itself: a database failure's cause chain carries the
      // sender, subject and Message-ID as query params (SEC-05, MEDIUM-04).
      console.error('ingestMessages: staging one message failed, continuing with the batch', {
        uid: message.uid,
        ...loggableFailure(cause),
      })
    }
  }
  return summary
}
