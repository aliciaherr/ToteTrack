'use client'

import { cn } from '@/lib/utils'
import OrderStatusActions from '@/components/orders/OrderStatusActions'
import type { CalendarOrderRow } from '@/db/queries/calendar'

// The writable half of `ProductionCardDialog`: the two flag pills and the
// status block. Its own sibling rather than more of `ProductionCardDialogParts`
// so both files stay inside the 200-line component cap (CQ-02) and the split
// falls on a real seam — everything here mutates, everything there displays.

/**
 * One on/off pill. `role="switch"` rather than a checkbox: this is not a form
 * field, there is nothing to submit, and each click writes straight through to
 * Postgres. State is carried by fill *and* by the leading dot, so the on/off
 * reading never rests on colour alone.
 *
 * `onChange` receives the target state, not a flip — it matches the server
 * actions, so a double-fired click writes the same value twice instead of
 * toggling twice.
 *
 * @param label Visible text, and the control's accessible name.
 * @param checked Current stored value, straight from the server row.
 * @param disabled True while any dialog mutation is in flight.
 * @param onChange Called with the target state.
 */
export function PillToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'inline-flex items-center gap-2 rounded-full px-4 min-h-[44px] text-sm font-medium',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        checked
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:text-foreground',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'w-2 h-2 rounded-full',
          checked ? 'bg-primary-foreground' : 'bg-muted-foreground/40',
        )}
      />
      {label}
    </button>
  )
}

/**
 * The dialog's two flag toggles on one row: backhaul first, then same-day
 * delivery. Both write on click and both stay available on invoiced and
 * cancelled orders — CONSTRAINT-18's edit lock covers quantities and price, not
 * logistics flags.
 *
 * There is no optimistic state: each pill renders the value on the server row
 * it was handed, so a rejected write leaves the pill showing what the database
 * actually holds while `useCalendarMutation` raises the toast (CONSTRAINT-02).
 */
export function TogglePillRow({
  row,
  disabled,
  onToggleBackhaul,
  onToggleSameDay,
}: {
  row: CalendarOrderRow
  disabled: boolean
  onToggleBackhaul: (next: boolean) => void
  onToggleSameDay: (next: boolean) => void
}) {
  return (
    <div role="group" aria-label="Order flags" className="flex flex-wrap items-center gap-2">
      <PillToggle
        label="Backhaul"
        checked={row.backhaul}
        disabled={disabled}
        onChange={onToggleBackhaul}
      />
      <PillToggle
        label="Same-day delivery"
        checked={row.same_day_delivery}
        disabled={disabled}
        onChange={onToggleSameDay}
      />
    </div>
  )
}

/**
 * The Orders tab's status block, reused verbatim — Mark as Complete + Cancel
 * Order on a scheduled PO, Revert to Scheduled on the other three. Forking it
 * would mean two state machines to keep in step.
 *
 * `onDialogOpenChange` is how the popup learns that a confirmation dialog is
 * mounted inside it, so it can stand down its own Escape handler while the
 * confirm owns the key.
 */
export function StatusSection({
  row,
  onStatusChange,
  onDialogOpenChange,
}: {
  row: CalendarOrderRow
  onStatusChange: () => void
  onDialogOpenChange: (open: boolean) => void
}) {
  return (
    <section aria-label="Status" className="pt-2 border-t border-border">
      <OrderStatusActions
        orderId={row.id}
        poNumber={row.po_number}
        currentStatus={row.status}
        onStatusChange={onStatusChange}
        onDialogOpenChange={onDialogOpenChange}
      />
    </section>
  )
}
