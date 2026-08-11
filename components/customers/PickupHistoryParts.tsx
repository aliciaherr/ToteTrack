'use client'

import { useRouter } from 'next/navigation'
import { formatPoTotal } from '@/components/shared/qtyGridValues'
import PickupStatusBadge from '@/components/pickups/PickupStatusBadge'
import type { CustomerPickupRow } from '@/db/queries/pickups'

function PickupRowItem({ pickup }: { pickup: CustomerPickupRow }) {
  const router = useRouter()
  const goToPickup = () => router.push(`/pickups?id=${pickup.id}`)
  return (
    <tr
      role="link"
      tabIndex={0}
      aria-label={
        pickup.pickup_date ? `View pickup on ${pickup.pickup_date}` : 'View pickup'
      }
      onClick={goToPickup}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          goToPickup()
        }
      }}
      className="border-b border-border last:border-0 cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <td className="py-3 px-3 text-sm text-secondary">{pickup.pickup_date ?? '—'}</td>
      <td className="py-3 px-3 text-sm text-foreground tabular-nums text-right">
        {formatPoTotal(pickup.qty_275)}
      </td>
      <td className="py-3 px-3 text-sm text-foreground tabular-nums text-right">
        {formatPoTotal(pickup.qty_330)}
      </td>
      <td className="py-3 px-3 text-sm">
        <PickupStatusBadge status={pickup.status} size="sm" />
      </td>
    </tr>
  )
}

/**
 * Row table for the Pickup History panel, split out of `PickupHistory` under
 * the `OrderDetail`/`OrderDetailParts` idiom when the panel outgrew the CQ-02
 * 200-line component cap.
 *
 * Renders exactly the rows it is handed — the window filter lives in
 * `getCustomerPickups`, and undated pickups are deliberately not among them.
 * They are reported by the header count instead, so a dateless row can never
 * appear under a date-ordered list.
 */
export function PickupsTable({ pickups }: { pickups: CustomerPickupRow[] }) {
  if (pickups.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm text-muted-foreground">
        No pickups in this window.
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
            <th className="py-2 px-3 font-medium">Date</th>
            <th className="py-2 px-3 font-medium text-right">275</th>
            <th className="py-2 px-3 font-medium text-right">330</th>
            <th className="py-2 px-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {pickups.map((pickup) => (
            <PickupRowItem key={pickup.id} pickup={pickup} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
