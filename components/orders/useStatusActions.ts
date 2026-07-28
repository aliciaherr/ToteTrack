'use client'

import { useCallback, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateOrderStatus } from '@/lib/actions/orders'
import { revertOrderToScheduled } from '@/lib/actions/orders.revert'
import { useToast } from '@/lib/hooks/useToast'
import { GENERIC_FAILURE_MESSAGE } from '@/lib/errors'

type ActionResult = { success: true } | { error: string }
type ToastFn = (message: string, tone: 'success' | 'error') => void

interface StatusActionsOptions {
  orderId: string
  onStatusChange?: () => void
  onDialogOpenChange?: (open: boolean) => void
}

/**
 * Open state for one confirmation dialog, mirrored to the host.
 *
 * The report happens in the click that opens or closes the confirm, not in an
 * effect: a host that uses it to hand focus back needs the notification before
 * the confirm mounts and takes focus for itself.
 */
function useConfirmDialog(onDialogOpenChange?: (open: boolean) => void) {
  const [open, setOpen] = useState(false)
  const setConfirmOpen = useCallback(
    (next: boolean) => {
      setOpen(next)
      onDialogOpenChange?.(next)
    },
    [onDialogOpenChange],
  )
  return [open, setConfirmOpen] as const
}

interface ConfirmDeps {
  orderId: string
  successMessage: string
  close: (open: boolean) => void
  toast: ToastFn
  notifyChange: () => void
}

/**
 * Builds a confirm-dialog handler around one server action. Cancel and revert
 * share this shape exactly; only the action and the success copy differ.
 *
 * A transport-level rejection (offline, stale action id after a deploy) must
 * come back as a normal `{ error }` result: `CancelOrderDialog` /
 * `RevertOrderDialog` set `isSubmitting` before awaiting this and only reset it
 * when a result arrives — Escape and backdrop-close are gated on it, so an
 * escaping rejection would wedge the dialog open with no message (EH-01).
 */
function makeConfirmHandler(action: () => Promise<ActionResult>, deps: ConfirmDeps) {
  return async (): Promise<ActionResult> => {
    try {
      const result = await action()
      if ('success' in result) {
        deps.close(false)
        deps.toast(deps.successMessage, 'success')
        deps.notifyChange()
      }
      return result
    } catch (cause) {
      console.error('useStatusActions: confirm action failed', {
        orderId: deps.orderId,
        action: deps.successMessage,
        cause,
      })
      return { error: GENERIC_FAILURE_MESSAGE }
    }
  }
}

interface MarkCompleteDeps {
  orderId: string
  toast: ToastFn
  notifyChange: () => void
  setErrorMessage: (message: string | null) => void
  setIsAdvancing: (busy: boolean) => void
}

/**
 * Builds the forward-transition handler (scheduled → completed). No confirm
 * dialog — the error surface is the inline alert, so an `{ error }` result and
 * a transport rejection both land in `setErrorMessage` rather than a return
 * value, and `setIsAdvancing` always resets (EH-01).
 */
function makeMarkComplete(deps: MarkCompleteDeps) {
  return async (): Promise<void> => {
    deps.setErrorMessage(null)
    deps.setIsAdvancing(true)
    try {
      const result = await updateOrderStatus(deps.orderId, 'completed')
      if ('error' in result) {
        deps.setErrorMessage(result.error)
        return
      }
      deps.toast('Order marked as complete.', 'success')
      deps.notifyChange()
    } catch (cause) {
      console.error('useStatusActions: mark-complete failed', {
        orderId: deps.orderId,
        cause,
      })
      deps.setErrorMessage(GENERIC_FAILURE_MESSAGE)
    } finally {
      deps.setIsAdvancing(false)
    }
  }
}

/**
 * State and handlers behind `OrderStatusActions`: the forward transition
 * (mark complete), the two confirmed transitions (cancel, revert), and the
 * open state of their confirmation dialogs. The handlers themselves are built
 * by the module-level factories above; this hook only wires state to them.
 */
export function useStatusActions(options: StatusActionsOptions) {
  const { orderId, onStatusChange, onDialogOpenChange } = options
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [isAdvancing, setIsAdvancing] = useState(false)
  const [cancelOpen, openCancel] = useConfirmDialog(onDialogOpenChange)
  const [revertOpen, openRevert] = useConfirmDialog(onDialogOpenChange)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const notifyChange = useCallback(() => {
    startTransition(() => {
      router.refresh()
    })
    onStatusChange?.()
  }, [router, onStatusChange])

  const markComplete = useMemo(
    () => makeMarkComplete({ orderId, toast, notifyChange, setErrorMessage, setIsAdvancing }),
    [orderId, toast, notifyChange],
  )

  const handleCancelConfirm = useMemo(
    () =>
      makeConfirmHandler(() => updateOrderStatus(orderId, 'cancelled'),
        { orderId, successMessage: 'Order cancelled.', close: openCancel, toast, notifyChange }),
    [orderId, openCancel, toast, notifyChange],
  )

  const handleRevertConfirm = useMemo(
    () =>
      makeConfirmHandler(() => revertOrderToScheduled(orderId),
        { orderId, successMessage: 'Order reverted to scheduled.', close: openRevert, toast, notifyChange }),
    [orderId, openRevert, toast, notifyChange],
  )

  return {
    errorMessage,
    disabled: isAdvancing || isPending,
    cancelOpen,
    openCancel,
    revertOpen,
    openRevert,
    markComplete,
    handleCancelConfirm,
    handleRevertConfirm,
  }
}
