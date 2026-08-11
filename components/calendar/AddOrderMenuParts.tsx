'use client'

import { formatProductionMix, productionMixText } from './productionCardFormat'
import { formatPickupCounts } from './PickupCard'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

// Presentational pieces of `AddOrderMenu`, split out when Task 81 gave the menu
// a second create action and a second undated list — the same `*Parts` idiom as
// `DayColumnParts`. Nothing here is exported beyond the menu.

/** Shared row shape for every clickable line in the menu. */
const MENU_ROW_CLASS =
  'w-full text-left px-3 py-2 min-h-[44px] hover:bg-muted focus-visible:outline-none focus-visible:bg-muted'

/**
 * One of the two create actions at the top of the menu. They sit above the
 * lists, separated, because they are a different kind of act — they write a new
 * row rather than dating an existing one — and because they stay useful when
 * both lists are empty, which is the steady state once everything is scheduled.
 */
export function CreateAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`${MENU_ROW_CLASS} text-sm font-medium text-primary`}
    >
      {label}
    </button>
  )
}

/**
 * A labelled run of undated rows.
 *
 * The label is what makes a mixed list readable: an order line and a pickup
 * line are both "a customer and some numbers" at menu font size, and the two
 * kinds go to different tables (CONSTRAINT-25). `role="group"` carries the same
 * grouping to a screen reader rather than leaving it to the visual heading.
 */
export function UndatedGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <p
        aria-hidden="true"
        className="px-3 pt-2 pb-1 text-[0.625rem] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {label}
      </p>
      {children}
    </div>
  )
}

/**
 * One undated order. A plain button rather than a `ProductionCard`: at 176px
 * the column is too narrow for a card-in-a-menu, and the choice here is "which
 * order", for which the PO number and mix are enough.
 */
export function UndatedOrderRow({
  row,
  onPick,
}: {
  row: CalendarOrderRow
  onPick: (orderId: string) => void
}) {
  return (
    <button type="button" role="menuitem" onClick={() => onPick(row.id)} className={MENU_ROW_CLASS}>
      <span className="block text-sm font-medium text-foreground truncate">{row.po_number}</span>
      <span className="block text-xs text-muted-foreground truncate">
        {row.customer_name ?? 'Unknown customer'} · {productionMixText(formatProductionMix(row))}
      </span>
    </button>
  )
}

/**
 * One undated pickup. Led by the customer rather than a number, because a
 * pickup has no PO number to identify itself with — the counts do the rest.
 */
export function UndatedPickupRow({
  pickup,
  onPick,
}: {
  pickup: CalendarPickupRow
  onPick: (pickupId: string) => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => onPick(pickup.id)}
      className={MENU_ROW_CLASS}
    >
      <span className="block text-sm font-medium text-foreground truncate">
        {pickup.customer_name ?? 'Unknown customer'}
      </span>
      <span className="block text-xs text-muted-foreground truncate tabular-nums">
        {formatPickupCounts(pickup)}
      </span>
    </button>
  )
}
