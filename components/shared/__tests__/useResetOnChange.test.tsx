import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useResetOnChange, useResetOnClose } from '../useResetOnChange'

describe('useResetOnChange', () => {
  it('does not call reset on the first render', () => {
    const reset = vi.fn()
    renderHook(({ value }) => useResetOnChange(value, reset), {
      initialProps: { value: 'a' },
    })

    expect(reset).not.toHaveBeenCalled()
  })

  it('calls reset when the value’s identity changes', () => {
    const reset = vi.fn()
    const { rerender } = renderHook(({ value }) => useResetOnChange(value, reset), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'b' })

    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('does not call reset when re-rendered with the same value', () => {
    const reset = vi.fn()
    const { rerender } = renderHook(({ value }) => useResetOnChange(value, reset), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'a' })
    rerender({ value: 'a' })

    expect(reset).not.toHaveBeenCalled()
  })

  it('fires again when the value changes back — `previous` tracks, it is not a one-shot latch', () => {
    const reset = vi.fn()
    const { rerender } = renderHook(({ value }) => useResetOnChange(value, reset), {
      initialProps: { value: 'a' },
    })

    rerender({ value: 'b' })
    rerender({ value: 'a' })

    expect(reset).toHaveBeenCalledTimes(2)
  })
})

describe('useResetOnClose', () => {
  // `open: false` is deliberate, and is how these dialogs actually mount. With
  // `initialProps: { open: true }` the inner `if (!open)` suppresses the call
  // on its own, so the test could not fail for the reason it names.
  it('does not call reset on the first render', () => {
    const reset = vi.fn()
    renderHook(({ open }) => useResetOnClose(open, reset), {
      initialProps: { open: false },
    })

    expect(reset).not.toHaveBeenCalled()
  })

  it('calls reset when open flips true → false', () => {
    const reset = vi.fn()
    const { rerender } = renderHook(({ open }) => useResetOnClose(open, reset), {
      initialProps: { open: true },
    })

    rerender({ open: false })

    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('does not call reset when open flips false → true — opening must not clear state', () => {
    const reset = vi.fn()
    const { rerender } = renderHook(({ open }) => useResetOnClose(open, reset), {
      initialProps: { open: false },
    })

    rerender({ open: true })

    expect(reset).not.toHaveBeenCalled()
  })
})
