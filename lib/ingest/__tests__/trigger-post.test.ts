import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { postTrigger, TRIGGER_ACCEPTED } from '../trigger-post'

const URL = 'http://localhost:3000/api/ingest/extract'
const SECRET = 'test-trigger-secret-value'
const LABEL = 'fixture: trigger'

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('postTrigger', () => {
  it('POSTs with the bearer secret, refuses redirects, and reports a 202 as accepted', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: TRIGGER_ACCEPTED }))

    expect(await postTrigger(LABEL, URL, SECRET, fetchImpl)).toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith(URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}` },
      redirect: 'manual',
    })
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('passes a timeout signal only when one is asked for', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(null, { status: TRIGGER_ACCEPTED }))

    await postTrigger(LABEL, URL, SECRET, fetchImpl, 1000)
    expect(fetchImpl.mock.calls[0][1]).toHaveProperty('signal')
  })

  // LOW-T104-2: a redirect or a stray 200 (a login page) is not acceptance.
  it.each([200, 307, 401])('logs a %i answer as refused and reports it', async (status) => {
    const fetchImpl = vi.fn(async () => new Response(null, { status }))

    expect(await postTrigger(LABEL, URL, SECRET, fetchImpl)).toBe(false)
    expect(consoleError).toHaveBeenCalledWith(`${LABEL} refused`, { status })
  })

  it('logs a thrown fetch without its message or the secret, and never throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError(`fetch failed for ${SECRET}`)
    })

    expect(await postTrigger(LABEL, URL, SECRET, fetchImpl)).toBe(false)
    expect(consoleError).toHaveBeenCalledWith(`${LABEL} failed`, { failure: expect.objectContaining({ error: 'TypeError' }) })
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(SECRET)
  })
})
