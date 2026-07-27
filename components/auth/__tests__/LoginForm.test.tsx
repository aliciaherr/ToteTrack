import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LoginForm from '../LoginForm'

const mockSignIn = vi.hoisted(() => vi.fn())

vi.mock('@/lib/actions/auth', () => ({ signIn: mockSignIn }))

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
})
