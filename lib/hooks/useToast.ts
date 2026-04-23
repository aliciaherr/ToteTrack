'use client'

import { createContext, useContext } from 'react'
import type { ToastVariant } from '@/lib/toast-animation'

export interface ToastApi {
  toast: (message: string, variant: ToastVariant) => void
}

/**
 * Internal context carrying the toast queue API. Exported only so
 * `ToastProvider` can supply a value. Consumers should use `useToast()`
 * instead of reading the context directly.
 */
export const ToastContext = createContext<ToastApi | null>(null)

/**
 * Hook that returns the toast function from the nearest `<ToastProvider>`.
 * Throws a named error (EH-01 / EH-05) when called outside a provider so the
 * miswiring surfaces during development instead of silently no-op'ing.
 * @returns Object with `toast(message, variant)` — variant is 'success',
 * 'error', or 'info'. Message must include context (EH-01 — e.g. "Failed to
 * save customer. Please try again.", not bare "Error").
 * @throws ToastProviderMissingError if no ancestor `<ToastProvider>` renders.
 */
export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) {
    throw new ToastProviderMissingError()
  }
  return api
}

/**
 * Thrown when `useToast` is called without a wrapping `<ToastProvider>`.
 * Named so callers can match `instanceof` reliably and the message stays
 * actionable — EH-05.
 */
export class ToastProviderMissingError extends Error {
  constructor() {
    super(
      'useToast must be used within a <ToastProvider>. Wrap the app tree in app/(app)/layout.tsx with <ToastProvider>.',
    )
    this.name = 'ToastProviderMissingError'
  }
}
