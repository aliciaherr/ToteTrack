'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  MAX_VISIBLE_TOASTS,
  buildToastMotionProps,
  toastDurationMs,
  type ToastVariant,
} from '@/lib/toast-animation'
import { ToastContext, type ToastApi } from '@/lib/hooks/useToast'

interface ToastEntry {
  id: string
  message: string
  variant: ToastVariant
}

function toastClasses(variant: ToastVariant): string {
  if (variant === 'error') return 'bg-destructive text-destructive-foreground'
  if (variant === 'success') return 'bg-primary text-primary-foreground'
  return 'bg-secondary text-secondary-foreground'
}

function capToVisibleCount(queue: ToastEntry[]): ToastEntry[] {
  if (queue.length <= MAX_VISIBLE_TOASTS) return queue
  return queue.slice(queue.length - MAX_VISIBLE_TOASTS)
}

/**
 * Where the stack sits: top-right, 80px down. That clears the review overlay's
 * header (69px tall, Close at its right end) and every page's top chrome, so a
 * toast never covers a control; and the stack takes no taps at all.
 */
const TOAST_STACK_CLASS =
  'pointer-events-none fixed top-20 right-4 z-50 flex flex-col gap-2 w-[320px] max-w-[90vw]'

/**
 * One toast. Read-only (no toast carries an action), so it ignores taps: a
 * tap on it reaches whatever is underneath, e.g. the review overlay's Close.
 */
function ToastCard({ entry }: { entry: ToastEntry }) {
  const shouldReduceMotion = useReducedMotion()
  return (
    <motion.div
      {...buildToastMotionProps(Boolean(shouldReduceMotion))}
      role={entry.variant === 'error' ? 'alert' : 'status'}
      className={`pointer-events-none rounded-md shadow-lg px-4 py-3 text-sm font-medium ${toastClasses(entry.variant)}`}
    >
      {entry.message}
    </motion.div>
  )
}

/**
 * Provides the toast queue API to every descendant via React context and
 * renders the toast stack fixed in the top-right corner, below any header
 * (`TOAST_STACK_CLASS`); toasts never take taps. Caps the visible queue at `MAX_VISIBLE_TOASTS` — a fourth toast
 * dismisses the oldest — and auto-dismisses each toast after the
 * variant-specific timeout. Honours `useReducedMotion()` at the card level
 * (instant appear/disappear) while preserving the auto-dismiss lifecycle.
 */
export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<ToastEntry[]>([])
  const idCounterRef = useRef(0)
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setEntries((current) => current.filter((entry) => entry.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, variant: ToastVariant) => {
      idCounterRef.current += 1
      const id = `toast-${idCounterRef.current}`
      setEntries((current) => capToVisibleCount([...current, { id, message, variant }]))
      const timer = setTimeout(() => dismiss(id), toastDurationMs(variant))
      timersRef.current.set(id, timer)
    },
    [dismiss],
  )

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((timer) => clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const api = useMemo<ToastApi>(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        data-testid="toast-stack"
        className={TOAST_STACK_CLASS}
      >
        <AnimatePresence initial={false}>
          {entries.map((entry) => (
            <ToastCard key={entry.id} entry={entry} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}
