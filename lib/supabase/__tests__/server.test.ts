import { describe, it, expect, vi } from 'vitest'

const mockCookies = vi.hoisted(() =>
  vi.fn(() => ({ getAll: () => [], set: vi.fn() }))
)

vi.mock('next/headers', () => ({ cookies: mockCookies }))
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({ auth: {}, from: vi.fn() })),
}))

import { createClient } from '../server'

// `createClient` became async in the Next 15 upgrade (Task 83) because
// `cookies()` is async there. The failure it guards is unchanged — a call from
// outside a server context — but it now surfaces as a rejection rather than a
// synchronous throw, so both assertions are awaited. The expected message is
// deliberately identical to the pre-upgrade one.
describe('createClient (server)', () => {
  it('returns a SupabaseClient without throwing in server context', async () => {
    await expect(createClient()).resolves.toBeDefined()
  })

  it('rejects with context when cookies() is unavailable', async () => {
    mockCookies.mockImplementationOnce(() => {
      throw new Error('Not a server context')
    })
    await expect(createClient()).rejects.toThrow('called outside server context')
  })
})
