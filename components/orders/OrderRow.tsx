'use client'

import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { buildListItemMotionProps } from '@/lib/list-animation'
import OrderTypeBadge from './OrderTypeBadge'
import OrderStatusBadge from './OrderStatusBadge'
import { formatCurrency } from '@/lib/format-currency'
import type { OrderTableRow } from '@/db/queries/orders'

interface OrderRowProps {
  order: OrderTableRow
  isSelected: boolean
  href: string
  animationIndex: number
  shouldReduceMotion: boolean
}

function BackhaulBadge() {
  return (
    <span className="inline-flex items-center rounded-md bg-primary/10 text-primary text-[10px] font-semibold px-1.5 py-0.5 uppercase tracking-wide">
      Backhaul
    </span>
  )
}

export default function OrderRow({
  order,
  isSelected,
  href,
  animationIndex,
  shouldReduceMotion,
}: OrderRowProps) {
  const router = useRouter()
  const customerLabel = order.customer_name ?? 'Unknown customer'

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
      aria-label={`Order ${order.po_number} for ${customerLabel}`}
      className={`cursor-pointer outline-none transition-colors border-b border-border ${
        isSelected
          ? 'bg-primary/5 border-l-2 border-l-primary'
          : 'hover:bg-muted even:bg-muted/30 focus-visible:bg-muted'
      }`}
    >
      <td className="px-4 py-3 text-sm font-medium text-foreground whitespace-nowrap">
        {order.po_number}
      </td>
      <td className="px-4 py-3 text-sm min-w-0">
        <span className="block truncate text-foreground">{customerLabel}</span>
      </td>
      <td className="px-4 py-3 text-sm text-foreground whitespace-nowrap">
        {order.quantity} × {order.container_size} gal
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col items-start gap-1">
          <OrderTypeBadge type={order.container_type} size="sm" />
          <OrderStatusBadge status={order.status} size="sm" />
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-foreground whitespace-nowrap">
        <div className="flex items-center gap-2">
          <span>{order.requested_delivery_date ?? '—'}</span>
          {order.backhaul && <BackhaulBadge />}
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-foreground text-right whitespace-nowrap">
        {formatCurrency(order.price)}
      </td>
    </motion.tr>
  )
}
