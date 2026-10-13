import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetUser = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: mockGetUser } }),
}))

import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'
import { triggerIngestion } from '../ingest'

const SECRET = 'test-trigger-secret-value'
const ORIGIN = 'http://localhost:3000'
const AUTH_OK = { data: { user: { id: 'user-1' } }, error: null }
const NO_SESSION = { data: { user: null }, error: null }

let fetchMock: ReturnType<typeof vi.fn>
let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.stubEnv('INGEST_TRIGGER_SECRET', SECRET)
  vi.stubEnv('INGEST_APP_ORIGIN', ORIGIN)
  fetchMock = vi.fn(async () => new Response(null, { status: 202 }))
  vi.stubGlobal('fetch', fetchMock)
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  mockGetUser.mockResolvedValue(AUTH_OK)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  mockGetUser.mockReset()
})

describe('triggerIngestion', () => {
  it('POSTs the run route once with the bearer secret and reports acceptance', async () => {
    expect(await triggerIngestion()).toEqual({ accepted: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${ORIGIN}/api/ingest/run`)
    expect(init).toMatchObject({ method: 'POST', headers: { authorization: `Bearer ${SECRET}` }, redirect: 'manual' })
  })

  it('refuses without a session and makes no fetch', async () => {
    mockGetUser.mockResolvedValue(NO_SESSION)

    expect(await triggerIngestion()).toEqual({ error: 'You are not signed in.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['INGEST_APP_ORIGIN', 'INGEST_TRIGGER_SECRET'])('fails loudly, naming %s, when it is unset', async (variable) => {
    vi.stubEnv(variable, '')

    expect(await triggerIngestion()).toEqual({ error: GENERIC_FAILURE_MESSAGE })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('could not start'),
      expect.objectContaining({ variable }),
    )
  })

  it('rejects an origin that is not http(s)', async () => {
    vi.stubEnv('INGEST_APP_ORIGIN', 'ftp://example.invalid')

    expect(await triggerIngestion()).toEqual({ error: GENERIC_FAILURE_MESSAGE })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a refused trigger as an error and logs the status', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }))

    expect(await triggerIngestion()).toEqual({ error: GENERIC_FAILURE_MESSAGE })
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('refused'), { status: 401 })
  })

  it('reports a network failure as an error and never logs the secret', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    expect(await triggerIngestion()).toEqual({ error: GENERIC_FAILURE_MESSAGE })
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(SECRET)
  })
})
