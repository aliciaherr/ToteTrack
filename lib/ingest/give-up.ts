import type { FailureRecord } from '@/db/queries/ingest-failures'
import { GIVE_UP_MIN_AGE_MS, GIVE_UP_MIN_ATTEMPTS } from './limits.constants'
import { ingestMessages, type IngestDeps, type IngestSummary } from './pipeline'
import type { InboundMessage } from './types'

/**
 * The give-up rule: no message can pin the watermark (Feature 16, Task 114;
 * CONSTRAINT-37, HIGH-02R).
 *
 * A UID whose staging fails halts the watermark and is retried next run. Once
 * it has failed on `GIVE_UP_MIN_ATTEMPTS` runs **and** `GIVE_UP_MIN_AGE_MS`
 * has passed since the first, it is staged as a placeholder: a `failed` email
 * with every sender-written column NULL and one `staging_failed` review row.
 * The placeholder goes through the same `stageEmail` transaction as any
 * message, so it commits like one and the watermark passes it. If that write
 * fails too, the UID stays failed and the next run tries again.
 *
 * Nothing sender-written goes in, because sender content may be what is
 * failing (SEC-05). The only time it carries is IMAP `INTERNALDATE`, which the
 * server assigns — that is how the salesperson finds the email in Gmail.
 */

/** The counter writes the rule needs, injected. Production wiring is Task 104. */
export interface GiveUpDeps {
  ingest: IngestDeps
  recordFailures: (uidValidity: number, uids: number[], now: Date) => Promise<FailureRecord[]>
}

/** What the rule did with this run's failed UIDs. */
export interface GiveUpResult {
  /** Staged as placeholders this run. The watermark may now pass them. */
  gaveUpUids: number[]
  /** Still failed: under a threshold, or the placeholder write failed too. */
  failedUids: number[]
  /** The placeholder batch, as `ingestMessages` reported it. */
  staging: IngestSummary
}

/**
 * Has this UID failed often enough, and for long enough, to give up? Both
 * thresholds must hold. Pure.
 *
 * @param record The UID's counter after this run's increment.
 * @param now The run's clock.
 */
export function shouldGiveUp(record: FailureRecord, now: Date): boolean {
  const age = now.getTime() - record.firstFailedAt.getTime()
  return record.attempts >= GIVE_UP_MIN_ATTEMPTS && age >= GIVE_UP_MIN_AGE_MS
}

/**
 * The stand-in staged for a UID that gave up. Pure.
 *
 * No header, no body, no attachment: `messageId`, `from` and `subject` are
 * NULL, and `receivedAt` is the server's arrival time rather than the
 * sender's `Date:`. `rejection` makes the pipeline write it as a `failed`
 * email with one `staging_failed` row at `pending_review`.
 *
 * @param uid The UID that gave up.
 * @param arrivedAt Its IMAP `INTERNALDATE`, or `null` when not reported.
 * @param attempts The failing runs it took, recorded as `measured`.
 */
export function placeholderMessage(uid: number, arrivedAt: Date | null, attempts: number): InboundMessage {
  return {
    uid,
    messageId: null,
    from: null,
    subject: null,
    receivedAt: arrivedAt,
    arrivedAt,
    bodyText: '',
    attachments: [],
    rejection: {
      check: 'ingest_limit',
      reason: 'staging_failed',
      part: 'message',
      measured: attempts,
      limit: GIVE_UP_MIN_ATTEMPTS,
      unit: 'runs',
    },
  }
}

/**
 * Counts one more failing run for every failed UID, and stages a placeholder
 * for each UID that has now reached both thresholds.
 *
 * Deferred UIDs must not be passed in: deferral is not a failure.
 *
 * @param failedUids UIDs whose staging threw or whose re-check refused them.
 * @param uidValidity The UIDVALIDITY they belong to.
 * @param arrivals IMAP `INTERNALDATE` by UID, from the listing.
 * @param now The run's clock.
 * @param deps The counter and staging writes.
 * @returns Which UIDs gave up and which are still failed.
 * @throws {DatabaseError} when the counter cannot be written. A placeholder
 *   that fails to stage does not throw: its UID stays in `failedUids`.
 */
export async function giveUpOnFailures(
  failedUids: number[],
  uidValidity: number,
  arrivals: ReadonlyMap<number, Date | null>,
  now: Date,
  deps: GiveUpDeps
): Promise<GiveUpResult> {
  const records = await deps.recordFailures(uidValidity, failedUids, now)
  const placeholders = records
    .filter((record) => shouldGiveUp(record, now))
    .map((record) => placeholderMessage(record.uid, arrivals.get(record.uid) ?? null, record.attempts))
  const staging = await ingestMessages(placeholders, uidValidity, deps.ingest)
  const gaveUp = new Set(staging.committedUids)
  if (gaveUp.size > 0) {
    // UIDs and counts only (SEC-05). Loud: a document reached the inbox and
    // could not be read, and only the salesperson can recover it from Gmail.
    console.error('giveUpOnFailures: staged placeholders for UIDs that kept failing', {
      uidValidity,
      gaveUpUids: [...gaveUp],
      attempts: records.filter((record) => gaveUp.has(record.uid)).map((record) => record.attempts),
    })
  }
  return {
    gaveUpUids: [...gaveUp],
    failedUids: failedUids.filter((uid) => !gaveUp.has(uid)),
    staging,
  }
}
