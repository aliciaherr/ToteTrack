'use client'

import { useCallback, useState } from 'react'
import { format } from 'date-fns'
import ColumnPickupList from './ColumnPickupList'
import { ColumnFooter, ColumnListsHidden, ColumnOrderList, DayHeader } from './DayColumnParts'
import { useCalendarVisibility } from './pickupVisibility'
import { useColumnDroppables } from './useColumnDroppables'
import { DB_DATE_FORMAT } from '@/lib/dates'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

interface DayColumnProps {
  date: Date
  rows: CalendarOrderRow[]
  /** Pickups placed on this day, in their own column order. */
  pickups: CalendarPickupRow[]
  isToday: boolean
  /** Orders with no production date — one of the two `+ Add` pick lists. */
  unscheduled: CalendarOrderRow[]
  /** Pickups with no date — the other `+ Add` pick list. */
  unscheduledPickups: CalendarPickupRow[]
  /** Places the chosen order on this day. */
  onPick: (orderId: string, dateKey: string) => void
  /** Places the chosen pickup on this day. */
  onPickPickup: (pickupId: string, dateKey: string) => void
  /** Opens a pickup's popup. */
  onSelectPickup: (pickup: CalendarPickupRow) => void
}

interface ColumnBodyProps {
  dateKey: string
  rows: CalendarOrderRow[]
  pickups: CalendarPickupRow[]
  setOrderDropRef: (element: HTMLElement | null) => void
  setPickupDropRef: (element: HTMLElement | null) => void
  onSelectPickup: (pickup: CalendarPickupRow) => void
}

/**
 * The column's body: its two card lists, each scrolling inside its own share of
 * the column, or the message shown when both are toggled off.
 *
 * Both lists carry `COLUMN_LIST_FLEX`, so the height split is decided by the
 * flex chain rather than by any pixel value — one list on grows to the whole
 * column, both on take an explicit half each whatever their padding, and
 * neither can make the page itself scroll (CONSTRAINT-19). Which lists are
 * drawn comes from the header toggles through
 * `pickupVisibility`, which defaults to orders-on / pickups-off (CONSTRAINT-25).
 *
 * Each list gets its **own** droppable ref, and a hidden list mounts neither
 * its ref nor its `SortableContext`. That is the honest outcome: with a group
 * toggled off there is no visible slot to aim at, so a drag of that group finds
 * no target in this column and lands nowhere rather than moving a card the
 * salesperson cannot see.
 */
function ColumnBody({
  dateKey,
  rows,
  pickups,
  setOrderDropRef,
  setPickupDropRef,
  onSelectPickup,
}: ColumnBodyProps) {
  const { showOrders, showPickups } = useCalendarVisibility()

  if (!showOrders && !showPickups) return <ColumnListsHidden />

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {showOrders && <ColumnOrderList dateKey={dateKey} rows={rows} setDropRef={setOrderDropRef} />}
      {showPickups && (
        <ColumnPickupList
          pickups={pickups}
          dateKey={dateKey}
          hasOrdersAbove={showOrders}
          setDropRef={setPickupDropRef}
          onSelect={onSelectPickup}
        />
      )}
    </div>
  )
}

/**
 * One weekday of the production calendar.
 *
 * Reuses the `OpenOrdersWidget` skeleton — rounded card, tinted header band,
 * link-styled footer action — so the calendar reads as the same product as the
 * dashboard rather than a bolted-on screen.
 *
 * The column takes its height from the viewport through the surrounding flex
 * chain and never sets a pixel height: `COLUMN_LIST_FLEX` on the card lists is
 * what lets the page stay exactly one viewport tall (CONSTRAINT-19) while a
 * list scrolls internally when a day holds more cards than fit.
 *
 * It registers **two** droppables, one per group (CONSTRAINT-25), through
 * `useColumnDroppables` — the orders list under the bare `dateKey`, the pickups
 * list under `pickups:${dateKey}`. See that hook for why two ids rather than one
 * shared column target.
 *
 * Past days render identically to future ones — a build that already happened
 * is still the record of what was built, and dimming it would make the
 * calendar's left half unreadable.
 *
 * @param date The weekday this column represents.
 * @param rows Order cards for this day, pre-sorted into column order.
 * @param pickups Pickup cards for this day, in their own order.
 * @param isToday Fills the header with `bg-primary`.
 * @param unscheduled Orders with no production date, listed by `+ Add`.
 * @param unscheduledPickups Pickups with no date, listed by `+ Add`.
 * @param onPick Receives the chosen order id and this day's `yyyy-MM-dd` key.
 * @param onPickPickup Receives the chosen pickup id and this day's key.
 * @param onSelectPickup Opens the popup for a pickup in this column.
 */
export default function DayColumn({
  date,
  rows,
  pickups,
  isToday,
  unscheduled,
  unscheduledPickups,
  onPick,
  onPickPickup,
  onSelectPickup,
}: DayColumnProps) {
  const dateKey = format(date, DB_DATE_FORMAT)
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const closeMenu = useCallback(() => setIsMenuOpen(false), [])
  const toggleMenu = useCallback(() => setIsMenuOpen((current) => !current), [])
  const handlePick = useCallback(
    (orderId: string) => {
      setIsMenuOpen(false)
      onPick(orderId, dateKey)
    },
    [onPick, dateKey],
  )
  const handlePickPickup = useCallback(
    (pickupId: string) => {
      setIsMenuOpen(false)
      onPickPickup(pickupId, dateKey)
    },
    [onPickPickup, dateKey],
  )

  const { setOrderDropRef, setPickupDropRef, isOver } = useColumnDroppables(
    dateKey,
    rows.length,
    pickups.length,
  )

  return (
    <section
      data-testid="day-column"
      data-date={dateKey}
      aria-label={format(date, 'EEEE, MMMM d')}
      className={`day-column w-44 shrink-0 h-full flex flex-col rounded-xl bg-card border overflow-hidden ${
        isOver ? 'border-primary' : 'border-border'
      }`}
    >
      <DayHeader date={date} isToday={isToday} />

      <ColumnBody
        dateKey={dateKey}
        rows={rows}
        pickups={pickups}
        setOrderDropRef={setOrderDropRef}
        setPickupDropRef={setPickupDropRef}
        onSelectPickup={onSelectPickup}
      />

      <ColumnFooter
        date={date}
        unscheduled={unscheduled}
        unscheduledPickups={unscheduledPickups}
        isMenuOpen={isMenuOpen}
        onToggle={toggleMenu}
        onPick={handlePick}
        onPickPickup={handlePickPickup}
        onClose={closeMenu}
      />
    </section>
  )
}
