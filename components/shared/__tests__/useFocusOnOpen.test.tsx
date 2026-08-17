import { renderHook } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import type { RefObject } from 'react'
import { useFocusOnOpen } from '../useFocusOnOpen'

/**
 * A real, document-attached node: jsdom refuses focus to detached elements, so
 * a bare `document.createElement` would make every `document.activeElement`
 * assertion below pass vacuously.
 */
function mountButton(label: string): HTMLButtonElement {
  const node = document.createElement('button')
  node.textContent = label
  document.body.appendChild(node)
  return node
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useFocusOnOpen', () => {
  it('focuses the ref’s node when open flips false → true', () => {
    const node = mountButton('Cancel')
    const ref: RefObject<HTMLButtonElement | null> = { current: node }
    const { rerender } = renderHook(({ open }) => useFocusOnOpen(open, ref), {
      initialProps: { open: false },
    })
    expect(document.activeElement).not.toBe(node)

    rerender({ open: true })

    expect(document.activeElement).toBe(node)
  })

  it('does not focus while open stays false', () => {
    const node = mountButton('Cancel')
    const ref: RefObject<HTMLButtonElement | null> = { current: node }
    const { rerender } = renderHook(({ open }) => useFocusOnOpen(open, ref), {
      initialProps: { open: false },
    })

    rerender({ open: false })
    rerender({ open: false })

    expect(document.activeElement).not.toBe(node)
  })

  // This is the `if (open)` guard's whole purpose, and no consumer test can see
  // it: every dialog test mocks `AnimatePresence` to render children straight
  // through, so the node unmounts the instant `open` goes false and
  // `target.current?.focus()` would no-op on a detached ref regardless. In the
  // real app the exit animation keeps the node mounted for the duration of the
  // close, so an unguarded effect would yank focus back into a dialog that is
  // animating away — off whatever the user moved to next.
  it('does not focus on true → false while the node is still mounted', () => {
    const cancel = mountButton('Cancel')
    const elsewhere = mountButton('Elsewhere')
    const ref: RefObject<HTMLButtonElement | null> = { current: cancel }
    const { rerender } = renderHook(({ open }) => useFocusOnOpen(open, ref), {
      initialProps: { open: true },
    })
    expect(document.activeElement).toBe(cancel)

    // Focus moves on, exactly as it would when the user dismisses the dialog.
    elsewhere.focus()
    expect(document.activeElement).toBe(elsewhere)

    rerender({ open: false })

    // The effect re-runs on the `open` change; the guard is what stops it from
    // stealing focus back. `ref.current` is still the attached node, so an
    // unguarded `focus()` here would succeed.
    expect(document.activeElement).toBe(elsewhere)
  })

  it('does not throw when ref.current is null', () => {
    const ref: RefObject<HTMLButtonElement | null> = { current: null }

    expect(() => {
      const { rerender } = renderHook(({ open }) => useFocusOnOpen(open, ref), {
        initialProps: { open: false },
      })
      rerender({ open: true })
    }).not.toThrow()
  })
})
