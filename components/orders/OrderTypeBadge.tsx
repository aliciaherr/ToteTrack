import type { ContainerType } from '@/db/queries/orders'

const TYPE_STYLES: Record<ContainerType, { label: string; className: string }> = {
  // Design tokens: rebottled = blue tint, reconditioned = teal tint (primary),
  // brand_new = dark/inverted per docs/design-decisions.md Orders section.
  rebottled: { label: 'Rebottled', className: 'bg-blue-100 text-blue-700' },
  reconditioned: { label: 'Reconditioned', className: 'bg-primary/10 text-primary' },
  brand_new: { label: 'Brand New', className: 'bg-secondary text-secondary-foreground' },
}

const SIZE_STYLES = {
  md: 'text-xs px-2 py-1',
  sm: 'text-[10px] px-1.5 py-0.5',
} as const

export default function OrderTypeBadge({
  type,
  size = 'md',
}: {
  type: ContainerType
  size?: 'sm' | 'md'
}) {
  const { label, className } = TYPE_STYLES[type]
  return (
    <span
      className={`inline-flex items-center rounded-md font-semibold whitespace-nowrap transition-colors duration-200 ease-in-out ${SIZE_STYLES[size]} ${className}`}
    >
      {label}
    </span>
  )
}
