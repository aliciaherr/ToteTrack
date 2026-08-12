import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import AppError from '../error'

vi.mock('next/link', () => ({
  default: ({ href, children, className }: {
    href: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))

// A message a real DB failure could plausibly carry. Every assertion below
// checks this string never reaches the DOM.
const LEAKY_MESSAGE = 'connect ECONNREFUSED db.internal:5432 for customer 4821'

function makeError() {
  const error = new Error(LEAKY_MESSAGE) as Error & { digest?: string }
  error.digest = '2748399174'
  return error
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('AppError', () => {
  it('renders the fallback message and a Try again button', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AppError error={makeError()} reset={() => {}} />)

    expect(screen.getByText('Something went wrong.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to dashboard/i })).toHaveAttribute(
      'href',
      '/dashboard'
    )
  })

  it('calls reset when Try again is clicked', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const reset = vi.fn()
    render(<AppError error={makeError()} reset={reset} />)

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('does not render the raw error message or digest in the DOM', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(<AppError error={makeError()} reset={() => {}} />)

    expect(container.textContent).not.toContain(LEAKY_MESSAGE)
    expect(container.textContent).not.toContain('ECONNREFUSED')
    expect(container.textContent).not.toContain('2748399174')
  })

  it('logs the message, digest and stack to console.error', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<AppError error={makeError()} reset={() => {}} />)

    expect(consoleError).toHaveBeenCalledWith(
      '[AppError] Unhandled error in an authenticated route.',
      expect.objectContaining({ message: LEAKY_MESSAGE, digest: '2748399174' })
    )
  })
})
