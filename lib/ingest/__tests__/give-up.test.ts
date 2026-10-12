import { describe, it, expect, vi, afterEach } from 'vitest'
import type { FailureRecord } from '@/db/queries/ingest-failures'
import type { InsertInboundEmailInput } from '@/db/queries/inbound-emails'
import { giveUpOnFailures, placeholderMessage, shouldGiveUp, type GiveUpDeps } from '../give-up'
import { GIVE_UP_MIN_AGE_MS, GIVE_UP_MIN_ATTEMPTS } from '../limits.constants'
import type { StagedPoInput } from '../limits'

const NOW = new Date('2026-10-12T06:00:00.000Z')
const ARRIVED = new Date('2026-10-12T04:30:00.000Z')

function record(attempts: number, ageMs: number, uid = 4): FailureRecord {
  return {
    uidValidity: 7,
    uid,
    attempts,
    firstFailedAt: new Date(NOW.getTime() - ageMs),
    lastFailedAt: NOW,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('shouldGiveUp', () => {
  it('gives up exactly at both thresholds', () => {
    expect(shouldGiveUp(record(GIVE_UP_MIN_ATTEMPTS, GIVE_UP_MIN_AGE_MS), NOW)).toBe(true)
  })

  it('keeps retrying one run short of the count, however old', () => {
    expect(shouldGiveUp(record(GIVE_UP_MIN_ATTEMPTS - 1, GIVE_UP_MIN_AGE_MS * 24), NOW)).toBe(false)
  })

  it('keeps retrying one millisecond short of the age, however many runs', () => {
    expect(shouldGiveUp(record(GIVE_UP_MIN_ATTEMPTS * 10, GIVE_UP_MIN_AGE_MS - 1), NOW)).toBe(false)
  })
})

describe('placeholderMessage', () => {
  it('carries the UID, the server arrival time and the run count, and nothing a sender wrote', () => {
    expect(placeholderMessage(4, ARRIVED, 3)).toEqual({
      uid: 4,
      messageId: null,
      from: null,
      subject: null,
      receivedAt: ARRIVED,
      arrivedAt: ARRIVED,
      bodyText: '',
      attachments: [],
      rejection: {
        check: 'ingest_limit',
        reason: 'staging_failed',
        part: 'message',
        measured: 3,
        limit: GIVE_UP_MIN_ATTEMPTS,
        unit: 'runs',
      },
    })
  })

  it('stores no arrival time when the listing reported none', () => {
    expect(placeholderMessage(4, null, 3)).toMatchObject({ receivedAt: null, arrivedAt: null })
  })
})

describe('giveUpOnFailures', () => {
  function depsWith(records: FailureRecord[]) {
    const emails: InsertInboundEmailInput[] = []
    const pos: StagedPoInput[][] = []
    const deps: GiveUpDeps = {
      recordFailures: vi.fn(async () => records),
      ingest: {
        stageEmail: async (email, rows) => {
          emails.push(email)
          pos.push(rows)
          return { id: 'email-1', duplicatesFlagged: 0 }
        },
        uploadDocument: async () => {
          throw new Error('a placeholder never uploads')
        },
      },
    }
    return { deps, emails, pos }
  }

  it('stages a header-free failed email and one staging_failed review row for a UID past both thresholds', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deps, emails, pos } = depsWith([record(3, GIVE_UP_MIN_AGE_MS, 4), record(1, 0, 5)])

    const result = await giveUpOnFailures([4, 5], 7, new Map([[4, ARRIVED]]), NOW, deps)

    expect(deps.recordFailures).toHaveBeenCalledWith(7, [4, 5], NOW)
    expect(result).toMatchObject({ gaveUpUids: [4], failedUids: [5] })
    expect(emails).toEqual([
      {
        uid_validity: 7,
        uid: 4,
        message_id: null,
        classification: 'failed',
        from_address: null,
        subject: null,
        received_at: ARRIVED,
      },
    ])
    expect(pos[0]).toHaveLength(1)
    expect(pos[0][0]).toMatchObject({ document_path: null, status: 'pending_review' })
    expect(JSON.stringify(pos[0][0].check_results)).toContain('staging_failed')
  })

  it('keeps the UID failed when the placeholder write fails too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { deps } = depsWith([record(3, GIVE_UP_MIN_AGE_MS, 4)])
    deps.ingest.stageEmail = async () => {
      throw new Error('database unavailable')
    }

    const result = await giveUpOnFailures([4], 7, new Map(), NOW, deps)

    expect(result).toMatchObject({ gaveUpUids: [], failedUids: [4] })
  })

  it('throws when the counter cannot be written', async () => {
    const { deps } = depsWith([])
    deps.recordFailures = async () => {
      throw new Error('counter down')
    }
    await expect(giveUpOnFailures([4], 7, new Map(), NOW, deps)).rejects.toThrow(/counter down/)
  })
})
