import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import NavDrawer from '../NavDrawer'

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

describe('NavDrawer', () => {
  it('renders all 6 nav items with correct href values', () => {
    render(<NavDrawer isOpen={true} onClose={vi.fn()} />)

    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute('href', '/dashboard')
    expect(screen.getByRole('link', { name: /customers/i })).toHaveAttribute('href', '/customers')
    expect(screen.getByRole('link', { name: /orders/i })).toHaveAttribute('href', '/orders')
    expect(screen.getByRole('link', { name: /leads/i })).toHaveAttribute('href', '/leads')
    expect(screen.getByRole('link', { name: /invoices/i })).toHaveAttribute('href', '/invoices')
    expect(screen.getByRole('link', { name: /support/i })).toHaveAttribute('href', '/support')
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
})
