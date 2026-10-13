'use server'

import { countUndecided } from '@/db/queries/inbound-pos'
import { countFailingUids } from '@/db/queries/ingest-failures'
import { readIngestState } from '@/db/queries/ingest-state'
import { IngestConfigError } from '@/lib/errors'
import { ingestRouteUrl } from '@/lib/ingest/app-origin'
import { INBOX_PATH } from '@/lib/ingest/imap-session'
import { postTrigger } from '@/lib/ingest/trigger-post'
import { loggableFailure } from '@/lib/loggable-failure'
import { requireEnv } from '@/lib/required-env'
import { assertAuthenticated, GENERIC_FAILURE_MESSAGE } from './auth.guard'

/**
 * The review queue's two actions (Feature 16): the manual ingestion trigger
 * (Task 104) and the status the menu badge reads (Task 105). The trigger does
 * not run ingestion itself: it POSTs `/api/ingest/run`, the same route the
 * cron calls, so there is one code path and one `maxDuration`.
 */

const RUN_ROUTE_PATH = '/api/ingest/run'

/** How long to wait for the route's 202. It answers in milliseconds. */
const TRIGGER_RESPONSE_TIMEOUT_MS = 10_000

/**
 * Starts an ingestion run for the signed-in user.
 *
 * @returns `{ accepted: true }` once the route has answered 202; otherwise
 *   `{ error }`, with the cause logged (never the secret).
 */
export async function triggerIngestion(): Promise<{ error: string } | { accepted: true }> {
  try {
    const denied = await assertAuthenticated()
    if (denied) return denied

    const url = ingestRouteUrl(RUN_ROUTE_PATH)
    const secret = requireEnv(process.env, 'INGEST_TRIGGER_SECRET', (variable, detail) => new IngestConfigError(variable, detail))
    // A refusal or a network failure is logged by `postTrigger`.
    const accepted = await postTrigger('triggerIngestion: run route', url, secret, fetch, TRIGGER_RESPONSE_TIMEOUT_MS)
    return accepted ? { accepted: true } : { error: GENERIC_FAILURE_MESSAGE }
  } catch (error) {
    console.error('triggerIngestion: could not start an ingestion run', {
      failure: loggableFailure(error),
      variable: error instanceof IngestConfigError ? error.variable : null,
    })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}

/** What the menu shows about the review queue. Counts and one timestamp only (SEC-05). */
export interface IngestStatus {
  /** `pending_review` + `extraction_failed`, skipped rows included. */
  toReview: number
  /** `pending_extraction` + `extracting`: still with the worker. */
  beingRead: number
  /** When ingestion last finished a run, ISO; `null` before the first. */
  lastRunAt: string | null
  /** Emails that keep failing to import (`ingest_uid_failures` rows). */
  failingCount: number
}

/**
 * The review-queue status for the signed-in user (Task 105): every undecided
 * PO, when mail was last checked, and how many emails are failing to import.
 *
 * @returns The status, or `{ error }` with no session or when a read fails
 *   (logged without its params).
 */
export async function getIngestStatus(): Promise<{ error: string } | IngestStatus> {
  try {
    const denied = await assertAuthenticated()
    if (denied) return denied

    const [undecided, state, failingCount] = await Promise.all([
      countUndecided(),
      readIngestState(INBOX_PATH),
      countFailingUids(),
    ])
    return { ...undecided, lastRunAt: state?.lastRunAt?.toISOString() ?? null, failingCount }
  } catch (error) {
    console.error('getIngestStatus: could not read the review queue status', { failure: loggableFailure(error) })
    return { error: GENERIC_FAILURE_MESSAGE }
  }
}
