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
})
