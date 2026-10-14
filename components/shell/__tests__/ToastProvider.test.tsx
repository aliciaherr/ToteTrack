import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ToastProvider from '../ToastProvider'
import { useToast } from '@/lib/hooks/useToast'
import {
  MAX_VISIBLE_TOASTS,
  TOAST_ERROR_DURATION_MS,
  TOAST_SUCCESS_DURATION_MS,
} from '@/lib/toast-animation'

// The motion-only props are named so they are stripped from `rest` and never
// reach a real DOM node. A `type` is erased, so the hoisted factory can use it.
type MotionMockProps = Record<string, unknown> & { children?: React.ReactNode }

vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, variants, initial, animate, exit, ...rest }: MotionMockProps) => (
      <div
        data-testid="toast-card"
        data-has-variants={variants ? 'yes' : 'no'}
        {...rest}
      >
        {children}
      </div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useReducedMotion: () => false,
}))

function ToastTrigger({
  label,
  message,
  variant,
}: {
  label: string
  message: string
  variant: 'success' | 'error' | 'info'
}) {
  const { toast } = useToast()
  return (
    <button type="button" onClick={() => toast(message, variant)}>
      {label}
    </button>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ToastProvider', () => {
  it('renders its children without error', () => {
    render(
      <ToastProvider>
        <p>child content</p>
      </ToastProvider>,
    )
    expect(screen.getByText('child content')).toBeInTheDocument()
  })

  it('adds a toast entry to the visible queue when toast() is called', () => {
    render(
      <ToastProvider>
        <ToastTrigger label="fire" message="Saved." variant="success" />
      </ToastProvider>,
    )
    act(() => {
      screen.getByRole('button', { name: /fire/i }).click()
    })
    expect(screen.getByText('Saved.')).toBeInTheDocument()
  })

  it('auto-dismisses a success toast after the success timeout', () => {
    render(
      <ToastProvider>
        <ToastTrigger label="fire" message="Saved." variant="success" />
      </ToastProvider>,
    )
    act(() => {
      screen.getByRole('button', { name: /fire/i }).click()
    })
    expect(screen.getByText('Saved.')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(TOAST_SUCCESS_DURATION_MS)
    })
    expect(screen.queryByText('Saved.')).not.toBeInTheDocument()
  })

  it('auto-dismisses an error toast after the longer error timeout', () => {
    render(
      <ToastProvider>
        <ToastTrigger label="fire" message="Failed." variant="error" />
      </ToastProvider>,
    )
    act(() => {
      screen.getByRole('button', { name: /fire/i }).click()
    })
    // Still visible after the success timeout — errors stay longer.
    act(() => {
      vi.advanceTimersByTime(TOAST_SUCCESS_DURATION_MS)
    })
    expect(screen.getByText('Failed.')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(TOAST_ERROR_DURATION_MS - TOAST_SUCCESS_DURATION_MS)
    })
    expect(screen.queryByText('Failed.')).not.toBeInTheDocument()
  })

  it('caps the visible stack at MAX_VISIBLE_TOASTS and drops the oldest', () => {
    render(
      <ToastProvider>
        <ToastTrigger label="one" message="first" variant="success" />
        <ToastTrigger label="two" message="second" variant="success" />
        <ToastTrigger label="three" message="third" variant="success" />
        <ToastTrigger label="four" message="fourth" variant="success" />
      </ToastProvider>,
    )
    act(() => {
      screen.getByRole('button', { name: /one/i }).click()
      screen.getByRole('button', { name: /two/i }).click()
      screen.getByRole('button', { name: /three/i }).click()
      screen.getByRole('button', { name: /four/i }).click()
    })
    expect(screen.getAllByTestId('toast-card')).toHaveLength(MAX_VISIBLE_TOASTS)
    expect(screen.queryByText('first')).not.toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
    expect(screen.getByText('third')).toBeInTheDocument()
    expect(screen.getByText('fourth')).toBeInTheDocument()
  })

  describe('never blocks the review overlay header (code-review fix)', () => {
    function renderWithClose(onClose: () => void) {
      render(
        <ToastProvider>
          <button type="button" aria-label="Close review" onClick={onClose} />
          <ToastTrigger label="fire" message="PO approved." variant="success" />
        </ToastProvider>,
      )
      act(() => {
        screen.getByRole('button', { name: /fire/i }).click()
      })
    }

    it('makes the stack and every card ignore taps', () => {
      renderWithClose(vi.fn())

      const stack = screen.getByTestId('toast-stack')
      expect(stack.className).toContain('pointer-events-none')
      expect(screen.getByTestId('toast-card').className).toContain('pointer-events-none')
      expect(stack.innerHTML).not.toContain('pointer-events-auto')
      // No toast carries an action, so nothing inside the stack is focusable or clickable.
      expect(stack.querySelector('button, a, [tabindex]')).toBeNull()
    })

    it("sits below the overlay header's 69px, clear of Close in the top-right", () => {
      renderWithClose(vi.fn())

      const stack = screen.getByTestId('toast-stack')
      expect(stack.className).toContain('top-20')
      expect(stack.className).not.toContain('top-4')
    })

    it('leaves Close clickable while a toast is showing', () => {
      const onClose = vi.fn()
      renderWithClose(onClose)

      expect(screen.getByText('PO approved.')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Close review' }))
      expect(onClose).toHaveBeenCalledOnce()
    })

    it('still announces the toast: status for success, alert for an error, in a polite live region', () => {
      render(
        <ToastProvider>
          <ToastTrigger label="ok" message="Saved." variant="success" />
          <ToastTrigger label="bad" message="Failed." variant="error" />
        </ToastProvider>,
      )
      act(() => {
        screen.getByRole('button', { name: /ok/i }).click()
        screen.getByRole('button', { name: /bad/i }).click()
      })

      expect(screen.getByRole('status')).toHaveTextContent('Saved.')
      expect(screen.getByRole('alert')).toHaveTextContent('Failed.')
      expect(screen.getByTestId('toast-stack')).toHaveAttribute('aria-live', 'polite')
    })
  })
})
