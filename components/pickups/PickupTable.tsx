'use client'

import { useCallback, useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useReducedMotion } from 'framer-motion'
import PickupRow from './PickupRow'
import {
  PickupColumnHeaders,
  PickupEmptyState,
  PickupTableHeader,
} from './PickupTableParts'
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
      <PickupTableHeader
        status={status}
        search={search}
        onNewPickup={onNewPickup}
        onStatusChange={handleStatusChange}
        onSearchChange={handleSearchChange}
      />

      <div
        className={`flex-1 overflow-y-auto transition-opacity ${
          isPending ? 'opacity-60' : 'opacity-100'
        }`}
      >
        {pickups.length === 0 ? (
          <PickupEmptyState hasSearch={Boolean(search.trim())} hasFilter={status !== 'all'} />
        ) : (
          <table className="w-full border-collapse">
            <PickupColumnHeaders />
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
