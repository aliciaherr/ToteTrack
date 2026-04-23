import { describe, it, expect, vi } from 'vitest'

const mockCookies = vi.hoisted(() =>
  vi.fn(() => ({ getAll: () => [], set: vi.fn() }))
)

vi.mock('next/headers', () => ({ cookies: mockCookies }))
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({ auth: {}, from: vi.fn() })),
}))

import { createClient } from '../server'

describe('createClient (server)', () => {
  it('returns a SupabaseClient without throwing in server context', () => {
    expect(() => createClient()).not.toThrow()
  })

  it('throws with context when cookies() is unavailable', () => {
    mockCookies.mockImplementationOnce(() => {
      throw new Error('Not a server context')
    })
    expect(() => createClient()).toThrow('called outside server context')
  })
})
