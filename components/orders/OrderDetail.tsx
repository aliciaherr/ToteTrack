'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import OrderStatusActions from './OrderStatusActions'
import OrderStatusBadge from './OrderStatusBadge'
import {
  PODocumentSlot,
  QuantitiesBlock,
  TotalPriceBlock,
  DetailMetaGrid,
  DeliveryAddressBlock,
  NotesBlock,
} from './OrderDetailParts'
import type { OrderDetail as OrderDetailType } from '@/db/queries/orders'

interface OrderDetailProps {
  detail: OrderDetailType | null
  onEdit?: () => void
}

const EDIT_LOCK_HINT = 'Revert this PO to Scheduled to edit quantities or price.'

function isEditLocked(status: OrderDetailType['status']): boolean {
  return status === 'invoiced' || status === 'cancelled'
}

/**
 * Right-panel placeholder shown when no order is selected. Exported so the
 * parent layout can render it directly without mounting a null-stub detail.
 */
export function OrderDetailEmptyState() {
  return (
    <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-8 text-center">
      Select an order to view details.
    </div>
  )
}

function DetailHeader({
  detail,
  onEdit,
}: {
  detail: OrderDetailType
  onEdit?: () => void
}) {
  const customerLabel = detail.customer_name ?? 'Unknown customer'
  const editLocked = isEditLocked(detail.status)
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1.5 min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground truncate">
          {detail.po_number}
        </h2>
        <Link
          href={`/customers?id=${detail.customer_id}`}
          className="inline-flex items-center gap-2 text-sm text-primary hover:underline min-h-[44px]"
        >
          <span
            aria-hidden="true"
            className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[11px] font-semibold select-none"
          >
            {customerLabel.trim()[0]?.toUpperCase() ?? '?'}
          </span>
          <span>{customerLabel}</span>
        </Link>
      </div>
      {onEdit && (
        <Button
          variant="outline"
          onClick={onEdit}
          disabled={editLocked}
          aria-label={`Edit order ${detail.po_number}`}
          title={editLocked ? EDIT_LOCK_HINT : undefined}
          className="min-h-[44px] shrink-0"
        >
          Edit
        </Button>
      )}
    </div>
  )
}

// OrderStatusActions returns null for terminal states, so the slot shows
// only the badge — matching the "no buttons, status badge only" spec.
function StatusActionsSlot({ detail }: { detail: OrderDetailType }) {
  return (
    <section
      aria-label="Order status"
      className="rounded-lg border border-border bg-card p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Status
        </span>
        <OrderStatusBadge status={detail.status} />
      </div>
      <OrderStatusActions
        orderId={detail.id}
        poNumber={detail.po_number}
        currentStatus={detail.status}
      />
    </section>
  )
}

/**
 * Right-panel order detail view. Renders the PO header, status actions,
 * PO document slot, the 2×3 quantity grid, prominent total price, the
 * remaining metadata, delivery address (hidden when pickup_only), and
 * notes. Returns the empty state when `detail` is null.
 */
export default function OrderDetail({ detail, onEdit }: OrderDetailProps) {
  if (!detail) return <OrderDetailEmptyState />

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <DetailHeader detail={detail} onEdit={onEdit} />
      <StatusActionsSlot detail={detail} />
      <PODocumentSlot detail={detail} />
      <QuantitiesBlock detail={detail} />
      <TotalPriceBlock price={detail.price} />
      <DetailMetaGrid detail={detail} />
      {!detail.pickup_only && (
        <DeliveryAddressBlock address={detail.delivery_address} />
      )}
      <NotesBlock notes={detail.notes} />
    </div>
  )
}
