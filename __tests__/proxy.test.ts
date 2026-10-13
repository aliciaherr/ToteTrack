import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockGetUser = vi.hoisted(() => vi.fn())
const mockCreateServerClient = vi.hoisted(() => vi.fn())
const mockNextResponseNext = vi.hoisted(() => vi.fn())

vi.mock('@supabase/ssr', () => ({
  createServerClient: mockCreateServerClient,
}))

vi.mock('next/server', () => ({
  NextResponse: { next: mockNextResponseNext },
}))

import { proxy, config } from '../proxy'

/**
 * Builds a NextRequest-shaped double carrying only what `proxy` reads:
 * the incoming cookie jar and the pathname used in the failure log.
 */
function buildRequest(pathname = '/dashboard') {
  return {
    cookies: { getAll: vi.fn(() => []), set: vi.fn() },
    nextUrl: { pathname },
  } as never
}

function buildResponse() {
  return { cookies: { set: vi.fn() } }
}

describe('proxy (session refresh)', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-for-test')
    mockNextResponseNext.mockImplementation(() => buildResponse())
    mockCreateServerClient.mockImplementation(() => ({
      auth: { getUser: mockGetUser },
    }))
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('refreshes the session and returns a response when Supabase is reachable', async () => {
    const result = await proxy(buildRequest())

    expect(mockGetUser).toHaveBeenCalledTimes(1)
    expect(result).toBeDefined()
  })

  it('reads Supabase credentials from the environment rather than a literal', async () => {
    await proxy(buildRequest())

    expect(mockCreateServerClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon-key-for-test',
      expect.anything()
    )
  })

  // The catch in `proxy` is deliberate, not an oversight: the access control is
  // the redirect in app/(app)/layout.tsx, and throwing here would 500 every
  // matched route including /login. These two tests pin that behaviour so a
  // future edit cannot quietly turn a Supabase outage into a full lockout.
  it('returns a response instead of throwing when the session refresh fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetUser.mockRejectedValueOnce(new Error('supabase unreachable'))

    const result = await proxy(buildRequest('/orders'))

    expect(result).toBeDefined()
    consoleError.mockRestore()
  })

  it('logs the failed refresh loudly with the pathname and the cause', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cause = new Error('supabase unreachable')
    mockGetUser.mockRejectedValueOnce(cause)

    await proxy(buildRequest('/orders'))

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('session refresh failed'),
      expect.objectContaining({ pathname: '/orders', cause })
    )
    consoleError.mockRestore()
  })

  // Task 116: the extraction route has no session, only its shared secret.
  // The proxy must pass it through, never redirect it to /login.
  it('passes a session-less call to the extraction route straight through', async () => {
    const passThrough = buildResponse()
    mockNextResponseNext.mockReturnValueOnce(passThrough)

    const result = await proxy(buildRequest('/api/ingest/extract'))

    expect(result).toBe(passThrough)
  })

  // Task 104: the cron and manual trigger route is session-less too.
  it('passes a session-less call to the ingestion run route straight through', async () => {
    const passThrough = buildResponse()
    mockNextResponseNext.mockReturnValueOnce(passThrough)

    const result = await proxy(buildRequest('/api/ingest/run'))

    expect(result).toBe(passThrough)
  })
})

// Next compiles `config.matcher` into an anchored pattern and tests it against
// the full pathname, leading slash included — so the assertions below anchor it
// the same way rather than relying on a partial match.
describe('proxy matcher config', () => {
  const anchoredMatcher = () => new RegExp(`^${config.matcher[0]}$`)

  it('excludes the static, image and favicon paths from the proxy', () => {
    const pattern = anchoredMatcher()

    expect(pattern.test('/_next/static/chunk.js')).toBe(false)
    expect(pattern.test('/_next/image')).toBe(false)
    expect(pattern.test('/favicon.ico')).toBe(false)
  })

  it('matches the authenticated routes the session refresh must cover', () => {
    const pattern = anchoredMatcher()

    expect(pattern.test('/dashboard')).toBe(true)
    expect(pattern.test('/orders')).toBe(true)
    expect(pattern.test('/login')).toBe(true)
  })
})
