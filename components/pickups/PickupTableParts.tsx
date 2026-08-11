'use client'

import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import PickupStatusTabs from './PickupStatusTabs'
import type { PickupListStatus } from '@/db/queries/pickups'

// Presentational pieces of `PickupTable`, split out when the renderer passed the
// 80-line JSX cap (CQ-01 under CONSTRAINT-14). Same `*Parts` idiom as
// `PickupDetailParts`, `DayColumnParts` and `PickupHistoryParts`. Nothing here
// is used outside the table.

/**
 * The message shown when the list comes back empty, worded for the reason it is
 * empty — a fruitless search reads very differently from a table with no rows in
 * it at all, and "No pickups yet." on a filtered view would look like data loss.
 */
export function PickupEmptyState({
  hasSearch,
  hasFilter,
}: {
  hasSearch: boolean
  hasFilter: boolean
}) {
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

/** The table's sticky column headings. */
export function PickupColumnHeaders() {
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

interface PickupTableHeaderProps {
  status: PickupListStatus
  search: string
  onNewPickup: () => void
  onStatusChange: (next: PickupListStatus) => void
  onSearchChange: (event: React.ChangeEvent<HTMLInputElement>) => void
}

/**
 * The band above the rows: screen title, the create action, the status tabs and
 * the customer search box.
 *
 * The search input stays **uncontrolled** (`defaultValue`) on purpose. Its value
 * is debounced into the URL, so binding it to the `search` prop would make every
 * keystroke wait a round trip through the router before the character appeared.
 * Remounting is what resyncs it, and only a navigation away does that.
 */
export function PickupTableHeader({
  status,
  search,
  onNewPickup,
  onStatusChange,
  onSearchChange,
}: PickupTableHeaderProps) {
  return (
    <div className="pl-20 pr-4 pt-4 pb-3 border-b border-border space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">Tote Pickups</h1>
        <Button onClick={onNewPickup} className="min-h-[44px]" aria-label="Create new pickup">
          + New Pickup
        </Button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <PickupStatusTabs status={status} onChange={onStatusChange} />
        <div className="relative w-64 max-w-[50%]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            defaultValue={search}
            placeholder="Search customer..."
            aria-label="Search pickups"
            onChange={onSearchChange}
            className="w-full pl-9 pr-3 h-11 text-sm bg-muted rounded-lg border-0 focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground"
          />
        </div>
      </div>
    </div>
  )
}
