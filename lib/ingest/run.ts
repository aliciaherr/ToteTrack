import type { IngestState } from '@/db/queries/ingest-state'
import { closeMailbox, collectUnprocessed, openMailbox } from './gmail'
import { INBOX_PATH } from './imap-session'
import { ingestMessages, type IngestDeps, type IngestSummary } from './pipeline'
import type { CollectedMail, GmailDeps } from './types'

/**
 * One ingestion run, end to end (Feature 16, Task 99; CONSTRAINT-33).
 *
 * read state → open mailbox → compare UIDVALIDITY → list and fetch above the
 * watermark → stage each message in its own transaction → advance the
 * watermark → write it with `last_run_at`.
 *
 * **The watermark only passes a UID once that message is durably visible.** It
 * stops below the first listed UID that failed, was deferred or was refused by
 * the post-parse re-check; later messages are still staged, and the halted
 * ones are listed again next run, where the `(uid_validity, uid)` unique and
 * `stagedUidsAbove` keep the already-staged ones from being written or even
 * downloaded twice.
 *
 * Not wired to any route or cron — that is Task 104. Every collaborator is
 * injected with no default, so no test can reach the live mailbox, database
 * or bucket by forgetting a stub.
 */

/** Everything a run touches, injected. Production wiring is Task 104. */
export interface IngestRunDeps {
  gmail: GmailDeps
  ingest: IngestDeps
  readState: (mailbox: string) => Promise<IngestState | null>
  writeState: (state: IngestState) => Promise<void>
  stagedUidsAbove: (uidValidity: number, uid: number) => Promise<Set<number>>
  /** The clock `last_run_at` is read from. Injected so a test can pin it. */
  now: () => Date
}

/** What became of one listed UID this run. */
export interface UidOutcome {
  uid: number
  status: 'committed' | 'already_staged' | 'failed' | 'deferred'
}

/** What one run did. UIDs and counts only (SEC-05). */
export interface IngestRunSummary {
  uidValidity: number
  /** True when the server's UIDVALIDITY differed from the stored one. */
  validityReset: boolean
  previousWatermark: number
  watermark: number
  /** The lowest listed UID that stopped the advance, or `null` if none did. */
  haltedAtUid: number | null
  /** Staging threw, or the post-parse re-check refused it. Retried next run. */
  failedUids: number[]
  /** Left for the next run by the byte budget or message-count cap. */
  deferredUids: number[]
  staging: IngestSummary
}

const ADVANCING_STATUSES: ReadonlySet<UidOutcome['status']> = new Set(['committed', 'already_staged'])

function byUid(outcomes: UidOutcome[]): UidOutcome[] {
  return [...outcomes].sort((left, right) => left.uid - right.uid)
}

/**
 * The new watermark: the highest UID such that every listed UID at or below
 * it is committed or already staged. Pure.
 *
 * A UID at or below `current` is ignored, and an empty run leaves the
 * watermark unchanged. UIDs the listing never returned (deleted messages) are
 * not gaps — only a listed UID that did not commit halts the advance.
 *
 * @param current The watermark the run started from.
 * @param outcomes One entry per listed UID above `current`.
 */
export function advanceWatermark(current: number, outcomes: UidOutcome[]): number {
  let watermark = current
  for (const outcome of byUid(outcomes)) {
    if (outcome.uid <= watermark) continue
    if (!ADVANCING_STATUSES.has(outcome.status)) break
    watermark = outcome.uid
  }
  return watermark
}

function haltedAt(watermark: number, outcomes: UidOutcome[]): number | null {
  return byUid(outcomes).find((outcome) => outcome.uid > watermark)?.uid ?? null
}

/**
 * The watermark this run starts from. A changed UIDVALIDITY invalidates every
 * stored UID at once, so the watermark restarts at 0 under the new value and
 * `content_hash` flags whatever is re-ingested (architecture failure modes).
 */
function startingWatermark(state: IngestState | null, uidValidity: number): number {
  if (!state) return 0
  if (state.uidValidity === uidValidity) return state.lastUid
  console.error('runIngestion: UIDVALIDITY changed, so every stored UID is invalid; restarting the watermark at 0', {
    mailbox: state.mailbox,
    previousUidValidity: state.uidValidity,
    currentUidValidity: uidValidity,
    discardedWatermark: state.lastUid,
  })
  return 0
}

interface MailboxRead {
  uidValidity: number
  watermark: number
  collected: CollectedMail
}

/** Opens the mailbox, reads above the watermark, and always closes it. */
async function readMailbox(deps: IngestRunDeps, state: IngestState | null): Promise<MailboxRead> {
  const session = await openMailbox(deps.gmail)
  try {
    const uidValidity = session.uidValidity
    const watermark = startingWatermark(state, uidValidity)
    const stagedUids = await deps.stagedUidsAbove(uidValidity, watermark)
    const collected = await collectUnprocessed(session, { watermark, stagedUids }, deps.gmail)
    return { uidValidity, watermark, collected }
  } finally {
    await closeMailbox(session, deps.gmail.config)
  }
}

function outcomesOf(collected: CollectedMail, staging: IngestSummary): UidOutcome[] {
  const tag = (uids: number[], status: UidOutcome['status']) =>
    uids.map((uid): UidOutcome => ({ uid, status }))
  return [
    ...tag(staging.committedUids, 'committed'),
    ...tag(collected.alreadyStagedUids, 'already_staged'),
    ...tag([...staging.failedUids, ...collected.rejectedUids], 'failed'),
    ...tag(collected.deferredUids, 'deferred'),
  ]
}

function reportHalt(summary: IngestRunSummary): void {
  if (summary.haltedAtUid === null) return
  console.error('runIngestion: the watermark halted below a UID that is not yet staged', {
    haltedAtUid: summary.haltedAtUid,
    watermark: summary.watermark,
    failedUids: summary.failedUids,
    deferredUids: summary.deferredUids,
  })
}

/**
 * Runs one ingestion pass over the mailbox and persists the new watermark.
 *
 * Throws, writing no state, when the mailbox cannot be opened or read
 * (`ImapConnectionError`) or the state cannot be read — the next run then
 * starts from the same watermark, so nothing is skipped. A failure staging one
 * message does **not** throw: it halts the watermark and is reported in the
 * summary.
 *
 * @param deps The mailbox, staging, state and clock collaborators.
 * @returns What the run did, including where the watermark halted and why.
 * @throws {ImapConnectionError} on a connection or authentication failure.
 * @throws {DatabaseError} when the state cannot be read or written.
 */
export async function runIngestion(deps: IngestRunDeps): Promise<IngestRunSummary> {
  const state = await deps.readState(INBOX_PATH)
  const read = await readMailbox(deps, state)
  const staging = await ingestMessages(read.collected.messages, read.uidValidity, deps.ingest)
  const outcomes = outcomesOf(read.collected, staging)
  const watermark = advanceWatermark(read.watermark, outcomes)
  await deps.writeState({
    mailbox: INBOX_PATH,
    uidValidity: read.uidValidity,
    lastUid: watermark,
    lastRunAt: deps.now(),
  })
  const summary: IngestRunSummary = {
    uidValidity: read.uidValidity,
    validityReset: state !== null && state.uidValidity !== read.uidValidity,
    previousWatermark: read.watermark,
    watermark,
    haltedAtUid: haltedAt(watermark, outcomes),
    failedUids: [...staging.failedUids, ...read.collected.rejectedUids],
    deferredUids: read.collected.deferredUids,
    staging,
  }
  reportHalt(summary)
  return summary
}
