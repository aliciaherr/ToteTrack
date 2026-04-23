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

function AdvanceButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-[44px]"
    >
      {children}
    </Button>
  )
}

function CancelButton({
  onClick,
  disabled,
}: {
  onClick: () => void
  disabled: boolean
}) {
  return (
    <Button
      type="button"
      variant="destructive"
      onClick={onClick}
      disabled={disabled}
      className="min-h-[44px]"
    >
      Cancel Order
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
}: OrderStatusActionsProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [isPending, startTransition] = useTransition()
  const [isAdvancing, setIsAdvancing] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [revertOpen, setRevertOpen] = useState(false)
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
      setCancelOpen(false)
      toast('Order cancelled.', 'success')
      notifyChange()
    }
    return result
  }, [orderId, notifyChange, toast])

  const handleRevertConfirm = useCallback(async () => {
    const result = await revertOrderToScheduled(orderId)
    if ('success' in result) {
      setRevertOpen(false)
      toast('Order reverted to scheduled.', 'success')
      notifyChange()
    }
    return result
  }, [orderId, notifyChange, toast])

  const disabled = isAdvancing || isPending

  if (currentStatus === 'scheduled') {
    return (
      <div className="space-y-2">
        {errorMessage && <ErrorAlert message={errorMessage} />}
        <div className="flex flex-wrap items-center gap-2">
          <AdvanceButton onClick={() => advance('completed')} disabled={disabled}>
            Mark as Complete
          </AdvanceButton>
          <CancelButton onClick={() => setCancelOpen(true)} disabled={disabled} />
        </div>
        <CancelOrderDialog
          open={cancelOpen}
          poNumber={poNumber}
          onCancel={() => setCancelOpen(false)}
          onConfirm={handleCancelConfirm}
        />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {errorMessage && <ErrorAlert message={errorMessage} />}
      <Button
        type="button"
        variant="outline"
        onClick={() => setRevertOpen(true)}
        disabled={disabled}
        className="min-h-[44px]"
      >
        Revert to Scheduled
      </Button>
      <RevertOrderDialog
        open={revertOpen}
        poNumber={poNumber}
        currentStatus={currentStatus}
        onCancel={() => setRevertOpen(false)}
        onConfirm={handleRevertConfirm}
      />
    </div>
  )
}
