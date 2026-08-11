'use client'

import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { buildListItemMotionProps } from '@/lib/list-animation'
// `formatPoTotal` is the shared "0 renders as an em dash" count formatter from
// the orders table. Reused verbatim so a zero count looks identical on both
// tables; nothing about it is purchase-order-specific despite the name.
import { formatPoTotal } from '@/components/shared/qtyGridValues'
import PickupStatusBadge from './PickupStatusBadge'
import type { PickupTableRow } from '@/db/queries/pickups'

interface PickupRowProps {
  pickup: PickupTableRow
  isSelected: boolean
  href: string
  animationIndex: number
  shouldReduceMotion: boolean
}

function CustomerCell({ name }: { name: string }) {
  const initial = name.trim()[0]?.toUpperCase() ?? '?'
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span
        aria-hidden="true"
        className="shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[11px] font-semibold select-none"
      >
        {initial}
      </span>
      <span className="truncate text-foreground">{name}</span>
    </div>
  )
}

/**
 * One row of the pickups table: customer, the two tote counts, status and the
 * pickup date. A zero count and a missing date both render as an em dash.
 * Clicking or pressing Enter/Space navigates to `href`, which selects the
 * pickup in the right-hand panel.
 */
export default function PickupRow({
  pickup,
  isSelected,
  href,
  animationIndex,
  shouldReduceMotion,
}: PickupRowProps) {
  const router = useRouter()
  const customerLabel = pickup.customer_name ?? 'Unknown customer'
  const dateLabel = pickup.pickup_date ?? '—'

  const handleActivate = () => router.push(href)
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleActivate()
    }
  }

  return (
    <motion.tr
      {...buildListItemMotionProps(animationIndex, shouldReduceMotion)}
      onClick={handleActivate}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      aria-current={isSelected ? 'true' : undefined}
      aria-label={`Pickup for ${customerLabel} ${
        pickup.pickup_date ? `on ${pickup.pickup_date}` : '(unscheduled)'
      }`}
      className={`cursor-pointer outline-none transition-colors border-b border-border ${
        isSelected
          ? 'bg-primary/5 border-l-2 border-l-primary'
          : 'hover:bg-muted even:bg-muted/30 focus-visible:bg-muted'
      }`}
    >
      <td className="px-4 py-3 text-sm min-w-0">
        <CustomerCell name={customerLabel} />
      </td>
      <td className="px-4 py-3 text-sm text-foreground tabular-nums text-right whitespace-nowrap">
        {formatPoTotal(pickup.qty_275)}
      </td>
      <td className="px-4 py-3 text-sm text-foreground tabular-nums text-right whitespace-nowrap">
        {formatPoTotal(pickup.qty_330)}
      </td>
      <td className="px-4 py-3">
        <PickupStatusBadge status={pickup.status} size="sm" />
      </td>
      <td className="px-4 py-3 text-sm text-foreground whitespace-nowrap">{dateLabel}</td>
    </motion.tr>
  )
}
