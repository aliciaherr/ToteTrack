import { describe, it, expect, vi } from 'vitest'

vi.mock('@/db', () => ({ db: {} }))

import { stageEmailWithPos, stagedUidsAbove } from '@/db/queries/inbound-emails'
import { clearFailures, clearOtherValidities, recordFailures } from '@/db/queries/ingest-failures'
import { readIngestState, writeIngestState } from '@/db/queries/ingest-state'
import { IngestConfigError } from '@/lib/errors'
import { uploadPoDocument } from '@/lib/storage/po-documents'
import { createImapSession } from '../imap-session'
import { buildIngestRunDeps } from '../run-deps'

// Invented mailbox on the reserved `.test` TLD; not a real credential (SEC-01).
const ENV = {
  GMAIL_IMAP_HOST: 'imap.invalid.test',
  GMAIL_IMAP_USER: 'ingest-fixture@invalid.test',
  GMAIL_IMAP_APP_PASSWORD: 'not-a-real-app-password',
  ADMIN_EMAIL: 'admin-fixture@invalid.test',
}

describe('buildIngestRunDeps', () => {
  it('wires every production collaborator', () => {
    const deps = buildIngestRunDeps(ENV)

    expect(deps.gmail.config).toEqual({
      host: ENV.GMAIL_IMAP_HOST,
      user: ENV.GMAIL_IMAP_USER,
      appPassword: ENV.GMAIL_IMAP_APP_PASSWORD,
    })
    expect(deps.gmail.openSession).toBe(createImapSession)
    expect(deps.ingest.stageEmail).toBe(stageEmailWithPos)
    // MEDIUM-06: documents go to the bucket through the CONSTRAINT-38 module.
    expect(deps.ingest.uploadDocument).toBe(uploadPoDocument)
    expect(deps.readState).toBe(readIngestState)
    expect(deps.writeState).toBe(writeIngestState)
    expect(deps.stagedUidsAbove).toBe(stagedUidsAbove)
    expect(deps.recordFailures).toBe(recordFailures)
    expect(deps.clearFailures).toBe(clearFailures)
    expect(deps.clearOtherValidities).toBe(clearOtherValidities)
  })

  it('reads the clock fresh on every call', () => {
    const deps = buildIngestRunDeps(ENV)

    expect(deps.now()).toBeInstanceOf(Date)
    expect(deps.now()).not.toBe(deps.now())
  })

  it('throws IngestConfigError naming a missing mailbox variable', () => {
    const { GMAIL_IMAP_APP_PASSWORD: _omitted, ...missing } = ENV

    expect(() => buildIngestRunDeps(missing)).toThrow(IngestConfigError)
    expect(() => buildIngestRunDeps(missing)).toThrow(/GMAIL_IMAP_APP_PASSWORD/)
  })
})
