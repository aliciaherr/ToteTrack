'use client'

import { format } from 'date-fns'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import AddOrderMenu from './AddOrderMenu'
import SortableProductionCard from './SortableProductionCard'
import { useArmMode } from './armMode'
import { sortableListId } from './calendarDnd'
import { DAY_OF_MONTH_FORMAT, WEEKDAY_FORMAT } from './calendarWeeks'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

// Presentational pieces of `DayColumn`, split out to keep that file within the
// 200-line component cap (CQ-02). Same `*Parts` idiom as `OrderDetailParts` and
// `InvoiceLedgerParts`. Nothing here is exported beyond the column.

/**
 * Weekday and date only — deliberately no order count. A count invites the
 * salesperson to read the column as a target to hit rather than a list of work,
 * and the cards themselves already show how full the day is.
 */
export function DayHeader({ date, isToday }: { date: Date; isToday: boolean }) {
  return (
    <header
      className={`px-4 py-2.5 border-b border-border flex items-baseline gap-1.5 shrink-0 ${
        isToday ? 'bg-primary' : 'bg-muted/50'
      }`}
    >
      <h3
        className={`text-xs font-semibold uppercase tracking-wider ${
          isToday ? 'text-primary-foreground' : 'text-muted-foreground'
        }`}
      >
        {format(date, WEEKDAY_FORMAT)}
      </h3>
      <span
        className={`text-xs tabular-nums ${
          isToday ? 'text-primary-foreground' : 'text-muted-foreground'
        }`}
      >
        {format(date, DAY_OF_MONTH_FORMAT)}
      </span>
    </header>
  )
}

/**
 * Shown in place of both lists when the header has toggled each of them off —
 * an explicit message rather than a blank grid the viewer has to interpret.
 */
export function ColumnListsHidden() {
  return (
    <div
      data-testid="column-lists-hidden"
      className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground p-8 text-center"
    >
      Both lists are hidden.
    </div>
  )
}

/**
 * The column's scrollable order list, or its empty state.
 *
 * Both branches carry the droppable ref: an empty day must be able to receive a
 * card, and it has no list element to attach to.
 *
 * Both branches are also a tap target while a card is armed (Task 68): a tap
 * on the list's empty space — below the cards, or anywhere in an empty day —
 * appends the armed card to this day. The tap carries `group: 'order'`, so an
 * armed *pickup* tapped here resolves to `cancel` and writes nothing
 * (CONSTRAINT-25). Taps on a card never reach here: the card's own handler runs
 * first and disarms, so the bubbled click finds nothing armed.
 */
export function ColumnOrderList({
  dateKey,
  rows,
  setDropRef,
}: {
  dateKey: string
  rows: CalendarOrderRow[]
  setDropRef: (element: HTMLElement | null) => void
}) {
  const { tap } = useArmMode()
  const handleTap = () => tap({ type: 'column', group: 'order', dateKey, cardCount: rows.length })

  return (
    <SortableContext
      id={sortableListId('order', dateKey)}
      items={rows.map((row) => row.id)}
      strategy={verticalListSortingStrategy}
    >
      {rows.length === 0 ? (
        <div
          ref={setDropRef}
          onClick={handleTap}
          className="flex-1 min-h-0 flex items-center justify-center text-sm text-muted-foreground p-8 text-center"
        >
          Nothing scheduled.
        </div>
      ) : (
        <ul
          ref={setDropRef}
          onClick={handleTap}
          className="calendar-scroll flex-1 min-h-0 overflow-y-auto p-2 space-y-2"
          role="list"
        >
          {rows.map((row, index) => (
            <li key={row.id}>
              <SortableProductionCard row={row} dateKey={dateKey} index={index} />
            </li>
          ))}
        </ul>
      )}
    </SortableContext>
  )
}

interface ColumnFooterProps {
  date: Date
  unscheduled: CalendarOrderRow[]
  unscheduledPickups: CalendarPickupRow[]
  isMenuOpen: boolean
  onToggle: () => void
  onPick: (orderId: string) => void
  onPickPickup: (pickupId: string) => void
  onClose: () => void
}

/**
 * The column's `+ Add` action and the menu it opens.
 *
 * The label lost the word "order" in Task 81: the menu now creates a PO *or* a
 * pickup and lists both undated sets, so naming one of them on the trigger
 * would misdescribe half of what the button does.
 *
 * Neither create action is prop-drilled through here — both reach
 * `CalendarLayout` through the `newOrderDay` context — so this file forwards
 * only the two placement callbacks.
 *
 * The menu is anchored above the button (`bottom-full`) because the footer sits
 * at the bottom of a full-height column — a menu opening downward would fall
 * off the viewport, and the page itself never scrolls (CONSTRAINT-19).
 */
export function ColumnFooter({
  date,
  unscheduled,
  unscheduledPickups,
  isMenuOpen,
  onToggle,
  onPick,
  onPickPickup,
  onClose,
}: ColumnFooterProps) {
  return (
    <footer className="relative px-4 py-1.5 border-t border-border shrink-0">
      {isMenuOpen && (
        <AddOrderMenu
          date={date}
          rows={unscheduled}
          pickups={unscheduledPickups}
          onPick={onPick}
          onPickPickup={onPickPickup}
          onClose={onClose}
        />
      )}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isMenuOpen}
        aria-label={`Add to ${format(date, 'EEEE, MMMM d')}`}
        className="day-column-action text-sm font-medium text-primary hover:underline min-h-[44px] w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        + Add
      </button>
    </footer>
  )
}
