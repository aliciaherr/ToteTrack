import { describe, it, expect, vi } from 'vitest'
import { createClient } from '../client'

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: vi.fn(() => ({ auth: {}, from: vi.fn() })),
}))

describe('createClient (browser)', () => {
  it('returns a SupabaseClient without throwing', () => {
    expect(() => createClient()).not.toThrow()
  })

  it('returns an object (SupabaseClient shape)', () => {
    const client = createClient()
    expect(client).toBeDefined()
    expect(typeof client).toBe('object')
  })
})
