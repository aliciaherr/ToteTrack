'use client'

import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { buildListItemMotionProps } from '@/lib/list-animation'
import OrderStatusBadge from './OrderStatusBadge'
import BackhaulTag from '@/components/shared/BackhaulTag'
import { sumPoSize, formatPoTotal } from '@/components/shared/qtyGridValues'
import { formatCurrency } from '@/lib/format-currency'
import type { OrderTableRow } from '@/db/queries/orders'

interface OrderRowProps {
  order: OrderTableRow
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

export default function OrderRow({
  order,
  isSelected,
  href,
  animationIndex,
  shouldReduceMotion,
}: OrderRowProps) {
  const router = useRouter()
  const customerLabel = order.customer_name ?? 'Unknown customer'
  const total275 = sumPoSize(order, '275')
  const total330 = sumPoSize(order, '330')

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
        <CustomerCell name={customerLabel} />
      </td>
      <td className="px-4 py-3 text-sm text-foreground tabular-nums text-right whitespace-nowrap">
        {formatPoTotal(total275)}
      </td>
      <td className="px-4 py-3 text-sm text-foreground tabular-nums text-right whitespace-nowrap">
        {formatPoTotal(total330)}
      </td>
      <td className="px-4 py-3">
        <OrderStatusBadge status={order.status} size="sm" />
      </td>
      <td className="px-4 py-3 text-sm text-foreground whitespace-nowrap">
        {order.requested_delivery_date ?? '—'}
      </td>
      <td className="px-4 py-3 text-sm text-foreground text-right whitespace-nowrap">
        {formatCurrency(order.price)}
      </td>
      <td className="px-4 py-3 w-8 text-center">
        {order.backhaul && <BackhaulTag />}
      </td>
    </motion.tr>
  )
}
