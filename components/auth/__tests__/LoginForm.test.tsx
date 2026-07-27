import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LoginForm from '../LoginForm'

const mockSignIn = vi.hoisted(() => vi.fn())
const mockPush = vi.hoisted(() => vi.fn())
const mockRefresh = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/auth', () => ({ signIn: mockSignIn }))

// The form routes to /dashboard itself on success — `signIn` deliberately does
// not `redirect()`, because a server-action redirect throws and this action is
// awaited from an event handler rather than a form action.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('LoginForm', () => {
  it('shows validation error on empty submit without calling signIn', async () => {
    render(<LoginForm />)
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Please enter your password.')
    })
    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('calls signIn with entered password on submit', async () => {
    mockSignIn.mockResolvedValueOnce({ error: null })
    render(<LoginForm />)
    const input = screen.getByLabelText('Password')
    fireEvent.change(input, { target: { value: 'my-password' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(mockSignIn).toHaveBeenCalledWith('my-password'))
  })

  it('displays error message returned by signIn', async () => {
    mockSignIn.mockResolvedValueOnce({ error: 'Incorrect password. Please try again.' })
    render(<LoginForm />)
    const input = screen.getByLabelText('Password')
    fireEvent.change(input, { target: { value: 'wrong' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Incorrect password. Please try again.')
    })
  })

  it('does not clear password field on error', async () => {
    mockSignIn.mockResolvedValueOnce({ error: 'Incorrect password. Please try again.' })
    render(<LoginForm />)
    const input = screen.getByLabelText('Password') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'wrong-password' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => screen.getByRole('alert'))
    expect(input.value).toBe('wrong-password')
  })

  it('navigates to /dashboard and refreshes on a successful sign-in', async () => {
    mockSignIn.mockResolvedValueOnce({ error: null })
    render(<LoginForm />)

    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/dashboard'))
    expect(mockRefresh).toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('surfaces an error and stops loading when the action request throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSignIn.mockRejectedValueOnce(new Error('transport failure'))
    render(<LoginForm />)

    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Unable to connect.')
    })
    // The regression this guards: the button must never be left spinning.
    expect(screen.getByRole('button', { name: /sign in/i })).not.toBeDisabled()
    expect(mockPush).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
