import type { PickupStatus } from '@/db/queries/pickups'

// Same three-colour language as OrderStatusBadge so a status reads identically
// across the two verticals. A pickup has no `invoiced` state — it is never
// billed (CONSTRAINT-25) — so there are three entries here, not four.
const STATUS_STYLES: Record<PickupStatus, { label: string; className: string }> = {
  scheduled: { label: 'Scheduled', className: 'bg-slate-100 text-slate-700' },
  completed: { label: 'Completed', className: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'Cancelled', className: 'bg-orange-100 text-orange-700' },
}

const SIZE_STYLES = {
  md: 'text-xs px-2 py-1',
  sm: 'text-[10px] px-1.5 py-0.5',
} as const

/**
 * Coloured status pill for a pickup.
 * @param status The pickup's current status.
 * @param size `'sm'` for the table row, `'md'` (default) for the detail panel.
 */
export default function PickupStatusBadge({
  status,
  size = 'md',
}: {
  status: PickupStatus
  size?: 'sm' | 'md'
}) {
  const { label, className } = STATUS_STYLES[status]
  return (
    <span
      className={`inline-flex items-center rounded-md font-semibold whitespace-nowrap transition-colors duration-200 ease-in-out ${SIZE_STYLES[size]} ${className}`}
    >
      {label}
    </span>
  )
}
