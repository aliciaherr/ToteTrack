'use client'

import { Button } from '@/components/ui/button'
import CancelOrderDialog from './CancelOrderDialog'
import RevertOrderDialog from './RevertOrderDialog'
import { useStatusActions } from './useStatusActions'
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
  /**
   * Rendered first in the button row, ahead of the status buttons. The calendar
   * popup passes its Contact menu; the Orders tab passes nothing, and with it
   * undefined the row renders exactly as it did before the prop existed.
   */
  leadingAction?: React.ReactNode
}

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
      className="min-h-[44px] shrink-0 whitespace-nowrap px-3"
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
 * server action fires. All mutation state lives in `useStatusActions`.
 *
 * Both branches lay out identically: one `flex-nowrap` row that starts with
 * `leadingAction`. `nowrap` because the widest case — Contact + Mark as
 * Complete + Cancel Order — has to hold one line inside the calendar popup's
 * ~400px usable width, and a wrapped third button there reads as a separate
 * section rather than a peer of the other two.
 */
export default function OrderStatusActions({
  orderId,
  poNumber,
  currentStatus,
  onStatusChange,
  onDialogOpenChange,
  leadingAction,
}: OrderStatusActionsProps) {
  const {
    errorMessage,
    disabled,
    cancelOpen,
    openCancel,
    revertOpen,
    openRevert,
    markComplete,
    handleCancelConfirm,
    handleRevertConfirm,
  } = useStatusActions({ orderId, onStatusChange, onDialogOpenChange })

  if (currentStatus === 'scheduled') {
    return (
      <div className="space-y-2">
        {errorMessage && <ErrorAlert message={errorMessage} />}
        <div className="flex flex-nowrap items-center gap-2">
          {leadingAction}
          <StatusButton onClick={markComplete} disabled={disabled}>
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
      <div className="flex flex-nowrap items-center gap-2">
        {leadingAction}
        <StatusButton variant="outline" onClick={() => openRevert(true)} disabled={disabled}>
          Revert to Scheduled
        </StatusButton>
      </div>
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
