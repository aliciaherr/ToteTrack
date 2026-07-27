'use client'

import { useCallback, useState } from 'react'
import { format } from 'date-fns'
import { useDroppable } from '@dnd-kit/core'
import { ColumnBody, ColumnFooter, DayHeader } from './DayColumnParts'
import type { ColumnDropData } from './calendarDnd'
import { DB_DATE_FORMAT } from '@/lib/dates'
import type { CalendarOrderRow } from '@/db/queries/calendar'

interface DayColumnProps {
  date: Date
  rows: CalendarOrderRow[]
  isToday: boolean
  /** Orders with no production date — the pick list behind `+ Add order`. */
  unscheduled: CalendarOrderRow[]
  /** Places the chosen order on this day. */
  onPick: (orderId: string, dateKey: string) => void
}

/**
 * One weekday of the production calendar.
 *
 * Reuses the `OpenOrdersWidget` skeleton — rounded card, tinted header band,
 * link-styled footer action — so the calendar reads as the same product as the
 * dashboard rather than a bolted-on screen.
 *
 * The column takes its height from the viewport through the surrounding flex
 * chain and never sets a pixel height: `flex-1 min-h-0` on the card list is
 * what lets the page stay exactly one viewport tall (CONSTRAINT-19) while the
 * list scrolls internally when a day holds more cards than fit.
 *
 * Past days render identically to future ones — a build that already happened
 * is still the record of what was built, and dimming it would make the
 * calendar's left half unreadable.
 *
 * @param date The weekday this column represents.
 * @param rows Cards for this day, pre-sorted into column order.
 * @param isToday Fills the header with `bg-primary`.
 * @param unscheduled Orders with no production date, listed by `+ Add order`.
 * @param onPick Receives the chosen order id and this day's `yyyy-MM-dd` key.
 */
export default function DayColumn({
  date,
  rows,
  isToday,
  unscheduled,
  onPick,
}: DayColumnProps) {
  const dateKey = format(date, DB_DATE_FORMAT)
  const dropData: ColumnDropData = { type: 'column', dateKey, cardCount: rows.length }
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

  // The column is a drop target in its own right, not only through its cards —
  // otherwise an empty day could never receive one.
  const { setNodeRef, isOver } = useDroppable({ id: dateKey, data: dropData })

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

      <ColumnBody dateKey={dateKey} rows={rows} setDropRef={setNodeRef} />

      <ColumnFooter
        date={date}
        unscheduled={unscheduled}
        isMenuOpen={isMenuOpen}
        onToggle={toggleMenu}
        onPick={handlePick}
        onClose={closeMenu}
      />
    </section>
  )
}
