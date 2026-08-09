'use client'

import { useEffect } from 'react'

interface DismissOptions {
  /**
   * Which press counts as pointing away. The two call sites disagree —
   * `ContactMenu` listens for `pointerdown`, `QuickAddFab` for `mousedown` —
   * and the disagreement is carried through rather than harmonised here:
   * changing which press dismisses a live surface is a behaviour change, not a
   * refactor, and neither component asked for one.
   */
  pointerEvent: 'pointerdown' | 'mousedown'
  /**
   * True to listen in the capture phase, i.e. before the element under the
   * pointer sees the press. Only meaningful together with `swallowOutside` —
   * capturing without swallowing changes nothing observable.
   */
  capture?: boolean
  /**
   * True to `preventDefault` + `stopPropagation` the dismissing press, so the
   * tap that closes the surface does not also activate whatever sits behind it.
   * Left false where the dismissing tap *should* land: closing a menu should
   * not cost the user the click they were already making.
   */
  swallowOutside?: boolean
}

/**
 * Dismisses an open transient surface — a menu, a speed dial — when the user
 * presses outside `containerRef` or hits Escape.
 *
 * Extracted because two components had written the same three-part shape
 * independently (CQ-07): gate on open, pair every `addEventListener` with its
 * `removeEventListener`, and read "outside" as "not contained by the wrapper".
 * Two copies is two chances to drop half a cleanup, and the leak that produces
 * is invisible until a stale listener closes a surface that has already gone.
 *
 * The press listener binds to `document` rather than `window` so both phases
 * have one node to attach to; `keydown` stays on `window`, matching every other
 * Escape handler in the project.
 *
 * @param isOpen Whether the surface is up. Nothing is bound while it is closed.
 * @param containerRef The surface's wrapper — a press inside it is not a
 * dismissal. A null ref dismisses nothing, so an unmounted wrapper cannot be
 * mistaken for "the user pressed elsewhere".
 * @param onDismiss Closes the surface. Keep it stable (`useCallback`): it is an
 * effect dependency, so a fresh identity each render rebinds both listeners.
 * @param options Per-call-site press semantics — see `DismissOptions`.
 */
export function useDismissOnOutsideOrEsc(
  isOpen: boolean,
  containerRef: React.RefObject<HTMLElement>,
  onDismiss: () => void,
  { pointerEvent, capture = false, swallowOutside = false }: DismissOptions,
): void {
  useEffect(() => {
    if (!isOpen) return

    function handleOutsidePress(event: Event) {
      const container = containerRef.current
      const target = event.target as Node | null
      if (!container || !target || container.contains(target)) return
      if (swallowOutside) {
        event.preventDefault()
        event.stopPropagation()
      }
      onDismiss()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismiss()
    }

    document.addEventListener(pointerEvent, handleOutsidePress, capture)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener(pointerEvent, handleOutsidePress, capture)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, containerRef, onDismiss, pointerEvent, capture, swallowOutside])
}
