'use client'

import { format, parseISO } from 'date-fns'
import { BUILT_SURFACE_CLASS } from './productionCardStatus'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'
import type { PickupStatus } from '@/db/queries/pickups'

/**
 * The amber card surface, deliberately **not** the green-275 / blue-330
 * size-and-type language the order card uses (CONSTRAINT-25). A pickup has no
 * type dimension, and the two card kinds must never be misread for each other
 * at card font size — so the whole surface carries the signal and the text
 * stays plain dark, readable at the 80px card floor.
 */
const PICKUP_SURFACE_CLASS = 'bg-amber-100 border-amber-200'

/** Empty-mix fallback. A pickup collecting nothing cannot be created, but a row is never trusted to prove it. */
const EMPTY_COUNTS_TEXT = '—'

/**
 * Statuses whose pickup cards are read-only on the calendar: the collection
 * already happened, so the card is greyed and exposes no drag affordance.
 * `cancelled` is absent on purpose — a cancelled pickup is filtered out of the
 * calendar entirely and never reaches a card.
 */
export function isLockedPickupStatus(status: PickupStatus): boolean {
  return status === 'completed'
}

/**
 * The card's count line: `12 × 275, 4 × 330`, dropping a size that is zero.
 *
 * Spelled with spaces around the multiplication sign, unlike the order card's
 * compact `12×275 REC` — a pickup line carries at most two terms and no type
 * codes, so it has the room, and the different shape is a second cue that this
 * is not an order.
 *
 * @param pickup The row to describe.
 * @returns The joined counts, or an em dash when both sizes are zero.
 */
export function formatPickupCounts(pickup: { qty_275: number; qty_330: number }): string {
  const parts: string[] = []
  if (pickup.qty_275 > 0) parts.push(`${pickup.qty_275} × 275`)
  if (pickup.qty_330 > 0) parts.push(`${pickup.qty_330} × 330`)
  return parts.length > 0 ? parts.join(', ') : EMPTY_COUNTS_TEXT
}

/** The collection day, or an em dash while the pickup is still unscheduled. */
function formatPickupDate(isoDate: string | null): string {
  if (!isoDate) return '—'
  // `parseISO`, never `new Date(string)` — the latter reads a date-only string
  // as UTC midnight and prints the previous day in any negative-offset timezone.
  return format(parseISO(isoDate), 'MMM d')
}

interface PickupCardProps {
  pickup: CalendarPickupRow
  /** True while `@dnd-kit` is carrying this card. Lifts and fades it. */
  isDragging?: boolean
  /**
   * True while the card is armed by a touch long-press (Task 68/81). Bold
   * primary ring plus the shake from `globals.css` — the ring alone survives
   * reduced motion, so the armed state is never signalled by movement only.
   * Identical treatment to `ProductionCard`: the affordance says "armed", not
   * "which kind of card".
   */
  isArmed?: boolean
}

/**
 * A single tote collection on the calendar, in the pickups list below the
 * orders list of the same day column.
 *
 * Exactly `--card-h` tall like an order card, from the same token — the "four
 * whole cards visible" target the calendar layout is built around is measured
 * in cards, not in card kinds, so a pickup that sized itself would break the
 * math the moment both lists were on.
 *
 * Fewer rows than an order card, because a pickup carries less: no PO number,
 * no price, no delivery promise, no combo mix. Customer, counts, and the
 * collection date.
 *
 * @param pickup Row from `getCalendarPickups` / `getUnscheduledPickups`.
 * @param isDragging True while a drag is carrying the card.
 * @param isArmed True while the card is armed by a touch long-press.
 */
export default function PickupCard({
  pickup,
  isDragging = false,
  isArmed = false,
}: PickupCardProps) {
  const isLocked = isLockedPickupStatus(pickup.status)
  const customerName = pickup.customer_name ?? 'Unknown customer'

  return (
    <article
      data-testid="pickup-card"
      data-locked={isLocked ? 'true' : undefined}
      data-draggable={isLocked ? undefined : 'true'}
      data-armed={isArmed ? 'true' : undefined}
      aria-label={`Pickup for ${customerName}`}
      className={`flex flex-col rounded-md border overflow-hidden select-none ${
        isLocked ? `${BUILT_SURFACE_CLASS} border-border` : `${PICKUP_SURFACE_CLASS} cursor-grab`
      } ${isDragging ? 'opacity-80 shadow-lg' : ''} ${
        isArmed ? 'calendar-card-armed ring-2 ring-primary' : ''
      }`}
      style={{
        height: 'var(--card-h)',
        paddingBlock: 'var(--card-pad)',
        paddingInline: 'calc(var(--card-pad) * 2)',
      }}
    >
      <p
        className="line-clamp-2 overflow-hidden font-semibold text-foreground"
        style={{
          height: 'var(--card-row-name)',
          fontSize: 'var(--card-fs-name)',
          lineHeight: 'var(--card-line-name)',
        }}
      >
        {customerName}
      </p>

      <p
        data-testid="pickup-card-counts"
        className="line-clamp-2 overflow-hidden text-foreground tabular-nums"
        style={{
          height: 'var(--card-row-mix)',
          fontSize: 'var(--card-fs-mix)',
          lineHeight: 'var(--card-line-mix)',
        }}
      >
        {formatPickupCounts(pickup)}
      </p>

      <span
        className="text-muted-foreground tabular-nums leading-none mt-auto"
        style={{ height: 'var(--card-row-date)', fontSize: 'var(--card-fs-date)' }}
      >
        {formatPickupDate(pickup.pickup_date)}
      </span>
    </article>
  )
}
