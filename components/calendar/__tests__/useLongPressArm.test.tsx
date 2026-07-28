import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useLongPressArm } from '../useLongPressArm'
import { ARM_DELAY_MS, ARM_MOVE_TOLERANCE_PX } from '../armPlacement'

function touchEvent(x: number, y: number): React.TouchEvent {
  return { touches: [{ clientX: x, clientY: y }] } as unknown as React.TouchEvent
}

function touchEndEvent(): React.TouchEvent & { preventDefault: ReturnType<typeof vi.fn> } {
  return {
    cancelable: true,
    preventDefault: vi.fn(),
  } as unknown as React.TouchEvent & { preventDefault: ReturnType<typeof vi.fn> }
}

function clickEvent() {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent & {
    preventDefault: ReturnType<typeof vi.fn>
    stopPropagation: ReturnType<typeof vi.fn>
  }
}

describe('useLongPressArm', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('arms after a still-finger press of the full delay', () => {
    const onArm = vi.fn()
    const { result } = renderHook(() => useLongPressArm(onArm, false))

    act(() => {
      result.current.onTouchStart(touchEvent(100, 100))
      vi.advanceTimersByTime(ARM_DELAY_MS)
    })

    expect(onArm).toHaveBeenCalledTimes(1)
  })

  it('does not arm when the finger drifts past tolerance — that press is a scroll', () => {
    const onArm = vi.fn()
    const { result } = renderHook(() => useLongPressArm(onArm, false))

    act(() => {
      result.current.onTouchStart(touchEvent(100, 100))
      result.current.onTouchMove(touchEvent(100, 100 + ARM_MOVE_TOLERANCE_PX + 1))
      vi.advanceTimersByTime(ARM_DELAY_MS)
    })

    expect(onArm).not.toHaveBeenCalled()
  })

  it('tolerates drift within the threshold', () => {
    const onArm = vi.fn()
    const { result } = renderHook(() => useLongPressArm(onArm, false))

    act(() => {
      result.current.onTouchStart(touchEvent(100, 100))
      result.current.onTouchMove(touchEvent(100, 100 + ARM_MOVE_TOLERANCE_PX - 1))
      vi.advanceTimersByTime(ARM_DELAY_MS)
    })

    expect(onArm).toHaveBeenCalledTimes(1)
  })

  it('does not arm when the finger lifts early — that press is a tap', () => {
    const onArm = vi.fn()
    const { result } = renderHook(() => useLongPressArm(onArm, false))

    act(() => {
      result.current.onTouchStart(touchEvent(100, 100))
      vi.advanceTimersByTime(ARM_DELAY_MS - 1)
      result.current.onTouchEnd(touchEndEvent())
      vi.advanceTimersByTime(ARM_DELAY_MS)
    })

    expect(onArm).not.toHaveBeenCalled()
  })

  it('never arms while disabled — built cards cannot be picked up', () => {
    const onArm = vi.fn()
    const { result } = renderHook(() => useLongPressArm(onArm, true))

    act(() => {
      result.current.onTouchStart(touchEvent(100, 100))
      vi.advanceTimersByTime(ARM_DELAY_MS)
    })

    expect(onArm).not.toHaveBeenCalled()
  })

  it('cancels the pending arm when a second finger lands', () => {
    const onArm = vi.fn()
    const { result } = renderHook(() => useLongPressArm(onArm, false))

    act(() => {
      result.current.onTouchStart(touchEvent(100, 100))
      result.current.onTouchStart({
        touches: [
          { clientX: 100, clientY: 100 },
          { clientX: 200, clientY: 200 },
        ],
      } as unknown as React.TouchEvent)
      vi.advanceTimersByTime(ARM_DELAY_MS)
    })

    expect(onArm).not.toHaveBeenCalled()
  })

  it('swallows only the arming press’s own click, so the next tap can cancel', () => {
    const onArm = vi.fn()
    const { result } = renderHook(() => useLongPressArm(onArm, false))

    // The arming press: its touchend is suppressed and its click swallowed.
    const end = touchEndEvent()
    act(() => {
      result.current.onTouchStart(touchEvent(100, 100))
      vi.advanceTimersByTime(ARM_DELAY_MS)
      result.current.onTouchEnd(end)
    })
    expect(end.preventDefault).toHaveBeenCalled()

    const tailClick = clickEvent()
    act(() => result.current.onClickCapture(tailClick))
    expect(tailClick.stopPropagation).toHaveBeenCalled()

    // A later, genuine tap on the armed card must pass through to cancel.
    const nextClick = clickEvent()
    act(() => {
      result.current.onTouchStart(touchEvent(100, 100))
      result.current.onTouchEnd(touchEndEvent())
      result.current.onClickCapture(nextClick)
    })
    expect(nextClick.stopPropagation).not.toHaveBeenCalled()
  })
})
