'use client'

import CustomerDetail, { CustomerDetailEmptyState } from './CustomerDetail'
import CustomerForm from './CustomerForm'
import type {
  CustomerDetail as CustomerDetailType,
  CustomerOrderRow,
  CustomerOrdersWindow,
  VolumeOverview,
} from '@/db/queries/customers'
import type { CustomerPickupRow, CustomerPickupsWindow } from '@/db/queries/pickups'

/** Which of the three things the right panel is currently showing. */
export type RightPanelMode = 'detail' | 'new-customer' | 'edit-customer'

interface CustomerRightPanelProps {
  mode: RightPanelMode
  detail: CustomerDetailType | null
  orders: CustomerOrderRow[]
  window: CustomerOrdersWindow
  pickups: CustomerPickupRow[]
  pickupWindow: CustomerPickupsWindow
  unscheduledPickupCount: number
  volumeOverview: VolumeOverview
  onClosePanel: () => void
  onSaved: () => void
  onDeleted: () => void
  onEdit: () => void
}

/**
 * The Customers screen's right panel: the create form, the edit form, the
 * detail view, or the empty state — whichever the current mode calls for.
 *
 * Lifted out of `CustomerLayout` so that file stays a composition root that
 * owns state and wiring only (CQ-01). The mode-to-content decision lives here,
 * in one place, rather than as a closure inside the layout's body.
 *
 * `edit-customer` falls through to the detail branch when `detail` is null —
 * there is nothing to edit, and rendering an edit form with no initial record
 * would show empty fields that silently create rather than update.
 */
export default function CustomerRightPanel({
  mode,
  detail,
  orders,
  window,
  pickups,
  pickupWindow,
  unscheduledPickupCount,
  volumeOverview,
  onClosePanel,
  onSaved,
  onDeleted,
  onEdit,
}: CustomerRightPanelProps) {
  if (mode === 'new-customer') {
    return (
      <CustomerForm
        mode="create"
        onClose={onClosePanel}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    )
  }
  if (mode === 'edit-customer' && detail) {
    return (
      <CustomerForm
        mode="edit"
        initialDetail={detail}
        onClose={onClosePanel}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
    )
  }
  if (!detail) return <CustomerDetailEmptyState />
  return (
    <CustomerDetail
      detail={detail}
      orders={orders}
      window={window}
      pickups={pickups}
      pickupWindow={pickupWindow}
      unscheduledPickupCount={unscheduledPickupCount}
      volumeOverview={volumeOverview}
      onEdit={onEdit}
    />
  )
}
