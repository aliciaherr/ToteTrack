import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import PillHamburger from '../PillHamburger'

describe('PillHamburger', () => {
  it('renders a 44x44 fixed button anchored top-left', () => {
    render(<PillHamburger onClick={vi.fn()} />)

    const button = screen.getByRole('button', { name: /open navigation/i })
    expect(button.className).toContain('fixed')
    expect(button.className).toContain('top-6')
    expect(button.className).toContain('left-6')
    expect(button.className).toContain('w-11')
    expect(button.className).toContain('h-11')
  })

  it('has the white-pill + subtle-shadow styling', () => {
    render(<PillHamburger onClick={vi.fn()} />)

    const button = screen.getByRole('button', { name: /open navigation/i })
    expect(button.className).toContain('rounded-full')
    expect(button.className).toContain('bg-card')
    expect(button.className).toContain('shadow-md')
  })

  it('has aria-label="Open navigation"', () => {
    render(<PillHamburger onClick={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Open navigation' })).toBeInTheDocument()
  })

  it('fires onClick on tap', () => {
    const onClick = vi.fn()
    render(<PillHamburger onClick={onClick} />)

    fireEvent.click(screen.getByRole('button', { name: /open navigation/i }))

    expect(onClick).toHaveBeenCalledOnce()
  })

  it('is a native <button type="button"> so Enter/Space activate it without extra handlers', () => {
    render(<PillHamburger onClick={vi.fn()} />)

    const button = screen.getByRole('button', { name: /open navigation/i })
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')
  })

  describe('review-queue badge (Task 105)', () => {
    it('shows the undecided count and names it for screen readers', () => {
      render(<PillHamburger onClick={vi.fn()} pendingCount={7} />)

      expect(screen.getByTestId('pending-badge')).toHaveTextContent('7')
      expect(screen.getByRole('button', { name: 'Open navigation, 7 pending' })).toBeInTheDocument()
    })

    it('caps the number at 99+', () => {
      render(<PillHamburger onClick={vi.fn()} pendingCount={140} />)

      expect(screen.getByTestId('pending-badge')).toHaveTextContent('99+')
    })

    it('shows no badge when nothing is pending', () => {
      render(<PillHamburger onClick={vi.fn()} pendingCount={0} needsAttention />)

      expect(screen.queryByTestId('pending-badge')).not.toBeInTheDocument()
    })

    it('turns warning-coloured when the queue needs attention', () => {
      render(<PillHamburger onClick={vi.fn()} pendingCount={2} needsAttention />)

      const badge = screen.getByTestId('pending-badge')
      expect(badge).toHaveAttribute('data-attention', 'true')
      // amber-700 under white text clears 4.5:1; amber-500 (~2.1:1) did not.
      expect(badge.className).toContain('bg-amber-700')
      expect(badge.className).toContain('text-white')
      expect(badge.className).not.toContain('bg-amber-500')
    })

    it('keeps the white-on-teal colouring when nothing needs attention', () => {
      render(<PillHamburger onClick={vi.fn()} pendingCount={2} />)

      const badge = screen.getByTestId('pending-badge')
      expect(badge.className).toContain('bg-primary')
      expect(badge.className).not.toContain('bg-amber')
    })
  })
})
