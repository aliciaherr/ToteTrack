'use client'

import { useCallback, useEffect, useRef } from 'react'
import { ARM_DELAY_MS, ARM_MOVE_TOLERANCE_PX } from './armPlacement'

interface LongPressHandlers {
  onTouchStart: (event: React.TouchEvent) => void
  onTouchMove: (event: React.TouchEvent) => void
  onTouchEnd: (event: React.TouchEvent) => void
  onTouchCancel: () => void
  /** Swallows the click a browser synthesises from the arming press itself. */
  onClickCapture: (event: React.MouseEvent) => void
}

/**
 * Detects the still-finger long-press that arms a card (Task 68).
 *
 * Touch events only, deliberately: mouse and pen keep the drag sensor, so a
 * desktop press must never arm. The timer starts on `touchstart` and `onArm`
 * fires only if the finger neither lifts nor drifts past
 * {@link ARM_MOVE_TOLERANCE_PX} for {@link ARM_DELAY_MS} — drift or an early
 * lift means the gesture was a scroll or a tap, and the press ends silently.
 *
 * The subtlety is the press's own tail. Lifting the finger after a successful
 * arm makes the browser synthesise a `click` on the card — which, now that the
 * card is armed, would route as "tap the armed card" and instantly cancel the
 * arm it just performed. Two independent guards stop that: `preventDefault()`
 * on the `touchend` (suppresses the synthetic click at the source) and a
 * capture-phase click swallow (catches any browser that fires it anyway).
 *
 * @param onArm Called once when the press qualifies.
 * @param disabled Built cards pass `true`: no timer ever starts, handlers are inert.
 */
export function useLongPressArm(onArm: () => void, disabled: boolean): LongPressHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const armedThisPressRef = useRef(false)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    startRef.current = null
  }, [])

  // A card can unmount mid-press (a concurrent refresh re-renders the column);
  // an orphaned timer would then arm a card that no longer exists on screen.
  useEffect(() => clearTimer, [clearTimer])

  const onTouchStart = useCallback(
    (event: React.TouchEvent) => {
      if (disabled) return
      // A second finger means a pinch or a two-handed fumble, not a press.
      if (event.touches.length !== 1) {
        clearTimer()
        return
      }
      const touch = event.touches[0]
      startRef.current = { x: touch.clientX, y: touch.clientY }
      armedThisPressRef.current = false
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        armedThisPressRef.current = true
        onArm()
      }, ARM_DELAY_MS)
    },
    [disabled, onArm, clearTimer],
  )

  const onTouchMove = useCallback(
    (event: React.TouchEvent) => {
      const start = startRef.current
      if (start === null) return
      const touch = event.touches[0]
      const distance = Math.hypot(touch.clientX - start.x, touch.clientY - start.y)
      if (distance > ARM_MOVE_TOLERANCE_PX) clearTimer()
    },
    [clearTimer],
  )

  const onTouchEnd = useCallback(
    (event: React.TouchEvent) => {
      if (armedThisPressRef.current && event.cancelable) event.preventDefault()
      clearTimer()
    },
    [clearTimer],
  )

  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (!armedThisPressRef.current) return
    armedThisPressRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }, [])

  return { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: clearTimer, onClickCapture }
}
