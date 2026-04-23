'use client'

import type { CustomerListStatus } from '@/db/queries/customers'

const STATUS_OPTIONS: { value: CustomerListStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

interface CustomerStatusToggleProps {
  status: CustomerListStatus
  onChange: (next: CustomerListStatus) => void
}

export default function CustomerStatusToggle({ status, onChange }: CustomerStatusToggleProps) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-card p-0.5" role="tablist">
      {STATUS_OPTIONS.map(({ value, label }) => {
        const isActive = status === value
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(value)}
            className={`min-h-[44px] px-4 text-sm font-medium rounded-md transition-colors ${
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-secondary hover:bg-muted'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
