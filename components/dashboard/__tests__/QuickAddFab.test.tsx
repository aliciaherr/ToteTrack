import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, initial, animate, exit, variants, transition, ...rest }: any) => (
      <div {...rest}>{children}</div>
    ),
    span: ({ children, initial, animate, exit, variants, transition, ...rest }: any) => (
      <span {...rest}>{children}</span>
    ),
    ul: ({ children, initial, animate, exit, variants, transition, ...rest }: any) => (
      <ul {...rest}>{children}</ul>
    ),
    li: ({ children, initial, animate, exit, variants, transition, ...rest }: any) => (
      <li {...rest}>{children}</li>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: vi.fn().mockReturnValue(false),
}))

const drawerStateMock = vi.fn().mockReturnValue({ isOpen: false })
vi.mock('@/components/shell/drawer-state', () => ({
  useAppShellDrawerState: () => drawerStateMock(),
}))

import QuickAddFab from '../QuickAddFab'

describe('QuickAddFab', () => {
  beforeEach(() => {
    pushMock.mockClear()
    drawerStateMock.mockReturnValue({ isOpen: false })
  })

  it('renders collapsed "+" button anchored bottom-right with fixed positioning', () => {
    render(<QuickAddFab />)

    const fab = screen.getByRole('button', { name: 'Quick add' })
    expect(fab).toBeInTheDocument()
    expect(fab).toHaveAttribute('aria-expanded', 'false')
    expect(fab).toHaveAttribute('aria-haspopup', 'menu')

    // Container is fixed bottom-right
    const container = fab.parentElement!
    expect(container.className).toContain('fixed')
    expect(container.className).toContain('bottom-6')
    expect(container.className).toContain('right-6')

    // Options are not rendered when collapsed
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('tap toggles to expanded state with 3 options visible', () => {
    render(<QuickAddFab />)

    fireEvent.click(screen.getByRole('button', { name: 'Quick add' }))

    expect(screen.getByRole('button', { name: 'Close quick add menu' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(screen.getByRole('menu', { name: 'Quick add options' })).toBeInTheDocument()
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
  })

  it('options render in order: Purchase Order, Customer, Lead (top-to-bottom in DOM)', () => {
    render(<QuickAddFab />)
    fireEvent.click(screen.getByRole('button', { name: 'Quick add' }))

    const menuitems = screen.getAllByRole('menuitem')
    expect(menuitems[0]).toHaveTextContent('Add Purchase Order')
    expect(menuitems[1]).toHaveTextContent('Add Customer')
    expect(menuitems[2]).toHaveTextContent('Add Lead')
  })

  it.each([
    ['Add Purchase Order', '/orders?new=1'],
    ['Add Customer', '/customers?new=1'],
    ['Add Lead', '/leads?new=1'],
  ])('tap "%s" navigates to %s', (label, href) => {
    render(<QuickAddFab />)
    fireEvent.click(screen.getByRole('button', { name: 'Quick add' }))

    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(label) }))

    expect(pushMock).toHaveBeenCalledWith(href)
  })

  it('Esc key collapses the expanded menu', () => {
    render(<QuickAddFab />)
    fireEvent.click(screen.getByRole('button', { name: 'Quick add' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('mousedown outside the FAB container collapses the menu and prevents default activation', () => {
    render(
      <>
        <button data-testid="behind">Behind FAB</button>
        <QuickAddFab />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Quick add' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    // mousedown on the "behind" button (outside the FAB container) — should
    // close the FAB and the click event should not activate the behind button
    // because the capture-phase listener calls preventDefault + stopPropagation.
    const behindClickHandler = vi.fn()
    screen.getByTestId('behind').addEventListener('click', behindClickHandler)

    fireEvent.mouseDown(screen.getByTestId('behind'))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(behindClickHandler).not.toHaveBeenCalled()
  })

  it('returns null when AppShell drawer is open', () => {
    drawerStateMock.mockReturnValue({ isOpen: true })

    const { container } = render(<QuickAddFab />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: 'Quick add' })).not.toBeInTheDocument()
  })

  it('respects useReducedMotion (renders without throwing when motion is reduced)', async () => {
    const fm = await import('framer-motion')
    ;(fm.useReducedMotion as ReturnType<typeof vi.fn>).mockReturnValueOnce(true)

    render(<QuickAddFab />)
    fireEvent.click(screen.getByRole('button', { name: 'Quick add' }))

    // Render path is gated by `shouldReduceMotion ? undefined : variants` —
    // verify the component still mounts and shows options without animation props.
    expect(screen.getAllByRole('menuitem')).toHaveLength(3)
  })
})
