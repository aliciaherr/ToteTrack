'use client'

import { cn } from '@/lib/utils'
import {
  CALENDAR_VIEW_LABELS,
  nextCalendarView,
  useCalendarVisibility,
  visibilityForView,
  type CalendarView,
} from './pickupVisibility'

/**
 * Two state dots — orders, then pickups — filled for whichever the view draws.
 *
 * The label already names the view, so these are redundant by design: they give
 * the control a shape that can be read in a glance from across a warehouse,
 * without parsing a word, and they make `Both` legible as "the other two at
 * once" rather than a third unrelated mode.
 */
function ViewDots({ view }: { view: CalendarView }) {
  const { showOrders, showPickups } = visibilityForView(view)

  return (
    <span aria-hidden="true" className="inline-flex items-center gap-1">
      <span
        className={cn('w-2 h-2 rounded-full', showOrders ? 'bg-primary-foreground' : 'bg-primary-foreground/30')}
      />
      <span
        className={cn('w-2 h-2 rounded-full', showPickups ? 'bg-primary-foreground' : 'bg-primary-foreground/30')}
      />
    </span>
  )
}

/**
 * The calendar's single view control: one pill that cycles Orders → Pickups →
 * Both → Orders.
 *
 * It replaces the pair of independent `PillToggle`s Task 80 put here. Two
 * toggles cost roughly twice the width on a header that has no horizontal room
 * to spare at iPad landscape (CONSTRAINT-19), and their four combinations
 * included one — both off — that was never a view anyone wanted. Three states
 * on one control is the whole set of useful ones, in half the space, with the
 * common Orders ↔ Both move one tap away in either direction.
 *
 * Not `role="switch"`: a switch is binary and this is not. It is a plain button
 * whose accessible name carries both halves a screen-reader user needs — what
 * is shown now, and what pressing it will show next — because the visible label
 * can only say one of those and the dots say nothing at all.
 */
export default function CalendarViewCycle() {
  const { view, cycleView } = useCalendarVisibility()
  const label = CALENDAR_VIEW_LABELS[view]
  const nextLabel = CALENDAR_VIEW_LABELS[nextCalendarView(view)]

  return (
    <button
      type="button"
      data-testid="calendar-view-cycle"
      data-view={view}
      onClick={cycleView}
      aria-label={`Showing ${label}. Switch to ${nextLabel}.`}
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-4 min-h-[44px] text-sm font-medium',
        'bg-primary text-primary-foreground',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <ViewDots view={view} />
      {label}
    </button>
  )
}
