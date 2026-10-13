import { describe, it, expect, vi } from 'vitest'
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
  mailbox = { uidValidity: BigInt(4242) }
  private listingOpen = false

  async connect(): Promise<void> {}
  async getMailboxLock(): Promise<{ release: () => void }> {
    return { release: () => {} }
  }
  async logout(): Promise<void> {}

  async *fetch(): AsyncGenerator<{ uid: number; size: number; envelope: object }> {
    this.listingOpen = true
    try {
      for (const uid of LISTED_UIDS) yield { uid, size: 1024, envelope: {} }
    } finally {
      this.listingOpen = false
    }
  }

  async fetchOne(uid: string): Promise<{ source: Buffer }> {
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

describe('createImapSession', () => {
  it('lets a message be downloaded while its listing is being walked', async () => {
    const { createImapSession } = await import('../imap-session')
    const session = await createImapSession(FAKE_CONFIG)

    const downloaded: string[] = []
    for await (const declared of session.listFrom(7)) {
      downloaded.push((await session.fetchSource(declared.uid)).toString())
    }

    expect(downloaded).toEqual(['message 7', 'message 8', 'message 9'])
  })

  it('reports a failed download as a connection error, so the run stops instead of staging it unparseable', async () => {
    const { createImapSession } = await import('../imap-session')
    const { ImapConnectionError } = await import('@/lib/errors')
    const session = await createImapSession(FAKE_CONFIG)
    vi.spyOn(FakeImapFlow.prototype, 'fetchOne').mockRejectedValue(new Error('Connection not available'))

    await expect(session.fetchSource(7)).rejects.toBeInstanceOf(ImapConnectionError)
    vi.restoreAllMocks()
  })

  it('still fails loudly when a listed row has no usable size', async () => {
    const { createImapSession } = await import('../imap-session')
    const session = await createImapSession(FAKE_CONFIG)
    vi.spyOn(FakeImapFlow.prototype, 'fetch').mockImplementation(async function* () {
      yield { uid: 7, size: Number.NaN, envelope: {} }
    })

    await expect(async () => {
      for await (const declared of session.listFrom(7)) void declared
    }).rejects.toThrow(/RFC822\.SIZE/)
    vi.restoreAllMocks()
  })
})
