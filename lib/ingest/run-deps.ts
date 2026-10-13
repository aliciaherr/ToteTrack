import { stageEmailWithPos, stagedUidsAbove } from '@/db/queries/inbound-emails'
import { clearFailures, clearOtherValidities, recordFailures } from '@/db/queries/ingest-failures'
import { readIngestState, writeIngestState } from '@/db/queries/ingest-state'
import { uploadPoDocument } from '@/lib/storage/po-documents'
import { readGmailImapConfig } from './gmail'
import { createImapSession } from './imap-session'
import type { IngestRunDeps } from './run'

/**
 * Production wiring for `runIngestion` (Feature 16, Task 104).
 *
 * Documents go through `uploadPoDocument` (closes MEDIUM-06), whose module is
 * the only one allowed the Supabase secret key (CONSTRAINT-38).
 */

type EnvLookup = Readonly<Record<string, string | undefined>>

/**
 * Builds the real mailbox, database, bucket and clock collaborators.
 *
 * The mailbox config is read here, at build time, so a missing variable
 * fails before any connection is attempted.
 *
 * @param env Where the mailbox config is read from; a parameter so tests can
 *   describe an environment without mutating `process.env`.
 * @returns Every collaborator `runIngestion` needs.
 * @throws {IngestConfigError} when a `GMAIL_IMAP_*` variable is missing, or the
 *   mailbox is the `ADMIN_EMAIL` account.
 */
export function buildIngestRunDeps(env: EnvLookup = process.env): IngestRunDeps {
  return {
    gmail: { config: readGmailImapConfig(env), openSession: createImapSession },
    ingest: { stageEmail: stageEmailWithPos, uploadDocument: uploadPoDocument },
    readState: readIngestState,
    writeState: writeIngestState,
    stagedUidsAbove,
    recordFailures,
    clearFailures,
    clearOtherValidities,
    now: () => new Date(),
  }
}
