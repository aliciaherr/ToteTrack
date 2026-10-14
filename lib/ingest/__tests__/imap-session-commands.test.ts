import { describe, it, expect, vi, afterEach } from 'vitest'
import { ImapConnectionError } from '@/lib/errors'
import { UidFetchError } from '../imap-errors'
import {
  IMAP_CONNECTION_TIMEOUT_MS,
  IMAP_GREETING_TIMEOUT_MS,
  IMAP_SOCKET_TIMEOUT_MS,
} from '../limits.constants'
import type { GmailImapConfig } from '../types'

/**
 * `createImapSession` against a fake `ImapFlow` that keeps imapflow's real
 * rule: one command in flight at a time, and a `fetch()` stays in flight until
 * its consumer has read every row. A `fetchOne` issued while a listing is
 * still open is the deadlock that hung live runs; the fake turns it into a
 * thrown error so the test fails instead of hanging.
 */

const LISTED_UIDS = [7, 8, 9]

class FakeImapFlow {
  /** The options the session was constructed with, for the timeout test. */
  static lastOptions: Record<string, unknown> | null = null
  mailbox: { uidValidity: bigint } | false = { uidValidity: BigInt(4242) }
  usable = true
  private listingOpen = false

  constructor(options: Record<string, unknown>) {
    FakeImapFlow.lastOptions = options
  }

  async connect(): Promise<void> {}
  async getMailboxLock(): Promise<{ release: () => void }> {
    return { release: () => {} }
  }
  async logout(): Promise<void> {}
  close(): void {}

  async *fetch(): AsyncGenerator<{ uid: number; size: number; envelope: object }> {
    this.listingOpen = true
    try {
      for (const uid of LISTED_UIDS) yield { uid, size: 1024, envelope: {} }
    } finally {
      this.listingOpen = false
    }
  }

  async fetchOne(uid: string): Promise<{ source: Buffer } | false> {
    if (this.listingOpen) throw new Error(`deadlock: UID FETCH ${uid} queued behind an open listing`)
    return { source: Buffer.from(`message ${uid}`) }
  }
}

vi.mock('imapflow', () => ({ ImapFlow: FakeImapFlow }))

const FAKE_CONFIG: GmailImapConfig = {
  host: 'imap.invalid.test',
  user: 'ingest-fixture@invalid.test',
  appPassword: 'not-a-real-app-password',
}

async function openSession() {
  const { createImapSession } = await import('../imap-session')
  return createImapSession(FAKE_CONFIG)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createImapSession', () => {
  it('lets a message be downloaded while its listing is being walked', async () => {
    const session = await openSession()

    const downloaded: string[] = []
    for await (const declared of session.listFrom(7)) {
      downloaded.push((await session.fetchSource(declared.uid)).toString())
    }

    expect(downloaded).toEqual(['message 7', 'message 8', 'message 9'])
  })

  // A stalled server must fail inside the run route's maxDuration, not at it.
  it('passes connection, greeting and socket timeouts to imapflow', async () => {
    await openSession()

    expect(FakeImapFlow.lastOptions).toMatchObject({
      connectionTimeout: IMAP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: IMAP_GREETING_TIMEOUT_MS,
      socketTimeout: IMAP_SOCKET_TIMEOUT_MS,
      logger: false,
    })
  })
})

describe('createImapSession — a failed open never leaves the connection open', () => {
  it('logs out and rethrows when the mailbox lock is refused', async () => {
    vi.spyOn(FakeImapFlow.prototype, 'getMailboxLock').mockRejectedValue(new Error('NO [NONEXISTENT]'))
    const logout = vi.spyOn(FakeImapFlow.prototype, 'logout')

    await expect(openSession()).rejects.toThrow('NO [NONEXISTENT]')
    expect(logout).toHaveBeenCalledOnce()
  })

  it('releases the lock and logs out when UIDVALIDITY is unusable', async () => {
    const release = vi.fn()
    vi.spyOn(FakeImapFlow.prototype, 'getMailboxLock').mockImplementation(async function (this: FakeImapFlow) {
      this.mailbox = false
      return { release }
    })
    const logout = vi.spyOn(FakeImapFlow.prototype, 'logout')

    await expect(openSession()).rejects.toBeInstanceOf(ImapConnectionError)
    expect(release).toHaveBeenCalledOnce()
    expect(logout).toHaveBeenCalledOnce()
  })

  it('closes the socket and keeps the original error when logout fails too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(FakeImapFlow.prototype, 'getMailboxLock').mockRejectedValue(new Error('NO [NONEXISTENT]'))
    vi.spyOn(FakeImapFlow.prototype, 'logout').mockRejectedValue(new Error('logout failed'))
    const close = vi.spyOn(FakeImapFlow.prototype, 'close')

    await expect(openSession()).rejects.toThrow('NO [NONEXISTENT]')
    expect(close).toHaveBeenCalledOnce()
  })
})

describe('createImapSession — one UID that will not download', () => {
  it('is a per-UID failure while the connection stays usable', async () => {
    const session = await openSession()
    vi.spyOn(FakeImapFlow.prototype, 'fetchOne').mockRejectedValue(new Error('BAD fetch'))

    await expect(session.fetchSource(7)).rejects.toBeInstanceOf(UidFetchError)
  })

  it('is a per-UID failure when the server returns no source on a live connection', async () => {
    const session = await openSession()
    vi.spyOn(FakeImapFlow.prototype, 'fetchOne').mockResolvedValue(false)

    await expect(session.fetchSource(7)).rejects.toThrow(/UID 7/)
    await expect(session.fetchSource(7)).rejects.toBeInstanceOf(UidFetchError)
  })

  // A dead socket is not one message's fault: the run must stop.
  it('is a connection error once the connection is no longer usable', async () => {
    const session = await openSession()
    vi.spyOn(FakeImapFlow.prototype, 'fetchOne').mockImplementation(async function (this: FakeImapFlow) {
      this.usable = false
      throw new Error('Connection not available')
    })

    await expect(session.fetchSource(7)).rejects.toBeInstanceOf(ImapConnectionError)
  })
})

describe('createImapSession — a listed row with no usable size', () => {
  it('is listed as unsized, logged by UID, and the rest of the listing still comes back', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const session = await openSession()
    vi.spyOn(FakeImapFlow.prototype, 'fetch').mockImplementation(async function* () {
      yield { uid: 7, size: Number.NaN, envelope: {} }
      yield { uid: 8, size: 1024, envelope: {} }
    })

    const listed = []
    for await (const entry of session.listFrom(7)) listed.push(entry)

    expect(listed).toEqual([
      { uid: 7, arrivedAt: null, unsized: true },
      expect.objectContaining({ uid: 8, declaredSize: 1024 }),
    ])
    expect(consoleError).toHaveBeenCalledWith(expect.stringMatching(/RFC822\.SIZE/), { uid: 7 })
  })

  it('still fails the listing when the connection drops mid-listing', async () => {
    const session = await openSession()
    vi.spyOn(FakeImapFlow.prototype, 'fetch').mockImplementation(async function* () {
      yield { uid: 7, size: 1024, envelope: {} }
      throw new Error('Connection closed')
    })

    await expect(async () => {
      for await (const entry of session.listFrom(7)) void entry
    }).rejects.toThrow(/Connection closed/)
  })
})
