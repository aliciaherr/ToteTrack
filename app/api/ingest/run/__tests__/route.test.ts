import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockAfter = vi.hoisted(() => vi.fn())
const mockRunAndKick = vi.hoisted(() => vi.fn())

vi.mock('next/server', () => ({ after: mockAfter }))
vi.mock('@/lib/ingest/run-trigger', () => ({ runAndKick: mockRunAndKick }))

import {
  IMAP_CONNECTION_TIMEOUT_MS,
  IMAP_GREETING_TIMEOUT_MS,
  IMAP_SOCKET_TIMEOUT_MS,
} from '@/lib/ingest/limits.constants'
import { GET, POST, maxDuration } from '../route'
import * as routeModule from '../route'

const CRON = 'test-cron-secret-value'
const TRIGGER = 'test-trigger-secret-value'
const URL = 'http://localhost:3000/api/ingest/run'
const EXTRACT_URL = 'http://localhost:3000/api/ingest/extract'

function request(method: 'GET' | 'POST', secret?: string): Request {
  const headers: Record<string, string> = secret === undefined ? {} : { authorization: `Bearer ${secret}` }
  return new Request(URL, { method, headers })
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.stubEnv('CRON_SECRET', CRON)
  vi.stubEnv('INGEST_TRIGGER_SECRET', TRIGGER)
  vi.stubEnv('INGEST_APP_ORIGIN', 'http://localhost:3000')
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  mockAfter.mockReset()
  mockRunAndKick.mockReset()
})

describe.each([
  { method: 'GET' as const, handler: GET, own: CRON, other: TRIGGER, variable: 'CRON_SECRET' },
  { method: 'POST' as const, handler: POST, own: TRIGGER, other: CRON, variable: 'INGEST_TRIGGER_SECRET' },
])('$method /api/ingest/run', ({ method, handler, own, other, variable }) => {
  it('answers 202 and defers the run to after(), poking the worker with the trigger secret', async () => {
    const response = await handler(request(method, own))

    expect(response.status).toBe(202)
    expect(mockAfter).toHaveBeenCalledTimes(1)
    expect(mockRunAndKick).not.toHaveBeenCalled()

    await mockAfter.mock.calls[0][0]()
    expect(mockRunAndKick).toHaveBeenCalledWith(EXTRACT_URL, TRIGGER)
  })

  it('answers 401 for the other method\'s secret, so neither secret opens both', async () => {
    const response = await handler(request(method, other))

    expect(response.status).toBe(401)
    expect(mockAfter).not.toHaveBeenCalled()
  })

  it('answers 401 for a missing header', async () => {
    const response = await handler(request(method))

    expect(response.status).toBe(401)
    expect(mockAfter).not.toHaveBeenCalled()
  })

  it('answers 500 and logs the variable when its secret is unset, never opening up', async () => {
    vi.stubEnv(variable, '')

    const response = await handler(request(method, ''))

    expect(response.status).toBe(500)
    expect(mockAfter).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('ingestRunRoute'),
      expect.objectContaining({ variable }),
    )
  })

  it('never logs or echoes a secret', async () => {
    const response = await handler(request(method, 'wrong-secret'))

    expect(await response.text()).not.toContain('wrong-secret')
    const logged = JSON.stringify(consoleError.mock.calls)
    expect(logged).not.toContain(CRON)
    expect(logged).not.toContain(TRIGGER)
  })
})

describe('GET without the worker secret', () => {
  it('answers 500 after a valid cron call, because the run could not poke the worker', async () => {
    vi.stubEnv('INGEST_TRIGGER_SECRET', '')

    const response = await GET(request('GET', CRON))

    expect(response.status).toBe(500)
    expect(mockAfter).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('ingestRunRoute'),
      expect.objectContaining({ variable: 'INGEST_TRIGGER_SECRET' }),
    )
  })
})

// LOW-T104-1: the worker secret goes to the configured origin, never to the
// host the caller named.
describe('worker poke target', () => {
  it('pokes INGEST_APP_ORIGIN even when the request names another host', async () => {
    const spoofed = new Request('http://attacker.example/api/ingest/run', {
      method: 'GET',
      headers: { authorization: `Bearer ${CRON}` },
    })

    await GET(spoofed)
    await mockAfter.mock.calls[0][0]()

    expect(mockRunAndKick).toHaveBeenCalledWith(EXTRACT_URL, TRIGGER)
  })

  it('answers 500 and logs the variable when INGEST_APP_ORIGIN is unset', async () => {
    vi.stubEnv('INGEST_APP_ORIGIN', '')

    const response = await POST(request('POST', TRIGGER))

    expect(response.status).toBe(500)
    expect(mockAfter).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('ingestRunRoute'),
      expect.objectContaining({ variable: 'INGEST_APP_ORIGIN' }),
    )
  })
})

describe('route config', () => {
  it('stays within the Hobby + Fluid Compute ceiling of 300 seconds', () => {
    expect(maxDuration).toBeLessThanOrEqual(300)
  })

  // A stalled mailbox must fail inside the invocation, so the run still logs,
  // writes no state and pokes the worker, instead of being killed silently.
  it('keeps a connect, a greeting and one idle read, each timing out, well inside maxDuration', () => {
    const worstStall = IMAP_CONNECTION_TIMEOUT_MS + IMAP_GREETING_TIMEOUT_MS + IMAP_SOCKET_TIMEOUT_MS
    expect(worstStall).toBeLessThanOrEqual((maxDuration * 1000) / 2)
  })

  it('exports only route handlers and segment config', () => {
    expect(Object.keys(routeModule).sort()).toEqual(['GET', 'POST', 'maxDuration'])
  })
})
