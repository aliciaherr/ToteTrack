import { describe, it, expect } from 'vitest'
import {
  MAX_VISIBLE_TOASTS,
  TOAST_ERROR_DURATION_MS,
  TOAST_INFO_DURATION_MS,
  TOAST_SUCCESS_DURATION_MS,
  buildToastMotionProps,
  toastDurationMs,
} from '../toast-animation'
import { toastVariants } from '../animations'

describe('toastDurationMs', () => {
  it('returns the success duration for a success variant', () => {
    expect(toastDurationMs('success')).toBe(TOAST_SUCCESS_DURATION_MS)
  })

  it('returns the longer error duration for an error variant', () => {
    expect(toastDurationMs('error')).toBe(TOAST_ERROR_DURATION_MS)
    expect(TOAST_ERROR_DURATION_MS).toBeGreaterThan(TOAST_SUCCESS_DURATION_MS)
  })

  it('returns the info duration for an info variant', () => {
    expect(toastDurationMs('info')).toBe(TOAST_INFO_DURATION_MS)
  })
})

describe('buildToastMotionProps', () => {
  it('returns motion variants when reduced motion is off', () => {
    const props = buildToastMotionProps(false)
    expect(props).toMatchObject({
      variants: toastVariants,
      initial: 'hidden',
      animate: 'visible',
      exit: 'exit',
    })
  })

  it('returns an empty object when reduced motion is on', () => {
    const props = buildToastMotionProps(true)
    expect(props).toEqual({})
  })
})

describe('MAX_VISIBLE_TOASTS', () => {
  it('caps the visible stack at 3 toasts per Task 29 spec', () => {
    expect(MAX_VISIBLE_TOASTS).toBe(3)
  })
})
