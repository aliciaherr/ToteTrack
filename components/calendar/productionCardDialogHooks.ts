'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CalendarOrderRow } from '@/db/queries/calendar'

// Behavioural hooks for `ProductionCardDialog`, split out to keep it — and this
// file — within the 200-line component cap (CQ-02).

/** Focusable descendants, in DOM order — the tab ring while the dialog is open. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Closes the dialog on Escape while it is open.
 *
 * @param open Whether the dialog is mounted.
 * @param onClose Dismisses it.
 * @param disabled True while a mutation is in flight — a write in progress
 * cannot be abandoned half-reported — or while a confirmation dialog inside the
 * panel owns the key for as long as it is up (see `useNestedDialog`).
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
      // A confirmation dialog opened by the status block renders *inside* the
      // panel, so the ring has to shrink to it while it is up — otherwise Tab
      // walks out of the topmost dialog into the popup behind it. There is
      // never more than one nested dialog: the status block opens one at a time.
      const scope = panel.querySelector<HTMLElement>('[role="dialog"]') ?? panel
      const focusable = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE))
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

/** A flag mutation. `next` is the target state, never a flip. */
type FlagToggle = (orderId: string, next: boolean) => Promise<void>

interface DialogActionsInput {
  row: CalendarOrderRow | null
  onToggleBackhaul: FlagToggle
  onToggleSameDay: FlagToggle
  onRemove: (orderId: string) => Promise<void>
  onClose: () => void
}

/**
 * The dialog's three mutating handlers plus the busy flag that disables the
 * panel while any is in flight. `onRemove` closes on completion; the two flag
 * toggles leave the dialog open so the pill can be flipped straight back.
 *
 * Every handler is `catch`-then-`finally`: while `isBusy` is true the controls
 * are disabled, Escape is ignored and backdrop-click is gated, so a mutation
 * that left the flag set would trap the dialog until a page reload. The `catch`
 * is not a swallow — `useCalendarMutation` already catches transport failures,
 * logs them and raises the toast, so a rejection reaching here is a broken
 * collaborator, and the DOM handler discards this promise, so it would
 * otherwise surface only as an unhandled rejection nobody reads.
 */
export function useDialogActions({
  row,
  onToggleBackhaul,
  onToggleSameDay,
  onRemove,
  onClose,
}: DialogActionsInput) {
  const [isBusy, setIsBusy] = useState(false)

  const runToggle = useCallback(
    async (label: string, next: boolean, mutate: FlagToggle) => {
      if (!row) return
      setIsBusy(true)
      try {
        await mutate(row.id, next)
      } catch (cause) {
        console.error(`ProductionCardDialog: ${label} toggle rejected`, { orderId: row.id, next, cause })
      } finally {
        setIsBusy(false)
      }
    },
    [row],
  )

  const handleToggleBackhaul = useCallback(
    (next: boolean) => runToggle('backhaul', next, onToggleBackhaul),
    [runToggle, onToggleBackhaul],
  )
  const handleToggleSameDay = useCallback(
    (next: boolean) => runToggle('same-day delivery', next, onToggleSameDay),
    [runToggle, onToggleSameDay],
  )

  const handleRemove = useCallback(async () => {
    if (!row) return
    setIsBusy(true)
    try {
      await onRemove(row.id)
    } catch (cause) {
      console.error('ProductionCardDialog: remove rejected', { orderId: row.id, cause })
    } finally {
      setIsBusy(false)
      onClose()
    }
  }, [row, onRemove, onClose])

  return { isBusy, setIsBusy, handleToggleBackhaul, handleToggleSameDay, handleRemove }
}

/**
 * Tracks whether a confirmation dialog opened by the status block is mounted
 * inside the panel, and hands focus back to the popup when it closes.
 *
 * `OrderStatusActions` renders `CancelOrderDialog` / `RevertOrderDialog` inside
 * this dialog, and both those and the popup listen for Escape on `window`, so
 * one keypress reaches both handlers. Rather than depend on listener order or
 * stop propagation, the popup stands down while a confirm is up: the flag
 * returned here feeds the same `disabled` argument of `useEscapeClose` that
 * already gates Escape during a mutation. One press closes the confirm, the
 * next closes the popup. The report arrives synchronously, from the click that
 * opens the confirm, so `document.activeElement` here is still the button that
 * opened it — where focus returns when the confirm unmounts, not `<body>`.
 *
 * @param open Whether the popup itself is open; closing it clears the flag.
 * @param panelRef The popup panel, used to place focus back inside it.
 */
export function useNestedDialog(open: boolean, panelRef: React.RefObject<HTMLDivElement>) {
  const [nestedOpen, setNestedOpen] = useState(false)
  const openerRef = useRef<HTMLElement | null>(null)

  const handleNestedOpenChange = useCallback((next: boolean) => {
    if (next) openerRef.current = document.activeElement as HTMLElement | null
    setNestedOpen(next)
  }, [])

  useEffect(() => {
    if (!open) setNestedOpen(false)
  }, [open])

  useEffect(() => {
    if (nestedOpen) return
    const opener = openerRef.current
    openerRef.current = null
    // Not when the popup itself is on its way out: `useFocusTrap` is restoring
    // focus to the card that opened it, and pulling focus into a panel that is
    // mid-exit-animation would undo that.
    if (!open || !opener || !panelRef.current) return
    const target = panelRef.current.contains(opener)
      ? opener
      : panelRef.current.querySelector<HTMLElement>(FOCUSABLE)
    target?.focus()
  }, [nestedOpen, open, panelRef])

  return { nestedOpen, handleNestedOpenChange }
}
