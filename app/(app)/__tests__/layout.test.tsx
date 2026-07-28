import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}))

// In the real App Router `redirect()` throws NEXT_REDIRECT, so nothing after
// it runs. The mock throws too — that is what proves the layout never reaches
// its JSX (children are not rendered) when the guard fires.
const mockRedirect = vi.hoisted(() =>
  vi.fn((url: string): never => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
)

vi.mock('next/navigation', () => ({ redirect: mockRedirect }))

// The layout under test is only the guard — the shell it wraps children in is
// out of scope, so both wrappers become pass-throughs.
vi.mock('@/components/shell/AppShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/shell/ToastProvider', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

import AppLayout from '../layout'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('app/(app)/layout — read-path access-control gate', () => {
  it('redirects to /login when no user is signed in', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null })

    // The redirect throw rejects the layout before any JSX exists — children
    // are never rendered for an anonymous visitor.
    await expect(AppLayout({ children: <div>protected content</div> })).rejects.toThrow(
      'NEXT_REDIRECT:/login',
    )
    expect(mockRedirect).toHaveBeenCalledWith('/login')
  })

  it('redirects to /login when getUser returns an error', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: { message: 'Auth session missing!', status: 400 },
    })

    await expect(AppLayout({ children: <div>protected content</div> })).rejects.toThrow(
      'NEXT_REDIRECT:/login',
    )
    expect(mockRedirect).toHaveBeenCalledWith('/login')
  })

  it('renders children when a user is authenticated', async () => {
    mockGetUser.mockResolvedValueOnce({
      // Arbitrary placeholder — the guard checks user presence only, and the
      // real admin email must never appear in source (CONSTRAINT-04).
      data: { user: { id: 'user-1', email: 'user@example.com' } },
      error: null,
    })

    render(await AppLayout({ children: <div>protected content</div> }))

    expect(screen.getByText('protected content')).toBeInTheDocument()
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})
