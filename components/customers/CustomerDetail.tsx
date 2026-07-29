'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import CustomerAddresses from './CustomerAddresses'
import CustomerContactCard from './CustomerContactCard'
import OrderHistory from './OrderHistory'
import VolumeOverview from './VolumeOverview'
import type {
  CustomerDetail as CustomerDetailType,
  CustomerOrderRow,
  CustomerOrdersWindow,
  VolumeOverview as VolumeOverviewData,
} from '@/db/queries/customers'

interface CustomerDetailProps {
  detail: CustomerDetailType | null
  orders: CustomerOrderRow[]
  window: CustomerOrdersWindow
  volumeOverview: VolumeOverviewData
  onEdit: () => void
}

/**
 * Right-panel placeholder shown when no customer is selected. Exported so the
 * parent `CustomerLayout` can render it without requiring a null-stub detail
 * component to be mounted.
 */
export function CustomerDetailEmptyState() {
  return (
    <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-8 text-center">
      Select a customer to view details.
    </div>
  )
}

const NEW_ORDER_LINK_CLASS =
  'inline-flex items-center justify-center rounded-lg bg-primary text-primary-foreground min-h-[44px] px-4 text-sm font-medium hover:bg-primary/80 transition-colors'

function DetailHeader({
  companyName,
  newOrderHref,
  onEdit,
}: {
  companyName: string
  newOrderHref: string
  onEdit: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <h2 className="text-2xl font-semibold tracking-tight text-foreground">{companyName}</h2>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          onClick={onEdit}
          aria-label={`Edit ${companyName}`}
          className="min-h-[44px]"
        >
          Edit
        </Button>
        <Link
          href={newOrderHref}
          aria-label={`Create new order for ${companyName}`}
          className={NEW_ORDER_LINK_CLASS}
        >
          + New Order
        </Link>
      </div>
    </div>
  )
}

function frequencyLabel(detail: CustomerDetailType): string {
  if (detail.contact_frequency_days !== null) {
    return `Every ${detail.contact_frequency_days} days (manual)`
  }
  if (detail.auto_calculated_frequency_days !== null) {
    return `Auto (${detail.auto_calculated_frequency_days} days avg)`
  }
  return 'No frequency yet — needs at least 2 completed orders'
}

function FrequencyLine({ detail }: { detail: CustomerDetailType }) {
  return (
    <div className="text-sm text-secondary">
      <span className="text-xs uppercase tracking-wide text-muted-foreground mr-2">
        Contact Frequency
      </span>
      {frequencyLabel(detail)}
    </div>
  )
}

/**
 * Right-panel customer detail view. Renders the company header, primary
 * contact card (with collapsible more-contacts), contact-frequency line,
 * saved delivery addresses (Feature 14), and the order history table filtered
 * by the active time window. Renders the empty state when `detail` is null
 * (no row selected or stale id).
 */
export default function CustomerDetail({
  detail,
  orders,
  window,
  volumeOverview,
  onEdit,
}: CustomerDetailProps) {
  if (!detail) return <CustomerDetailEmptyState />

  const newOrderHref = `/orders?new=1&customerId=${detail.id}`

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <DetailHeader
        companyName={detail.company_name}
        newOrderHref={newOrderHref}
        onEdit={onEdit}
      />
      <CustomerContactCard
        contacts={detail.contacts}
        overdueDays={detail.overdue_days}
        lastCompletedDate={detail.last_completed_date}
      />
      <FrequencyLine detail={detail} />
      <CustomerAddresses customerId={detail.id} addresses={detail.addresses} />
      <VolumeOverview data={volumeOverview} />
      <OrderHistory orders={orders} window={window} />
    </div>
  )
}
