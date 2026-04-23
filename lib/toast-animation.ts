/**
 * Toast stack timing + capacity constants and a motion-prop helper that
 * applies reduced-motion correctly. Kept outside `lib/animations.ts`
 * because that file is spec'd as pure variants only — these are per-variant
 * timeouts + a helper that composes `toastVariants` into the motion-component
 * props a ToastProvider renders.
 *
 * Spec references:
 *   docs/design-decisions.md — 250ms in / 200ms out, ease-out
 *   docs/plan.md Task 29     — success 3s, error 5s, max 3 visible
 */
import { toastVariants } from './animations'

export const TOAST_SUCCESS_DURATION_MS = 3000
export const TOAST_ERROR_DURATION_MS = 5000
export const TOAST_INFO_DURATION_MS = 3000
export const MAX_VISIBLE_TOASTS = 3

export type ToastVariant = 'success' | 'error' | 'info'

/**
 * Returns the auto-dismiss timeout for a given toast variant. Error toasts
 * stay visible longer (5s) than success/info (3s) — the salesperson needs
 * more time to read a failure message than a confirmation.
 */
export function toastDurationMs(variant: ToastVariant): number {
  if (variant === 'error') return TOAST_ERROR_DURATION_MS
  if (variant === 'info') return TOAST_INFO_DURATION_MS
  return TOAST_SUCCESS_DURATION_MS
}

/**
 * Builds the motion-component prop set for a single toast card. Spread
 * directly onto a `motion.div`:
 *   `<motion.div {...buildToastMotionProps(shouldReduceMotion)}>`
 * Returns an empty object when `shouldReduceMotion` is true so the toast
 * appears and disappears instantly (still auto-dismisses per Task 29 spec).
 */
export function buildToastMotionProps(shouldReduceMotion: boolean) {
  if (shouldReduceMotion) return {}
  return {
    variants: toastVariants,
    initial: 'hidden' as const,
    animate: 'visible' as const,
    exit: 'exit' as const,
  }
}
