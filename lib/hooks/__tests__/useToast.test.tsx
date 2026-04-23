import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ToastContext, useToast, ToastProviderMissingError } from '../useToast'

function ToastConsumer() {
  const { toast } = useToast()
  return (
    <button type="button" onClick={() => toast('hi', 'success')}>
      call-toast
    </button>
  )
}

describe('useToast', () => {
  it('returns the toast function provided by the nearest ToastContext', () => {
    const capturedToast = vi.fn()
    render(
      <ToastContext.Provider value={{ toast: capturedToast }}>
        <ToastConsumer />
      </ToastContext.Provider>,
    )
    expect(screen.getByRole('button', { name: /call-toast/i })).toBeInTheDocument()
    // Clicking calls the provided toast — verifies the hook returned the API.
    screen.getByRole('button', { name: /call-toast/i }).click()
    expect(capturedToast).toHaveBeenCalledWith('hi', 'success')
  })

  it('throws ToastProviderMissingError when used outside a provider', () => {
    // Suppress the expected React error-boundary log for this negative test.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<ToastConsumer />)).toThrow(ToastProviderMissingError)
    errorSpy.mockRestore()
  })
})
