'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CalendarOrderRow } from '@/db/queries/calendar'

// Behavioural hooks for `ProductionCardDialog`, split out to keep that file
// within the 200-line component cap (CQ-02).

/** Focusable descendants, in DOM order — the tab ring while the dialog is open. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Closes the dialog on Escape while it is open.
 *
 * @param open Whether the dialog is mounted.
 * @param onClose Dismisses it.
 * @param disabled True while a mutation is in flight — Escape is ignored so a
 * write in progress cannot be abandoned half-reported.
 */
export function useEscapeClose(open: boolean, onClose: () => void, disabled: boolean) {
  useEffect(() => {
    if (!open) return
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !disabled) onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose, disabled])
}

/**
 * Keeps Tab inside the panel while it is open, and returns focus to whatever
 * opened it — the card — on close.
 *
 * Note this is the **first focus trap in the project**: the five existing
 * dialogs set initial focus and listen for Escape but let Tab walk out into the
 * page behind them, and none restores focus on close. That is a real gap in
 * those dialogs, not a reason to repeat it here.
 */
export function useFocusTrap(open: boolean, panelRef: React.RefObject<HTMLDivElement>) {
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus()

    function handleTab(event: KeyboardEvent) {
      if (event.key !== 'Tab' || !panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleTab)
    return () => {
      window.removeEventListener('keydown', handleTab)
      restoreRef.current?.focus()
    }
  }, [open, panelRef])
}

/**
 * The two mutating handlers, with the busy flag that disables the panel while
 * either is in flight. `onRemove` closes on completion; `onToggleSameDay`
 * leaves the dialog open so the flag can be flipped back.
 */
export function useDialogActions(
  row: CalendarOrderRow | null,
  onToggleSameDay: (orderId: string, next: boolean) => Promise<void>,
  onRemove: (orderId: string) => Promise<void>,
  onClose: () => void,
) {
  const [isBusy, setIsBusy] = useState(false)

  // `finally` is load-bearing on both handlers. While `isBusy` is true the
  // buttons are disabled, Escape is ignored and backdrop-click is gated — so a
  // rejected mutation that left the flag set would make the dialog impossible
  // to close without reloading the page. The mutation hook owns reporting the
  // failure; this only guarantees the UI is never trapped.
  const handleToggle = useCallback(
    async (next: boolean) => {
      if (!row) return
      setIsBusy(true)
      try {
        await onToggleSameDay(row.id, next)
      } finally {
        setIsBusy(false)
      }
    },
    [row, onToggleSameDay],
  )

  const handleRemove = useCallback(async () => {
    if (!row) return
    setIsBusy(true)
    try {
      await onRemove(row.id)
    } finally {
      setIsBusy(false)
      onClose()
    }
  }, [row, onRemove, onClose])

  return { isBusy, setIsBusy, handleToggle, handleRemove }
}
