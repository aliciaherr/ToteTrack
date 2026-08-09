'use client'

import CancelOrderDialog from './CancelOrderDialog'
import RevertOrderDialog from './RevertOrderDialog'
import { ActionRow, StatusButton } from './OrderStatusActionsParts'
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

/** Everything `useStatusActions` hands back, passed whole to one branch. */
type StatusActions = ReturnType<typeof useStatusActions>

/** The forward path on a scheduled order: complete it, or cancel it. */
function ScheduledActions({
  actions,
  poNumber,
  leadingAction,
}: {
  actions: StatusActions
  poNumber: string
  leadingAction?: React.ReactNode
}) {
  const { errorMessage, disabled, cancelOpen, openCancel } = actions

  return (
    <ActionRow
      errorMessage={errorMessage}
      leadingAction={leadingAction}
      confirmDialog={
        <CancelOrderDialog
          open={cancelOpen}
          poNumber={poNumber}
          onCancel={() => openCancel(false)}
          onConfirm={actions.handleCancelConfirm}
        />
      }
    >
      <StatusButton onClick={actions.markComplete} disabled={disabled}>
        Mark as Complete
      </StatusButton>
      <StatusButton variant="destructive" onClick={() => openCancel(true)} disabled={disabled}>
        Cancel Order
      </StatusButton>
    </ActionRow>
  )
}

/** The undo path — an invoiced revert also recomputes or deletes the invoice. */
function RevertAction({
  actions,
  poNumber,
  currentStatus,
  leadingAction,
}: {
  actions: StatusActions
  poNumber: string
  currentStatus: PoStatus
  leadingAction?: React.ReactNode
}) {
  const { errorMessage, disabled, revertOpen, openRevert } = actions

  return (
    <ActionRow
      errorMessage={errorMessage}
      leadingAction={leadingAction}
      confirmDialog={
        <RevertOrderDialog
          open={revertOpen}
          poNumber={poNumber}
          currentStatus={currentStatus}
          onCancel={() => openRevert(false)}
          onConfirm={actions.handleRevertConfirm}
        />
      }
    >
      <StatusButton variant="outline" onClick={() => openRevert(true)} disabled={disabled}>
        Revert to Scheduled
      </StatusButton>
    </ActionRow>
  )
}

/**
 * Renders the status-transition buttons for the selected order. Branches on
 * the current status:
 *   - `scheduled` → "Mark as Complete" + "Cancel Order" (forward path)
 *   - `completed` / `cancelled` / `invoiced` → "Revert to Scheduled" (undo path)
 *
 * Both paths surface a confirmation dialog before the server action fires, and
 * both lay out through the same `ActionRow`. All mutation state lives in
 * `useStatusActions` and is held *here*, above the branch, so a status change
 * swaps the buttons without resetting an in-flight error or open confirm.
 */
export default function OrderStatusActions({
  orderId,
  poNumber,
  currentStatus,
  onStatusChange,
  onDialogOpenChange,
  leadingAction,
}: OrderStatusActionsProps) {
  const actions = useStatusActions({ orderId, onStatusChange, onDialogOpenChange })

  if (currentStatus === 'scheduled') {
    return (
      <ScheduledActions actions={actions} poNumber={poNumber} leadingAction={leadingAction} />
    )
  }

  return (
    <RevertAction
      actions={actions}
      poNumber={poNumber}
      currentStatus={currentStatus}
      leadingAction={leadingAction}
    />
  )
}
