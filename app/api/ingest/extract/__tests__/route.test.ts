import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockAfter = vi.hoisted(() => vi.fn())
const mockDrainAndChain = vi.hoisted(() => vi.fn())

vi.mock('next/server', () => ({ after: mockAfter }))
vi.mock('@/lib/ingest/extract-trigger', () => ({ drainAndChain: mockDrainAndChain }))

import { EXTRACTION_TIMEOUT_MS, PDF_RENDER_TIMEOUT_MS } from '@/lib/extraction/extraction.constants'
import { EXTRACTION_CLAIM_CUTOFF_MS, EXTRACTION_LEASE_MS } from '@/lib/ingest/ingest.constants'
import { POST, maxDuration } from '../route'
import * as routeModule from '../route'

const SECRET = 'test-trigger-secret-value'
const URL = 'http://localhost:3000/api/ingest/extract'

function post(headers: Record<string, string> = {}): Request {
  return new Request(URL, { method: 'POST', headers })
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.stubEnv('INGEST_TRIGGER_SECRET', SECRET)
  vi.stubEnv('INGEST_APP_ORIGIN', 'http://localhost:3000')
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  mockAfter.mockReset()
  mockDrainAndChain.mockReset()
})

describe('POST /api/ingest/extract', () => {
  it('answers 202 and defers the batch to after(), not running it inline', async () => {
    const response = await POST(post({ authorization: `Bearer ${SECRET}` }))

    expect(response.status).toBe(202)
    expect(mockAfter).toHaveBeenCalledTimes(1)
    expect(mockDrainAndChain).not.toHaveBeenCalled()

    await mockAfter.mock.calls[0][0]()
    expect(mockDrainAndChain).toHaveBeenCalledWith(URL, SECRET)
  })

  it('answers 401 for a wrong secret and schedules nothing', async () => {
    const response = await POST(post({ authorization: 'Bearer wrong-secret' }))

    expect(response.status).toBe(401)
    expect(mockAfter).not.toHaveBeenCalled()
  })

  it('answers 401 for a missing header and schedules nothing', async () => {
    const response = await POST(post())

    expect(response.status).toBe(401)
    expect(mockAfter).not.toHaveBeenCalled()
  })

  it('answers 500 and logs loudly when the secret is unset, never opening up', async () => {
    vi.stubEnv('INGEST_TRIGGER_SECRET', '')

    const response = await POST(post({ authorization: 'Bearer ' }))

    expect(response.status).toBe(500)
    expect(mockAfter).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('ingestExtractRoute'),
      { failure: expect.objectContaining({ error: 'IngestConfigError' }) },
    )
  })

  // LOW-T116-1: the self-chain targets the configured origin, never the
  // host the caller named.
  it('chains to INGEST_APP_ORIGIN even when the request names another host', async () => {
    const spoofed = new Request('http://attacker.example/api/ingest/extract', {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}` },
    })

    await POST(spoofed)
    await mockAfter.mock.calls[0][0]()

    expect(mockDrainAndChain).toHaveBeenCalledWith(URL, SECRET)
  })

  it('answers 500 and logs loudly when INGEST_APP_ORIGIN is unset', async () => {
    vi.stubEnv('INGEST_APP_ORIGIN', '')

    const response = await POST(post({ authorization: `Bearer ${SECRET}` }))

    expect(response.status).toBe(500)
    expect(mockAfter).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('INGEST_APP_ORIGIN'),
      { failure: expect.objectContaining({ error: 'IngestConfigError' }) },
    )
  })

  it('never logs or echoes the secret', async () => {
    const response = await POST(post({ authorization: 'Bearer wrong-secret' }))

    expect(await response.text()).not.toContain('wrong-secret')
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(SECRET)
  })
})

describe('route config', () => {
  it('fits a late-claimed row, a full render and a full model call inside maxDuration (M-04)', () => {
    const worstRow = EXTRACTION_CLAIM_CUTOFF_MS + PDF_RENDER_TIMEOUT_MS + EXTRACTION_TIMEOUT_MS
    expect(worstRow).toBeLessThan(maxDuration * 1000)
  })

  it('keeps the lease longer than maxDuration, so a live row is never reclaimed', () => {
    expect(EXTRACTION_LEASE_MS).toBeGreaterThan(maxDuration * 1000)
  })

  it('exports only route handlers and segment config', () => {
    expect(Object.keys(routeModule).sort()).toEqual(['POST', 'maxDuration'])
  })
})
