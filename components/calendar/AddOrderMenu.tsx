'use client'

import { useEffect } from 'react'
import { format } from 'date-fns'
import { formatProductionMix } from './productionCardFormat'
import type { CalendarOrderRow } from '@/db/queries/calendar'

interface AddOrderMenuProps {
  date: Date
  rows: CalendarOrderRow[]
  onPick: (orderId: string) => void
  onClose: () => void
}

/**
 * The per-day `+ Add order` list.
 *
 * Renders exactly the same unscheduled set as `UnscheduledCallout` — both take
 * `getUnscheduledOrders()` — so the two surfaces can never disagree about which
 * orders still need a date (CONSTRAINT-19). This one exists because dragging
 * from the callout to a distant week is a long gesture; picking a day and then
 * an order is the keyboard- and touch-friendly path to the same placement.
 *
 * Rows are plain buttons rather than `ProductionCard`s: at 176px the column is
 * too narrow for a card-in-a-menu, and the choice here is "which order", for
 * which the PO number and mix are enough.
 *
 * @param date The day a picked order will be placed on.
 * @param rows Orders with no production date.
 * @param onPick Receives the chosen order's id.
 * @param onClose Dismisses the menu.
 */
export default function AddOrderMenu({ date, rows, onPick, onClose }: AddOrderMenuProps) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      data-testid="add-order-menu"
      role="menu"
      aria-label={`Add an unscheduled order to ${format(date, 'EEEE, MMMM d')}`}
      className="calendar-scroll absolute bottom-full left-0 right-0 mb-1 z-30 max-h-64 overflow-y-auto rounded-lg bg-card border border-border shadow-lg py-1"
    >
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">
          Nothing to add — every order has a date.
        </p>
      ) : (
        rows.map((row) => (
          <button
            key={row.id}
            type="button"
            role="menuitem"
            onClick={() => onPick(row.id)}
            className="w-full text-left px-3 py-2 min-h-[44px] hover:bg-muted focus-visible:outline-none focus-visible:bg-muted"
          >
            <span className="block text-sm font-medium text-foreground truncate">
              {row.po_number}
            </span>
            <span className="block text-xs text-muted-foreground truncate">
              {row.customer_name ?? 'Unknown customer'} · {formatProductionMix(row).text}
            </span>
          </button>
        ))
      )}
    </div>
  )
}
