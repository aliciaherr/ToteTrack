import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/db', () => ({ db: {} }))

import { DrizzleQueryError } from 'drizzle-orm'
import { drainAndChain, type ExtractTriggerDeps } from '../extract-trigger'
import type { BatchSummary } from '../worker'

const SELF_URL = 'http://localhost:3000/api/ingest/extract'
const SECRET = 'test-trigger-secret-value'

function summary(overrides: Partial<BatchSummary> = {}): BatchSummary {
  return { claimed: 1, rowsMayRemain: false, completed: 1, failed: 0, released: 0, stranded: 0, ...overrides }
}

function makeDeps(drained: BatchSummary | Error, fetchResult: Response | Error = new Response(null, { status: 202 })) {
  const deps: ExtractTriggerDeps = {
    drain: vi.fn(() => (drained instanceof Error ? Promise.reject(drained) : Promise.resolve(drained))),
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

describe('drainAndChain — self-chain', () => {
  it('chains exactly once, to itself, with the secret, when rows may remain', async () => {
    const deps = makeDeps(summary({ claimed: 4, rowsMayRemain: true }))

    expect(await drainAndChain(SELF_URL, SECRET, deps)).toBe(true)

    expect(deps.fetch).toHaveBeenCalledTimes(1)
    expect(deps.fetch).toHaveBeenCalledWith(SELF_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}` },
      redirect: 'manual',
    })
  })

  it('does not chain when the queue came back empty', async () => {
    const deps = makeDeps(summary({ rowsMayRemain: false }))

    expect(await drainAndChain(SELF_URL, SECRET, deps)).toBe(false)
    expect(deps.fetch).not.toHaveBeenCalled()
  })

  // MEDIUM-10: released rows are claimed but must wait out the retry delay.
  it('does not chain on rows claimed and released when none may remain', async () => {
    const deps = makeDeps(summary({ claimed: 4, completed: 0, released: 4, rowsMayRemain: false }))

    expect(await drainAndChain(SELF_URL, SECRET, deps)).toBe(false)
    expect(deps.fetch).not.toHaveBeenCalled()
  })
})

describe('drainAndChain — failures are logged, never thrown', () => {
  it('logs a batch-stopping error through loggableFailure and does not chain', async () => {
    const leaky = new DrizzleQueryError('select … params: Acme Corp PO-991', ['Acme Corp PO-991'])
    const deps = makeDeps(leaky)

    expect(await drainAndChain(SELF_URL, SECRET, deps)).toBe(false)

    expect(deps.fetch).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith('extractTrigger: batch stopped; not chaining', {
      failure: expect.objectContaining({ error: 'DrizzleQueryError' }),
    })
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('Acme Corp')
  })

  it('logs a refused self-chain with its status', async () => {
    const deps = makeDeps(summary({ rowsMayRemain: true }), new Response(null, { status: 401 }))

    expect(await drainAndChain(SELF_URL, SECRET, deps)).toBe(true)
    expect(consoleError).toHaveBeenCalledWith('extractTrigger: self-chain refused', { status: 401 })
  })

  // LOW-T104-2: a redirect or a stray 200 (a login page) is not an accepted chain.
  it.each([307, 200])('logs a %i self-chain answer as refused, not as success', async (status) => {
    const deps = makeDeps(summary({ rowsMayRemain: true }), new Response(null, { status }))

    await drainAndChain(SELF_URL, SECRET, deps)
    expect(consoleError).toHaveBeenCalledWith('extractTrigger: self-chain refused', { status })
  })

  it('logs a self-chain network failure without throwing, and never logs the secret', async () => {
    const deps = makeDeps(summary({ rowsMayRemain: true }), new TypeError('fetch failed'))

    await expect(drainAndChain(SELF_URL, SECRET, deps)).resolves.toBe(true)
    expect(consoleError).toHaveBeenCalledWith('extractTrigger: self-chain failed', {
      failure: expect.objectContaining({ error: 'TypeError' }),
    })
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(SECRET)
  })
})
