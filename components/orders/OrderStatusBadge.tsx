import type { PoStatus } from '@/db/queries/orders'

const STATUS_STYLES: Record<PoStatus, { label: string; className: string }> = {
  scheduled: { label: 'Scheduled', className: 'bg-slate-100 text-slate-700' },
  completed: { label: 'Completed', className: 'bg-emerald-100 text-emerald-700' },
  // Red-orange for cancelled, mirroring the CONTACT NEEDED palette used
  // elsewhere for warning/destructive state without drifting into pure red.
  cancelled: { label: 'Cancelled', className: 'bg-orange-100 text-orange-700' },
  invoiced: { label: 'Invoiced', className: 'bg-primary/10 text-primary' },
}

const SIZE_STYLES = {
  md: 'text-xs px-2 py-1',
  sm: 'text-[10px] px-1.5 py-0.5',
} as const

export default function OrderStatusBadge({
  status,
  size = 'md',
}: {
  status: PoStatus
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
