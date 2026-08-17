import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LoginForm from '../LoginForm'

const mockSignIn = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/auth', () => ({ signIn: mockSignIn }))

beforeEach(() => {
  vi.clearAllMocks()
})

// The EH-01 test spies on `console.error`. Restoring only at the end of that
// test body would leave the spy installed if the test failed mid-way, silencing
// `console.error` for every test that runs after it in this file.
afterEach(() => {
  vi.restoreAllMocks()
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

  // Regression guard for the EH-01 fix: wrapping the `await` in try/catch must
  // not intercept the returned-`{ error }` path — the server's own specific
  // message has to keep reaching the user rather than being flattened to the
  // generic one — and `finally` must still re-enable the button.
  it('displays error message returned by signIn', async () => {
    mockSignIn.mockResolvedValueOnce({ error: 'Incorrect password. Please try again.' })
    render(<LoginForm />)
    const input = screen.getByLabelText('Password')
    fireEvent.change(input, { target: { value: 'wrong' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Incorrect password. Please try again.')
    })
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled()
  })

  // Before the try/catch in `handleSubmit`, a transport-level rejection
  // (offline, stale action id after a deploy) escaped as an unhandled promise
  // rejection: `setLoading(false)` never ran, so Sign In stayed disabled with
  // no message. This form is pre-auth and the only door — that wedged the whole
  // application behind a page reload.
  it('recovers with an inline error when signIn rejects in transit (EH-01)', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSignIn.mockRejectedValueOnce(new Error('network down'))
    render(<LoginForm />)
    const input = screen.getByLabelText('Password')
    fireEvent.change(input, { target: { value: 'super-secret-pw' } })
    fireEvent.submit(input.closest('form')!)

    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i)
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled()
    // The cause must reach the console — never swallowed (EH-01). The message
    // wording is not the contract, so it is matched loosely.
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('signIn failed'),
      expect.objectContaining({ cause: expect.any(Error) }),
    )
    // SEC-01: the password must never reach the console or a log sink. Asserted
    // across every argument of every `console.error` call, not just the one
    // above, so any future log line added to this handler is covered too.
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('super-secret-pw')
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
})
