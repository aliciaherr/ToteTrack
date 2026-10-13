import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/db', () => ({ db: {} }))

import { DrizzleQueryError } from 'drizzle-orm'
import { ImapConnectionError, IngestConfigError } from '@/lib/errors'
import type { IngestRunSummary } from '../run'
import { runAndKick, type RunTriggerDeps } from '../run-trigger'

const EXTRACT_URL = 'http://localhost:3000/api/ingest/extract'
const SECRET = 'test-trigger-secret-value'

const SUMMARY = {
  uidValidity: 7,
  validityReset: false,
  previousWatermark: 10,
  watermark: 12,
  haltedAtUid: null,
  failedUids: [],
  gaveUpUids: [],
  deferredUids: [],
  staging: {
    messagesSeen: 2,
    emailsStaged: 2,
    alreadyStaged: 0,
    posStaged: 2,
    duplicatesFlagged: 0,
    refusalsRecorded: 0,
    committedUids: [11, 12],
    failedUids: [],
  },
} as unknown as IngestRunSummary

function makeDeps(ran: IngestRunSummary | Error, fetchResult: Response | Error = new Response(null, { status: 202 })) {
  const deps: RunTriggerDeps = {
    run: vi.fn(() => (ran instanceof Error ? Promise.reject(ran) : Promise.resolve(ran))),
    fetch: vi.fn(() => (fetchResult instanceof Error ? Promise.reject(fetchResult) : Promise.resolve(fetchResult))),
  }
  return deps
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runAndKick', () => {
  it('runs once, then pokes the worker once with the secret', async () => {
    const deps = makeDeps(SUMMARY)

    expect(await runAndKick(EXTRACT_URL, SECRET, deps)).toBe(SUMMARY)

    expect(deps.run).toHaveBeenCalledTimes(1)
    expect(deps.fetch).toHaveBeenCalledTimes(1)
    expect(deps.fetch).toHaveBeenCalledWith(EXTRACT_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}` },
      redirect: 'manual',
    })
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('logs a failed run, still pokes the worker and returns null', async () => {
    const deps = makeDeps(new ImapConnectionError('imap.invalid.test', 'ingest@invalid.test', 'login refused'))

    expect(await runAndKick(EXTRACT_URL, SECRET, deps)).toBeNull()

    expect(deps.fetch).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('ingestion run failed'),
      expect.objectContaining({ failure: expect.objectContaining({ error: 'ImapConnectionError' }) }),
    )
  })

  it('names the missing variable when the run fails on config', async () => {
    const deps = makeDeps(new IngestConfigError('GMAIL_IMAP_USER', 'is missing'))

    await runAndKick(EXTRACT_URL, SECRET, deps)

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('ingestion run failed'),
      expect.objectContaining({ variable: 'GMAIL_IMAP_USER' }),
    )
  })

  // SEC-05: a raw drizzle error carries query params, which can be mail content.
  it('never logs a database error\'s params', async () => {
    const leaky = new DrizzleQueryError('insert into inbound_emails ...', ['Subject: PO 4471 for ACME'], new Error('boom'))
    const deps = makeDeps(leaky)

    await runAndKick(EXTRACT_URL, SECRET, deps)

    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('PO 4471')
  })

  it('logs a refused poke and does not throw', async () => {
    const deps = makeDeps(SUMMARY, new Response(null, { status: 401 }))

    await expect(runAndKick(EXTRACT_URL, SECRET, deps)).resolves.toBe(SUMMARY)
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('poke refused'), { status: 401 })
  })

  // LOW-T104-2: a redirect or a stray 200 (a login page) is not an accepted poke.
  it.each([307, 200])('logs a %i worker answer as refused, not as success', async (status) => {
    const deps = makeDeps(SUMMARY, new Response(null, { status }))

    await runAndKick(EXTRACT_URL, SECRET, deps)
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('poke refused'), { status })
  })

  it('logs a poke that threw and does not throw', async () => {
    const deps = makeDeps(SUMMARY, new TypeError('fetch failed'))

    await expect(runAndKick(EXTRACT_URL, SECRET, deps)).resolves.toBe(SUMMARY)
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('poke failed'),
      { failure: expect.objectContaining({ error: 'TypeError' }) },
    )
  })

  it('never logs the secret', async () => {
    const deps = makeDeps(new Error('anything'), new TypeError('fetch failed'))

    await runAndKick(EXTRACT_URL, SECRET, deps)

    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(SECRET)
  })
})
