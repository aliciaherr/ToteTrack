import { describe, it, expect, vi, afterEach } from 'vitest'
import type { InsertInboundEmailInput } from '@/db/queries/inbound-emails'
import type { FailureRecord } from '@/db/queries/ingest-failures'
import type { IngestState } from '@/db/queries/ingest-state'
import { ImapConnectionError } from '@/lib/errors'
import { advanceWatermark, runIngestion, type IngestRunDeps, type UidOutcome } from '../run'
import { GIVE_UP_MIN_AGE_MS, MAX_TOTAL_INGEST_BYTES } from '../limits.constants'
import type { DeclaredMessage, ImapSession } from '../types'

// No mailbox, database or bucket: every collaborator of `runIngestion` is
// injected, and the fakes below are the only things these tests can touch.
// Fixtures are invented messages on the reserved `.test` TLD (SEC-01).

const UID_VALIDITY = 7
const RUN_AT = new Date('2026-10-12T06:00:00.000Z')

function rawMessage(subject: string, messageId = `<${subject.replace(/\s/g, '-')}@orders.invalid.test>`): Buffer {
  return Buffer.from(
    [
      `Message-ID: ${messageId}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      `Please supply 40 totes against ${subject}.`,
      '',
    ].join('\r\n')
  )
}

/** A message carrying one small fake PDF attachment, so staging must upload. */
function rawWithPdf(subject: string): Buffer {
  const boundary = 'fixture-boundary'
  return Buffer.from(
    [
      `Message-ID: <${subject.replace(/\s/g, '-')}@orders.invalid.test>`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Please see the attached purchase order.',
      `--${boundary}`,
      'Content-Type: application/pdf; name="po.pdf"',
      'Content-Disposition: attachment; filename="po.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('%PDF-1.4\nfake purchase order fixture\n%%EOF\n').toString('base64'),
      `--${boundary}--`,
      '',
    ].join('\r\n')
  )
}

interface FakeMail {
  uid: number
  source: Buffer
  declaredSize?: number
  arrivedAt?: Date | null
}

/** A mailbox, a database and a state row, all in memory. */
function world(mail: FakeMail[], initial: IngestState | null = null, uidValidity = UID_VALIDITY) {
  const emails: InsertInboundEmailInput[] = []
  const fetched: number[] = []
  const listedFrom: number[] = []
  let state = initial
  const writes: IngestState[] = []
  const close = vi.fn(async () => {})
  // The give-up counter, keyed `uidValidity/uid` like the table's primary key.
  const failures = new Map<string, FailureRecord>()

  const session: ImapSession = {
    uidValidity,
    listFrom(sinceUid) {
      listedFrom.push(sinceUid)
      return (async function* listing(): AsyncGenerator<DeclaredMessage> {
        for (const message of mail.filter((item) => item.uid >= sinceUid)) {
          const declaredSize = message.declaredSize ?? message.source.length
          yield { uid: message.uid, declaredSize, messageId: null, from: null, subject: null, receivedAt: null, arrivedAt: message.arrivedAt ?? null }
        }
      })()
    },
    async fetchSource(uid) {
      fetched.push(uid)
      return mail.find((item) => item.uid === uid)!.source
    },
    close,
  }

  const deps: IngestRunDeps = {
    gmail: {
      config: { host: 'imap.invalid.test', user: 'ingest-fixture@invalid.test', appPassword: 'not-a-real-app-password' },
      openSession: async () => session,
    },
    ingest: {
      stageEmail: async (email) => {
        // Postgres `text` refuses U+0000 outright; the fake does too, so a
        // header that reaches it uncleaned fails here exactly as in prod.
        if (Object.values(email).some((value) => typeof value === 'string' && value.includes('\u0000'))) {
          throw new Error('invalid byte sequence for encoding "UTF8": 0x00')
        }
        if (emails.some((row) => row.uid_validity === email.uid_validity && row.uid === email.uid)) {
          return { duplicate: true }
        }
        emails.push(email)
        return { id: `email-${emails.length}`, duplicatesFlagged: 0 }
      },
      uploadDocument: async () => {},
    },
    readState: async () => state,
    writeState: async (next) => {
      writes.push(next)
      state = next
    },
    stagedUidsAbove: async (validity, uid) =>
      new Set(emails.filter((row) => row.uid_validity === validity && row.uid > uid).map((row) => row.uid)),
    recordFailures: async (validity, uids, now) =>
      uids.map((uid) => {
        const previous = failures.get(`${validity}/${uid}`)
        const next: FailureRecord = previous
          ? { ...previous, attempts: previous.attempts + 1, lastFailedAt: now }
          : { uidValidity: validity, uid, attempts: 1, firstFailedAt: now, lastFailedAt: now }
        failures.set(`${validity}/${uid}`, next)
        return next
      }),
    clearFailures: async (validity, uids) => {
      for (const uid of uids) failures.delete(`${validity}/${uid}`)
    },
    clearOtherValidities: async (validity) => {
      for (const [key, row] of failures) if (row.uidValidity !== validity) failures.delete(key)
    },
    now: () => RUN_AT,
  }
  return { deps, emails, fetched, listedFrom, writes, close, session, failures }
}

function stateAt(lastUid: number, uidValidity = UID_VALIDITY): IngestState {
  return { mailbox: 'INBOX', uidValidity, lastUid, lastRunAt: null }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('advanceWatermark', () => {
  const ok = (uid: number): UidOutcome => ({ uid, status: 'committed' })

  it('advances across a contiguous run of committed and already-staged UIDs', () => {
    expect(advanceWatermark(4, [ok(5), { uid: 6, status: 'already_staged' }, ok(9)])).toBe(9)
  })

  it('halts below the first failed or deferred UID, whatever commits after it', () => {
    expect(advanceWatermark(4, [ok(5), { uid: 6, status: 'failed' }, ok(7)])).toBe(5)
    expect(advanceWatermark(4, [{ uid: 5, status: 'deferred' }, ok(6)])).toBe(4)
  })

  it('leaves the watermark unchanged for an empty run', () => {
    expect(advanceWatermark(12, [])).toBe(12)
  })

  it('orders by UID, not by the order outcomes were reported in', () => {
    expect(advanceWatermark(0, [ok(3), { uid: 2, status: 'failed' }, ok(1)])).toBe(1)
  })

  it('ignores outcomes at or below the current watermark', () => {
    expect(advanceWatermark(10, [{ uid: 3, status: 'failed' }, ok(11)])).toBe(11)
  })
})

describe('runIngestion', () => {
  it('stages every new message, advances the watermark and writes last_run_at', async () => {
    const env = world([
      { uid: 5, source: rawMessage('PO 1') },
      { uid: 6, source: rawMessage('PO 2') },
    ], stateAt(4))

    const summary = await runIngestion(env.deps)

    expect(env.listedFrom).toEqual([5])
    expect(env.emails.map((row) => [row.uid_validity, row.uid])).toEqual([[7, 5], [7, 6]])
    expect(env.writes).toEqual([{ mailbox: 'INBOX', uidValidity: 7, lastUid: 6, lastRunAt: RUN_AT }])
    expect(summary).toMatchObject({
      previousWatermark: 4,
      watermark: 6,
      haltedAtUid: null,
      failedUids: [],
      deferredUids: [],
      validityReset: false,
    })
    expect(env.close).toHaveBeenCalledOnce()
  })

  it('starts from the whole mailbox on the first run', async () => {
    const env = world([{ uid: 1, source: rawMessage('PO 1') }])

    const summary = await runIngestion(env.deps)

    expect(env.listedFrom).toEqual([1])
    expect(summary.watermark).toBe(1)
  })

  it('stages two messages that share one Message-ID', async () => {
    const shared = '<same@orders.invalid.test>'
    const env = world([
      { uid: 1, source: rawMessage('PO 1', shared) },
      { uid: 2, source: rawMessage('PO 2', shared) },
    ])

    await runIngestion(env.deps)

    expect(env.emails.map((row) => row.uid)).toEqual([1, 2])
    expect(env.emails.every((row) => row.message_id === shared)).toBe(true)
  })

  it('halts the watermark below a failed UID, still stages later mail, and reports it', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = world([
      { uid: 1, source: rawMessage('PO 1') },
      { uid: 2, source: rawMessage('PO 2') },
      { uid: 3, source: rawMessage('PO 3') },
    ])
    const stageEmail = env.deps.ingest.stageEmail
    env.deps.ingest.stageEmail = async (email, pos) => {
      if (email.uid === 2) throw new Error('transaction failed')
      return stageEmail(email, pos)
    }

    const summary = await runIngestion(env.deps)

    expect(env.emails.map((row) => row.uid)).toEqual([1, 3])
    expect(summary).toMatchObject({ watermark: 1, haltedAtUid: 2, failedUids: [2] })
    expect(env.writes[0].lastUid).toBe(1)
    expect(JSON.stringify(consoleError.mock.calls)).toContain('watermark halted')
  })

  // CONSTRAINT-34 (Task 100): an upload failure throws for the message rather
  // than committing a partial row, so the watermark cannot pass it.
  it('writes no row and halts the watermark when an upload fails, then stages it on retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = world([
      { uid: 1, source: rawMessage('PO 1') },
      { uid: 2, source: rawWithPdf('PO 2') },
    ])
    env.deps.ingest.uploadDocument = async () => {
      throw new Error('storage unavailable')
    }

    const first = await runIngestion(env.deps)

    expect(env.emails.map((row) => row.uid)).toEqual([1])
    expect(first).toMatchObject({ watermark: 1, haltedAtUid: 2, failedUids: [2] })

    env.deps.ingest.uploadDocument = async () => {}
    const second = await runIngestion(env.deps)

    expect(env.emails.map((row) => row.uid)).toEqual([1, 2])
    expect(second).toMatchObject({ watermark: 2, haltedAtUid: null, failedUids: [] })
  })

  it('halts below a deferred UID and reports it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const twoThirds = Math.ceil(MAX_TOTAL_INGEST_BYTES * (2 / 3))
    const env = world([
      { uid: 1, source: rawMessage('PO 1'), declaredSize: twoThirds },
      { uid: 2, source: rawMessage('PO 2'), declaredSize: twoThirds },
    ])

    const summary = await runIngestion(env.deps)

    expect(summary).toMatchObject({ watermark: 1, haltedAtUid: 2, deferredUids: [2] })
  })

  // Acceptance: a crash between staging and the watermark advance.
  it('recovers from a crash before the watermark write without re-downloading', async () => {
    const env = world([
      { uid: 1, source: rawMessage('PO 1') },
      { uid: 2, source: rawMessage('PO 2') },
    ])
    env.deps.writeState = async () => {
      throw new Error('crash before the watermark was written')
    }
    await expect(runIngestion(env.deps)).rejects.toThrow(/crash/)
    expect(env.fetched).toEqual([1, 2])

    // Next run: the state never advanced, so the same UIDs are listed again.
    const recovered = world([
      { uid: 1, source: rawMessage('PO 1') },
      { uid: 2, source: rawMessage('PO 2') },
    ])
    recovered.emails.push(...env.emails)
    const summary = await runIngestion(recovered.deps)

    expect(recovered.listedFrom).toEqual([1])
    expect(recovered.fetched).toEqual([])
    expect(recovered.emails).toHaveLength(2)
    expect(summary.watermark).toBe(2)
  })

  // HIGH-02 end to end: one hostile header must not pin the watermark.
  it('stages a message with a NUL byte in its headers and advances past it', async () => {
    const poisoned = Buffer.from(
      [
        'Message-ID: <nul=00@orders.invalid.test>',
        'From: =?utf-8?Q?Acme=00Orders?= <orders@invalid.test>',
        'Subject: =?utf-8?Q?PO=0010042?=',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'Please supply 40 totes.',
        '',
      ].join('\r\n')
    )
    const env = world([
      { uid: 1, source: poisoned },
      { uid: 2, source: rawMessage('PO 2') },
    ])

    const summary = await runIngestion(env.deps)

    expect(summary).toMatchObject({ watermark: 2, haltedAtUid: null, failedUids: [] })
    expect(env.emails.map((row) => row.uid)).toEqual([1, 2])
    expect(env.emails[0].subject).toBe('PO10042')
  })

  it('resets the watermark and logs loudly when UIDVALIDITY changes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = world([{ uid: 1, source: rawMessage('PO 1') }], stateAt(40, 3), UID_VALIDITY)

    const summary = await runIngestion(env.deps)

    expect(env.listedFrom).toEqual([1])
    expect(summary).toMatchObject({ validityReset: true, previousWatermark: 0, watermark: 1 })
    expect(env.writes[0]).toMatchObject({ uidValidity: UID_VALIDITY, lastUid: 1 })
    const logged = consoleError.mock.calls.find(([text]) => String(text).includes('UIDVALIDITY changed'))
    expect(logged?.[1]).toMatchObject({ previousUidValidity: 3, currentUidValidity: 7, discardedWatermark: 40 })
  })

  it('writes no state and still closes the mailbox when the read fails', async () => {
    const env = world([{ uid: 1, source: rawMessage('PO 1') }])
    env.session.fetchSource = async () => {
      throw new ImapConnectionError('imap.invalid.test', 'ingest-fixture@invalid.test', 'socket gone')
    }

    await expect(runIngestion(env.deps)).rejects.toThrow(ImapConnectionError)
    expect(env.writes).toEqual([])
    expect(env.close).toHaveBeenCalledOnce()
  })
})

// Task 114 (CONSTRAINT-37, HIGH-02R): no message can pin the watermark.
describe('runIngestion — give-up rule', () => {
  const HOUR = GIVE_UP_MIN_AGE_MS
  const ARRIVED = new Date('2026-10-12T05:59:00.000Z')

  /** UID 2 throws on every stage attempt, unless it is the placeholder. */
  function poisonedWorld() {
    const env = world([
      { uid: 1, source: rawMessage('PO 1') },
      { uid: 2, source: rawMessage('Hostile PO 2'), arrivedAt: ARRIVED },
      { uid: 3, source: rawMessage('PO 3') },
    ])
    const stageEmail = env.deps.ingest.stageEmail
    env.deps.ingest.stageEmail = async (email, pos) => {
      if (email.uid === 2 && email.subject !== null) throw new Error('value Postgres refuses')
      return stageEmail(email, pos)
    }
    return env
  }

  /** Runs once per offset, each at `RUN_AT + offset`. */
  async function runAt(env: ReturnType<typeof world>, ...offsetsMs: number[]) {
    const summaries = []
    for (const offset of offsetsMs) {
      env.deps.now = () => new Date(RUN_AT.getTime() + offset)
      summaries.push(await runIngestion(env.deps))
    }
    return summaries
  }

  it('stages a placeholder after 3 failing runs over an hour, advances past it and clears the counter', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = poisonedWorld()

    const [, , third] = await runAt(env, 0, HOUR / 2, HOUR)

    expect(third).toMatchObject({ watermark: 3, haltedAtUid: null, failedUids: [], gaveUpUids: [2] })
    const placeholder = env.emails.find((row) => row.uid === 2)
    expect(placeholder).toEqual({
      uid_validity: UID_VALIDITY,
      uid: 2,
      message_id: null,
      classification: 'failed',
      from_address: null,
      subject: null,
      received_at: ARRIVED,
    })
    expect(env.failures.size).toBe(0)
    // SEC-05: nothing the sender wrote reaches a log line.
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('Hostile')
  })

  it('keeps the watermark halted after 3 failing runs inside the hour', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = poisonedWorld()

    const [, , third] = await runAt(env, 0, 1, HOUR - 1)

    expect(third).toMatchObject({ watermark: 1, haltedAtUid: 2, failedUids: [2], gaveUpUids: [] })
    expect(env.emails.some((row) => row.uid === 2)).toBe(false)
    expect(env.failures.get(`${UID_VALIDITY}/2`)?.attempts).toBe(3)
  })

  it('keeps the watermark halted after an hour but fewer than 3 failing runs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = poisonedWorld()

    const [, second] = await runAt(env, 0, HOUR * 5)

    expect(second).toMatchObject({ watermark: 1, gaveUpUids: [] })
    expect(env.emails.some((row) => row.uid === 2)).toBe(false)
  })

  it('never counts a deferred UID', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const twoThirds = Math.ceil(MAX_TOTAL_INGEST_BYTES * (2 / 3))
    const env = world([
      { uid: 1, source: rawMessage('PO 1'), declaredSize: twoThirds },
      { uid: 2, source: rawMessage('PO 2'), declaredSize: twoThirds },
    ])
    const [summary] = await runAt(env, 0)

    expect(summary).toMatchObject({ deferredUids: [2], failedUids: [], haltedAtUid: 2 })
    expect(env.failures.size).toBe(0)
  })

  it('clears the counter when a failed UID commits on retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = poisonedWorld()
    await runAt(env, 0)
    expect(env.failures.get(`${UID_VALIDITY}/2`)?.attempts).toBe(1)

    env.deps.ingest.stageEmail = world([]).deps.ingest.stageEmail
    const recovered = world([
      { uid: 1, source: rawMessage('PO 1') },
      { uid: 2, source: rawMessage('PO 2') },
      { uid: 3, source: rawMessage('PO 3') },
    ])
    recovered.emails.push(...env.emails)
    recovered.failures.set(`${UID_VALIDITY}/2`, env.failures.get(`${UID_VALIDITY}/2`)!)
    recovered.deps.readState = async () => stateAt(1)

    const summary = await runIngestion(recovered.deps)

    expect(summary).toMatchObject({ watermark: 3, failedUids: [], gaveUpUids: [] })
    expect(recovered.failures.size).toBe(0)
  })

  it('keeps the UID failed and its counter when the placeholder write fails too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = poisonedWorld()
    await runAt(env, 0, HOUR / 2)
    env.deps.ingest.stageEmail = async (email) => {
      if (email.uid === 2) throw new Error('database unavailable')
      return { duplicate: true }
    }

    const [third] = await runAt(env, HOUR)

    expect(third).toMatchObject({ watermark: 1, haltedAtUid: 2, failedUids: [2], gaveUpUids: [] })
    expect(env.failures.get(`${UID_VALIDITY}/2`)?.attempts).toBe(3)
  })

  it('clears counters of an old UIDVALIDITY when the server reports a new one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = world([{ uid: 1, source: rawMessage('PO 1') }], stateAt(40, 3))
    env.failures.set('3/41', { uidValidity: 3, uid: 41, attempts: 2, firstFailedAt: RUN_AT, lastFailedAt: RUN_AT })

    await runIngestion(env.deps)

    expect(env.failures.size).toBe(0)
  })

  it('writes no state when the counter cannot be written', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = poisonedWorld()
    env.deps.recordFailures = async () => {
      throw new Error('counter down')
    }

    await expect(runIngestion(env.deps)).rejects.toThrow(/counter down/)
    expect(env.writes).toEqual([])
  })
})
