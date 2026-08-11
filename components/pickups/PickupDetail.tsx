'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  PickupStatusBlock,
  ToteCountsBlock,
  TextBlock,
} from './PickupDetailParts'
import type { PickupDetail as PickupDetailType } from '@/db/queries/pickups'

interface PickupDetailProps {
  detail: PickupDetailType | null
  onEdit?: () => void
}

/**
 * Right-panel placeholder shown when no pickup is selected. Exported so the
 * parent layout can render it directly without mounting a null-stub detail.
 */
export function PickupDetailEmptyState() {
  return (
    <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-8 text-center">
      Select a pickup to view details.
    </div>
  )
}

function DetailHeader({
  detail,
  onEdit,
}: {
  detail: PickupDetailType
  onEdit?: () => void
}) {
  const customerLabel = detail.customer_name ?? 'Unknown customer'
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1.5 min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground truncate">
          Pickup
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
          aria-label="Edit pickup"
          className="min-h-[44px] shrink-0"
        >
          Edit
        </Button>
      )}
    </div>
  )
}

/**
 * Right-panel pickup detail view: customer header, the status block with its
 * transition buttons, the two tote counts, the pickup date, the collection
 * address and notes. Returns the empty state when `detail` is null. There is
 * no delete control — cancelling is the only removal (CONSTRAINT-25).
 */
export default function PickupDetail({ detail, onEdit }: PickupDetailProps) {
  if (!detail) return <PickupDetailEmptyState />

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      <DetailHeader detail={detail} onEdit={onEdit} />
      <PickupStatusBlock detail={detail} />
      <ToteCountsBlock detail={detail} />
      <TextBlock
        label="Pickup Date"
        value={detail.pickup_date}
        fallback="Unscheduled — no date set."
      />
      <TextBlock
        label="Collection Address"
        value={detail.address}
        fallback="No address on file."
      />
      <TextBlock label="Notes" value={detail.notes} fallback="No notes." />
    </div>
  )
}
