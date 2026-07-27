import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSignInWithPassword = vi.hoisted(() => vi.fn())
const mockSignOut = vi.hoisted(() => vi.fn())
const mockGetUser = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signOut: mockSignOut,
      getUser: mockGetUser,
    },
  }),
}))

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

import { signIn, signOut } from '../auth'
import { redirect } from 'next/navigation'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ADMIN_EMAIL = 'admin@totetrack.app'
})

describe('signIn', () => {
  // The previous version of this test asserted BOTH that `redirect` was called
  // and that the function returned — which can only hold when `redirect` is
  // mocked to a no-op. The real `redirect()` throws, so the return was dead
  // code in production and the awaited call in `LoginForm` rejected silently.
  // `signIn` now returns instead; the caller routes.
  it('correct password: returns { error: null } and does NOT redirect', async () => {
    mockSignInWithPassword.mockResolvedValueOnce({ error: null })
    const result = await signIn('correct-password')
    expect(result).toEqual({ error: null })
    expect(redirect).not.toHaveBeenCalled()
  })

  it('wrong password: returns incorrect password error', async () => {
    mockSignInWithPassword.mockResolvedValueOnce({
      error: { message: 'Invalid login credentials', status: 400 },
    })
    const result = await signIn('wrong-password')
    expect(result).toEqual({ error: 'Incorrect password. Please try again.' })
    expect(redirect).not.toHaveBeenCalled()
  })

  it('network error: returns connection error', async () => {
    mockSignInWithPassword.mockRejectedValueOnce(new Error('Network failure'))
    const result = await signIn('any-password')
    expect(result).toEqual({ error: 'Unable to connect. Check your internet connection.' })
  })

  it('missing ADMIN_EMAIL: returns connection error', async () => {
    delete process.env.ADMIN_EMAIL
    const result = await signIn('any-password')
    expect(result).toEqual({ error: 'Unable to connect. Check your internet connection.' })
  })
})

describe('signOut', () => {
  it('signs out and redirects to /login', async () => {
    mockSignOut.mockResolvedValueOnce({})
    await signOut()
    expect(mockSignOut).toHaveBeenCalled()
    expect(redirect).toHaveBeenCalledWith('/login')
  })
})
