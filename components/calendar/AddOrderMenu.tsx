'use client'

import { useCallback, useEffect } from 'react'
import { format } from 'date-fns'
import {
  CreateAction,
  UndatedGroup,
  UndatedOrderRow,
  UndatedPickupRow,
} from './AddOrderMenuParts'
import { useStartNewOrder, useStartNewPickup } from './newOrderDay'
import { DB_DATE_FORMAT } from '@/lib/dates'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

interface AddOrderMenuProps {
  date: Date
  rows: CalendarOrderRow[]
  /** Pickups with no date — the second undated list. */
  pickups: CalendarPickupRow[]
  onPick: (orderId: string) => void
  /** Receives the chosen pickup's id. */
  onPickPickup: (pickupId: string) => void
  onClose: () => void
}

/**
 * The per-day `+ Add` menu: two actions that create a brand-new row on this
 * day, then the lists of rows that already exist but have no date yet — orders
 * and pickups, each labelled (CONSTRAINT-25).
 *
 * The lists render exactly the same undated sets as the two header callouts —
 * all four surfaces take the same two queries — so they can never disagree
 * about what still needs a date. The menu exists because dragging from a
 * callout to a distant week is a long gesture; picking a day and then a row is
 * the keyboard- and touch-friendly path to the same placement.
 *
 * A group is drawn only when it has rows. Two permanent headings over two
 * "nothing here" lines would spend most of a 176px column's menu on labels for
 * empty space; with both sets empty the menu falls back to one message and
 * keeps its two create actions, which are still useful.
 *
 * @param date The day a picked row will be placed on, and the new row's date.
 * @param rows Orders with no production date.
 * @param pickups Pickups with no date.
 * @param onPick Receives the chosen order's id.
 * @param onPickPickup Receives the chosen pickup's id.
 * @param onClose Dismisses the menu.
 */
export default function AddOrderMenu({
  date,
  rows,
  pickups,
  onPick,
  onPickPickup,
  onClose,
}: AddOrderMenuProps) {
  const startNewOrder = useStartNewOrder()
  const startNewPickup = useStartNewPickup()
  const dateKey = format(date, DB_DATE_FORMAT)
  const isEmpty = rows.length === 0 && pickups.length === 0

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Dismiss before opening a drawer: the menu is anchored to a column that the
  // drawer covers, and leaving it mounted would strand an open menu behind the
  // form.
  const handleNewOrder = useCallback(() => {
    onClose()
    startNewOrder(dateKey)
  }, [onClose, startNewOrder, dateKey])

  const handleNewPickup = useCallback(() => {
    onClose()
    startNewPickup(dateKey)
  }, [onClose, startNewPickup, dateKey])

  return (
    <div
      data-testid="add-order-menu"
      role="menu"
      aria-label={`Add to ${format(date, 'EEEE, MMMM d')}`}
      className="calendar-scroll absolute bottom-full left-0 right-0 mb-1 z-30 max-h-64 overflow-y-auto rounded-lg bg-card border border-border shadow-lg py-1"
    >
      <CreateAction label="Add Purchase Order" onClick={handleNewOrder} />
      <CreateAction label="Add Pickup" onClick={handleNewPickup} />
      <div role="separator" className="my-1 border-t border-border" />

      {isEmpty && (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">
          Nothing to add — everything has a date.
        </p>
      )}

      {rows.length > 0 && (
        <UndatedGroup label="Undated orders">
          {rows.map((row) => (
            <UndatedOrderRow key={row.id} row={row} onPick={onPick} />
          ))}
        </UndatedGroup>
      )}

      {pickups.length > 0 && (
        <UndatedGroup label="Undated pickups">
          {pickups.map((pickup) => (
            <UndatedPickupRow key={pickup.id} pickup={pickup} onPick={onPickPickup} />
          ))}
        </UndatedGroup>
      )}
    </div>
  )
}
