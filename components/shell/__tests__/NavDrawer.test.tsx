import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import NavDrawer from '../NavDrawer'

const mockUsePathname = vi.hoisted(() => vi.fn().mockReturnValue('/dashboard'))

vi.mock('next/navigation', () => ({
  usePathname: mockUsePathname,
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

const EXPECTED_NAV_ORDER = [
  { name: 'Dashboard', href: '/dashboard' },
  { name: 'Customers', href: '/customers' },
  { name: 'Orders', href: '/orders' },
  { name: 'Calendar', href: '/calendar' },
  { name: 'Leads', href: '/leads' },
  { name: 'Invoices', href: '/invoices' },
  { name: 'Support', href: '/support' },
]

beforeEach(() => {
  mockUsePathname.mockReturnValue('/dashboard')
})

describe('NavDrawer', () => {
  it('renders all 7 nav items with correct href values', () => {
    render(<NavDrawer isOpen={true} onClose={vi.fn()} />)

    for (const { name, href } of EXPECTED_NAV_ORDER) {
      expect(screen.getByRole('link', { name: new RegExp(name, 'i') })).toHaveAttribute(
        'href',
        href,
      )
    }
  })

  it('renders the Calendar nav item between Orders and Leads', () => {
    render(<NavDrawer isOpen={true} onClose={vi.fn()} />)

    const hrefs = screen
      .getAllByRole('link')
      .map((link) => link.getAttribute('href'))

    expect(hrefs).toEqual(EXPECTED_NAV_ORDER.map((item) => item.href))
  })

  it('marks Calendar active on /calendar', () => {
    mockUsePathname.mockReturnValue('/calendar')
    render(<NavDrawer isOpen={true} onClose={vi.fn()} />)

    const calendarLink = screen.getByRole('link', { name: /calendar/i })
    expect(calendarLink.className).toContain('border-primary')
    expect(screen.getByRole('link', { name: /orders/i }).className).not.toContain('border-primary')
  })

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn()
    render(<NavDrawer isOpen={true} onClose={onClose} />)

    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement
    fireEvent.click(backdrop)

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn()
    render(<NavDrawer isOpen={true} onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledOnce()
  })

  it('applies teal left border to the active nav item for current pathname', () => {
    render(<NavDrawer isOpen={true} onClose={vi.fn()} />)

    const dashboardLink = screen.getByRole('link', { name: /dashboard/i })
    expect(dashboardLink.className).toContain('border-primary')
  })

  it('renders a Sign Out button at the bottom of the drawer', () => {
    render(<NavDrawer isOpen={true} onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('Sign Out is a submit button wired to the signOut server action via form', () => {
    render(<NavDrawer isOpen={true} onClose={vi.fn()} />)

    const signOutButton = screen.getByRole('button', { name: /sign out/i })
    expect(signOutButton).toHaveAttribute('type', 'submit')
    // Server-action forms attach the action at runtime; verifying the button is a form submit
    // target (has a parent <form>) is the meaningful check here.
    expect(signOutButton.closest('form')).not.toBeNull()
  })
})
