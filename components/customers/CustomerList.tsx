'use client'

import { useTransition, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useReducedMotion } from 'framer-motion'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import CustomerStatusToggle from './CustomerStatusToggle'
import CustomerRow from './CustomerRow'
import type {
  CustomerListRow,
  CustomerListSort,
  CustomerListStatus,
} from '@/db/queries/customers'

const SORT_LABELS: Record<CustomerListSort, string> = {
  alphabetical: 'Alphabetical',
  order_count: 'Order Count',
  need_to_contact: 'Need to Contact',
}

interface CustomerListProps {
  customers: CustomerListRow[]
  selectedId: string | null
  status: CustomerListStatus
  search: string
  sort: CustomerListSort
  onNewCustomer: () => void
}

function buildHref(updates: Record<string, string | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined && value !== '') params.set(key, value)
  }
  const query = params.toString()
  return query ? `/customers?${query}` : '/customers'
}

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="px-4 py-12 text-center text-sm text-muted-foreground">
      {hasSearch
        ? 'No customers match that search.'
        : 'No customers yet. Add your first customer.'}
    </div>
  )
}

export default function CustomerList({
  customers,
  selectedId,
  status,
  search,
  sort,
  onNewCustomer,
}: CustomerListProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const shouldReduceMotion = Boolean(useReducedMotion())

  const navigate = useCallback(
    (next: { status?: CustomerListStatus; search?: string; sort?: CustomerListSort }) => {
      const href = buildHref({
        status: next.status ?? status,
        search: next.search ?? (search || undefined),
        sort: next.sort ?? sort,
        id: selectedId ?? undefined,
      })
      startTransition(() => router.push(href))
    },
    [router, status, search, sort, selectedId],
  )

  const hasSearchTerm = Boolean(search.trim())

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      <div className="pl-20 pr-4 py-4 border-b border-border space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              defaultValue={search}
              placeholder="Search customers..."
              aria-label="Search customers"
              onChange={(event) => navigate({ search: event.target.value })}
              className="w-full pl-9 pr-3 h-11 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
            />
          </div>
          <Button onClick={onNewCustomer} className="min-h-[44px]" aria-label="Add new customer">
            + New
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <CustomerStatusToggle status={status} onChange={(next) => navigate({ status: next })} />
          <label className="text-xs text-muted-foreground flex items-center gap-2">
            Sort
            <select
              value={sort}
              onChange={(event) => navigate({ sort: event.target.value as CustomerListSort })}
              aria-label="Sort customers"
              className="min-h-[44px] text-sm bg-card border border-border rounded-md px-2"
            >
              {(Object.keys(SORT_LABELS) as CustomerListSort[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div
        className={`flex-1 overflow-y-auto transition-opacity ${isPending ? 'opacity-60' : 'opacity-100'}`}
      >
        {customers.length === 0 ? (
          <EmptyState hasSearch={hasSearchTerm} />
        ) : (
          <ul role="list">
            {customers.map((customer, index) => (
              <CustomerRow
                key={customer.id}
                customer={customer}
                isSelected={selectedId === customer.id}
                animationIndex={index}
                shouldReduceMotion={shouldReduceMotion}
                href={buildHref({
                  id: customer.id,
                  status,
                  search: search || undefined,
                  sort,
                })}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
