import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import AppShell from '../AppShell'
import { getIngestStatus } from '@/lib/actions/ingest'

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

// The motion-only props are named so they are stripped from `rest` and never
// reach a real DOM node. A `type` is erased, so the hoisted factory can use it.
type MotionMockProps = Record<string, unknown> & { children?: React.ReactNode }

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, initial, animate, exit, variants, transition, ...rest }: MotionMockProps) =>
      <div {...rest}>{children}</div>,
    nav: ({ children, initial, animate, exit, variants, transition, ...rest }: MotionMockProps) =>
      <nav {...rest}>{children}</nav>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}))

vi.mock('@/lib/actions/auth', () => ({
  signOut: vi.fn(),
}))

// The review-queue status reaches the DB through a server action; the shell
// tests cover layout only, so it reports an empty queue.
vi.mock('@/lib/actions/ingest', () => ({
  getIngestStatus: vi.fn(async () => ({ toReview: 0, beingRead: 0, lastRunAt: null, failingCount: 0 })),
  triggerIngestion: vi.fn(),
}))

// The review overlay reads through server actions; one queued email-body PO.
vi.mock('@/lib/actions/review', () => ({
  getReviewQueue: vi.fn(async () => ({ ids: ['11111111-1111-1111-1111-111111111111'] })),
  getReviewSource: vi.fn(async () => ({ source: { kind: 'text', text: 'PO 4471' } })),
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

  it('shows the undecided count on the menu button and the review queue in the drawer', async () => {
    vi.mocked(getIngestStatus).mockResolvedValue({ toReview: 2, beingRead: 1, lastRunAt: null, failingCount: 0 })
    render(<AppShell><div>child</div></AppShell>)

    expect(await screen.findByTestId('pending-badge')).toHaveTextContent('3')

    const callsBeforeOpen = vi.mocked(getIngestStatus).mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: /open navigation/i }))

    expect(screen.getByRole('region', { name: 'Review queue' })).toBeInTheDocument()
    // Opening the drawer re-reads the status.
    await waitFor(() => expect(vi.mocked(getIngestStatus).mock.calls.length).toBeGreaterThan(callsBeforeOpen))
  })

  it('hides the badge when the status cannot be read', async () => {
    vi.mocked(getIngestStatus).mockResolvedValue({ error: 'Something went wrong. Please try again.' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AppShell><div>child</div></AppShell>)

    await waitFor(() => expect(getIngestStatus).toHaveBeenCalled())
    expect(screen.queryByTestId('pending-badge')).not.toBeInTheDocument()
    vi.mocked(console.error).mockRestore()
  })

  it('"Review" closes the drawer and opens the overlay; Esc closes it and focuses the menu button', async () => {
    vi.mocked(getIngestStatus).mockResolvedValue({ toReview: 1, beingRead: 0, lastRunAt: null, failingCount: 0 })
    render(<AppShell><div>child</div></AppShell>)
    await screen.findByTestId('pending-badge')
    fireEvent.click(screen.getByRole('button', { name: /open navigation/i }))

    fireEvent.click(await screen.findByRole('button', { name: 'Review' }))

    expect(screen.getByRole('dialog', { name: 'Review' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Review queue' })).not.toBeInTheDocument()
    expect(await screen.findByText('PO 4471')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Review' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open navigation/i })).toHaveFocus()
    expect(screen.getByText('child')).toBeInTheDocument()
  })
})
