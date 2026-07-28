'use client'

import { useCallback, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import CancelOrderDialog from './CancelOrderDialog'
import RevertOrderDialog from './RevertOrderDialog'
import { updateOrderStatus } from '@/lib/actions/orders'
import { revertOrderToScheduled } from '@/lib/actions/orders.revert'
import { useToast } from '@/lib/hooks/useToast'
import type { PoStatus } from '@/db/queries/orders'

interface OrderStatusActionsProps {
  orderId: string
  poNumber: string
  currentStatus: PoStatus
  onStatusChange?: () => void
  /**
   * Reports whether this block's confirmation dialog is open. Unused on the
   * Orders tab; the calendar popup passes it because the confirm mounts inside
   * a dialog that also listens for Escape (see `useNestedDialog`).
   */
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

type Advance = 'completed'

function ErrorAlert({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md bg-destructive/10 text-destructive text-sm px-3 py-2"
    >
      {message}
    </div>
  )
}

/** One status button. 44px tall, whatever the branch — the touch-target floor. */
function StatusButton({
  variant,
  onClick,
  disabled,
  children,
}: {
  variant?: 'destructive' | 'outline'
  onClick: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant={variant}
      onClick={onClick}
      disabled={disabled}
      className="min-h-[44px]"
    >
      {children}
    </Button>
  )
}

/**
 * Renders the status-transition buttons for the selected order. Branches on
 * the current status:
 *   - `scheduled` → "Mark as Complete" + "Cancel Order" (forward path)
 *   - `completed` / `cancelled` / `invoiced` → "Revert to Scheduled" (undo
 *     path — invoiced reverts also recompute or delete the parent invoice)
 *
 * Both forward and undo paths surface a confirmation dialog before the
 * server action fires.
 */
export default function OrderStatusActions({
  orderId,
  poNumber,
  currentStatus,
  onStatusChange,
  onDialogOpenChange,
}: OrderStatusActionsProps) {
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

  const advance = useCallback(
    async (target: Advance) => {
      setErrorMessage(null)
      setIsAdvancing(true)
      try {
        const result = await updateOrderStatus(orderId, target)
        if ('error' in result) {
          setErrorMessage(result.error)
          return
        }
        toast('Order marked as complete.', 'success')
        notifyChange()
      } finally {
        setIsAdvancing(false)
      }
    },
    [orderId, notifyChange, toast],
  )

  const handleCancelConfirm = useCallback(async () => {
    const result = await updateOrderStatus(orderId, 'cancelled')
    if ('success' in result) {
      openCancel(false)
      toast('Order cancelled.', 'success')
      notifyChange()
    }
    return result
  }, [orderId, notifyChange, openCancel, toast])

  const handleRevertConfirm = useCallback(async () => {
    const result = await revertOrderToScheduled(orderId)
    if ('success' in result) {
      openRevert(false)
      toast('Order reverted to scheduled.', 'success')
      notifyChange()
    }
    return result
  }, [orderId, notifyChange, openRevert, toast])

  const disabled = isAdvancing || isPending

  if (currentStatus === 'scheduled') {
    return (
      <div className="space-y-2">
        {errorMessage && <ErrorAlert message={errorMessage} />}
        <div className="flex flex-wrap items-center gap-2">
          <StatusButton onClick={() => advance('completed')} disabled={disabled}>
            Mark as Complete
          </StatusButton>
          <StatusButton
            variant="destructive"
            onClick={() => openCancel(true)}
            disabled={disabled}
          >
            Cancel Order
          </StatusButton>
        </div>
        <CancelOrderDialog
          open={cancelOpen}
          poNumber={poNumber}
          onCancel={() => openCancel(false)}
          onConfirm={handleCancelConfirm}
        />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {errorMessage && <ErrorAlert message={errorMessage} />}
      <StatusButton variant="outline" onClick={() => openRevert(true)} disabled={disabled}>
        Revert to Scheduled
      </StatusButton>
      <RevertOrderDialog
        open={revertOpen}
        poNumber={poNumber}
        currentStatus={currentStatus}
        onCancel={() => openRevert(false)}
        onConfirm={handleRevertConfirm}
      />
    </div>
  )
}
