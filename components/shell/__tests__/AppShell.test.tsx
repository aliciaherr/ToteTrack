import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import AppShell from '../AppShell'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn().mockReturnValue('/dashboard'),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, onClick, className }: {
    href: string
    children: React.ReactNode
    onClick?: () => void
    className?: string
  }) => (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, initial, animate, exit, variants, transition, ...rest }: any) => (
      <div {...rest}>{children}</div>
    ),
    nav: ({ children, initial, animate, exit, variants, transition, ...rest }: any) => (
      <nav {...rest}>{children}</nav>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}))

vi.mock('@/lib/actions/auth', () => ({
  signOut: vi.fn(),
}))

// NavDrawer's SignOutRow calls useToast, which throws outside a
// <ToastProvider>; the shell tests don't exercise toasts, so stub the hook.
vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))

describe('AppShell', () => {
  it('mounts PillHamburger (not TopBar)', () => {
    render(<AppShell><div>child</div></AppShell>)

    expect(screen.getByRole('button', { name: /open navigation/i })).toBeInTheDocument()
    // TopBar was deleted — the old "Notifications" button should no longer exist
    expect(screen.queryByRole('button', { name: /notifications/i })).not.toBeInTheDocument()
  })

  it('renders children inside <main>', () => {
    render(<AppShell><div data-testid="child">hello</div></AppShell>)

    const main = screen.getByRole('main')
    expect(main).toContainElement(screen.getByTestId('child'))
  })

  it('tapping PillHamburger opens the NavDrawer', () => {
    render(<AppShell><div>child</div></AppShell>)

    // Drawer nav items are not in DOM when closed (AnimatePresence unmounts them)
    expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /open navigation/i }))

    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument()
  })

  it('NavDrawer retains all 6 nav items + Sign Out button (regression guard)', () => {
    render(<AppShell><div>child</div></AppShell>)
    fireEvent.click(screen.getByRole('button', { name: /open navigation/i }))

    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /customers/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /orders/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /leads/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /invoices/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /support/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('does not render any global-search input in chrome', () => {
    render(<AppShell><div>child</div></AppShell>)

    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument()
  })
})
