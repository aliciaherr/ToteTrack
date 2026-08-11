'use client'

import { useCallback, useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useReducedMotion } from 'framer-motion'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import PickupStatusTabs from './PickupStatusTabs'
import PickupRow from './PickupRow'
import type { PickupListStatus, PickupTableRow } from '@/db/queries/pickups'

// The list is unbounded (no pagination), so every keystroke would refetch the
// full result set. Wait for a pause in typing before navigating.
const SEARCH_DEBOUNCE_MS = 250

interface PickupTableProps {
  pickups: PickupTableRow[]
  status: PickupListStatus
  search: string
  selectedId: string | null
  onNewPickup: () => void
}

/**
 * Single href builder for both the status tabs and the row links, so switching
 * tabs or selecting a pickup always carries the other params along.
 * @param status Active status filter; `'all'` is omitted from the query.
 * @param search Active search term; blank is omitted.
 * @param pickupId Pickup to select, or null for no selection.
 * @returns A `/pickups` URL carrying every non-default param.
 */
export function buildPickupsHref(
  status: PickupListStatus,
  search: string,
  pickupId: string | null,
): string {
  const params = new URLSearchParams()
  if (status !== 'all') params.set('status', status)
  if (search.trim()) params.set('search', search)
  if (pickupId) params.set('id', pickupId)
  const query = params.toString()
  return query ? `/pickups?${query}` : '/pickups'
}

function EmptyState({ hasSearch, hasFilter }: { hasSearch: boolean; hasFilter: boolean }) {
  return (
    <div className="px-4 py-12 text-center text-sm text-muted-foreground">
      {hasSearch
        ? 'No pickups match that search.'
        : hasFilter
          ? 'No pickups match this filter.'
          : 'No pickups yet.'}
    </div>
  )
}

function TableHeader() {
  return (
    <thead className="sticky top-0 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
      <tr>
        <th scope="col" className="px-4 py-3 text-left font-medium">Customer</th>
        <th scope="col" className="px-4 py-3 text-right font-medium">275</th>
        <th scope="col" className="px-4 py-3 text-right font-medium">330</th>
        <th scope="col" className="px-4 py-3 text-left font-medium">Status</th>
        <th scope="col" className="px-4 py-3 text-left font-medium">Date</th>
      </tr>
    </thead>
  )
}

/**
 * Pickups table with status filter tabs, a customer search box, the
 * "+ New Pickup" button and the row list. Filter state is driven by URL query
 * params (`status`, `search`, `id`) so the server-rendered row list always
 * reflects the active view; every row is rendered in one scroll. Tab changes
 * and row clicks preserve the active search term. There is no delete control
 * anywhere on this table — cancelling a pickup is the only removal.
 */
export default function PickupTable({
  pickups,
  status,
  search,
  selectedId,
  onNewPickup,
}: PickupTableProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const shouldReduceMotion = Boolean(useReducedMotion())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    },
    [],
  )

  const handleStatusChange = useCallback(
    (nextStatus: PickupListStatus) => {
      const href = buildPickupsHref(nextStatus, search, selectedId)
      startTransition(() => router.push(href))
    },
    [router, search, selectedId],
  )

  const handleSearchChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const term = event.target.value
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const href = buildPickupsHref(status, term, selectedId)
        startTransition(() => router.push(href))
      }, SEARCH_DEBOUNCE_MS)
    },
    [router, status, selectedId],
  )

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="pl-20 pr-4 pt-4 pb-3 border-b border-border space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-foreground">Tote Pickups</h1>
          <Button
            onClick={onNewPickup}
            className="min-h-[44px]"
            aria-label="Create new pickup"
          >
            + New Pickup
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3">
          <PickupStatusTabs status={status} onChange={handleStatusChange} />
          <div className="relative w-64 max-w-[50%]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              type="search"
              defaultValue={search}
              placeholder="Search customer..."
              aria-label="Search pickups"
              onChange={handleSearchChange}
              className="w-full pl-9 pr-3 h-11 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
            />
          </div>
        </div>
      </div>

      <div
        className={`flex-1 overflow-y-auto transition-opacity ${
          isPending ? 'opacity-60' : 'opacity-100'
        }`}
      >
        {pickups.length === 0 ? (
          <EmptyState hasSearch={Boolean(search.trim())} hasFilter={status !== 'all'} />
        ) : (
          <table className="w-full border-collapse">
            <TableHeader />
            <tbody>
              {pickups.map((pickup, index) => (
                <PickupRow
                  key={pickup.id}
                  pickup={pickup}
                  isSelected={selectedId === pickup.id}
                  animationIndex={index}
                  shouldReduceMotion={shouldReduceMotion}
                  href={buildPickupsHref(status, search, pickup.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
