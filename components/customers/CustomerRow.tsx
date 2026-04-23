'use client'

import { motion } from 'framer-motion'
import { useRouter } from 'next/navigation'
import { buildListItemMotionProps } from '@/lib/list-animation'
import type { CustomerListRow } from '@/db/queries/customers'

interface CustomerRowProps {
  customer: CustomerListRow
  isSelected: boolean
  href: string
  animationIndex: number
  shouldReduceMotion: boolean
}

export default function CustomerRow({
  customer,
  isSelected,
  href,
  animationIndex,
  shouldReduceMotion,
}: CustomerRowProps) {
  const router = useRouter()
  const isOverdue = customer.overdue_days !== null && customer.overdue_days > 0

  return (
    <motion.li {...buildListItemMotionProps(animationIndex, shouldReduceMotion)}>
      <button
        type="button"
        onClick={() => router.push(href)}
        aria-current={isSelected ? 'true' : undefined}
        className={`w-full text-left flex items-start gap-3 px-4 py-3 min-h-[44px] border-b border-border transition-colors ${
          isSelected ? 'bg-primary/5 border-l-2 border-l-primary' : 'hover:bg-muted'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="font-medium text-foreground truncate">{customer.company_name}</div>
          {customer.primary_contact_name && (
            <div className="text-sm text-muted-foreground truncate">
              {customer.primary_contact_name}
              {customer.primary_contact_role ? ` — ${customer.primary_contact_role}` : ''}
            </div>
          )}
          <div className="text-xs text-muted-foreground mt-0.5">
            {customer.last_completed_date
              ? `Last sale: ${customer.last_completed_date}`
              : 'No completed orders yet'}
          </div>
        </div>
        {isOverdue && (
          <span className="shrink-0 self-center inline-flex items-center rounded-md bg-orange-100 text-orange-700 text-xs font-semibold px-2 py-1 uppercase tracking-wide">
            Contact Needed
          </span>
        )}
      </button>
    </motion.li>
  )
}
