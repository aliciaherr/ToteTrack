'use client'

import NewOrderDrawer from './NewOrderDrawer'
import NewPickupDrawer from './NewPickupDrawer'
import PickupCardDialog from './PickupCardDialog'
import ProductionCardDialog from './ProductionCardDialog'
import type { CalendarOrderRow } from '@/db/queries/calendar'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'
import type { CustomerSelectOption } from '@/db/queries/customers'

// Everything the calendar draws *above* the board: one popup and one create
// drawer per group. Split out of `CalendarLayout` when Task 81 added the second
// drawer and pushed that component past CONSTRAINT-14's 80-line JSX allowance —
// the same reason Task 80 split `CalendarBoard` out of it.

interface CalendarOverlaysProps {
  /** The order whose popup is open, or null. Re-derived from props each render. */
  selectedRow: CalendarOrderRow | null
  onCloseRow: () => void
  onToggleBackhaul: (orderId: string, next: boolean) => Promise<void>
  onToggleSameDay: (orderId: string, next: boolean) => Promise<void>
  /** Clears the order's production placement. */
  onRemoveRow: (orderId: string) => Promise<void>
  /** The pickup whose popup is open, or null. */
  selectedPickup: CalendarPickupRow | null
  onClosePickup: () => void
  /** Clears the pickup's `pickup_date` **and** `sort_index`. */
  onRemovePickup: (pickupId: string) => Promise<void>
  /** Day the new-PO drawer is pinned to, or null when shut. */
  newOrderDay: string | null
  /** Day the new-pickup drawer is pinned to, or null when shut. */
  newPickupDay: string | null
  onCloseNewOrder: () => void
  onCloseNewPickup: () => void
  customers: CustomerSelectOption[]
}

/**
 * The calendar's four overlays, mounted as siblings of the board.
 *
 * Purely a forwarding layer — it owns no state and makes no decision. The two
 * popups each take a row that `CalendarLayout` re-derives from server props on
 * every render, so a write that revalidates can never leave a stale snapshot on
 * screen, and a card that leaves the calendar takes its popup with it
 * (CONSTRAINT-02).
 *
 * The two groups' overlays stay separate components rather than one switched
 * shell: a pickup has no backhaul, no same-day flag and no PO number, so a
 * shared popup would be a branch on every row it draws (CONSTRAINT-25).
 */
export default function CalendarOverlays({
  selectedRow,
  onCloseRow,
  onToggleBackhaul,
  onToggleSameDay,
  onRemoveRow,
  selectedPickup,
  onClosePickup,
  onRemovePickup,
  newOrderDay,
  newPickupDay,
  onCloseNewOrder,
  onCloseNewPickup,
  customers,
}: CalendarOverlaysProps) {
  return (
    <>
      <ProductionCardDialog
        open={selectedRow !== null}
        row={selectedRow}
        onClose={onCloseRow}
        onToggleBackhaul={onToggleBackhaul}
        onToggleSameDay={onToggleSameDay}
        onRemove={onRemoveRow}
      />

      <PickupCardDialog
        open={selectedPickup !== null}
        pickup={selectedPickup}
        onClose={onClosePickup}
        onRemove={onRemovePickup}
      />

      <NewOrderDrawer
        productionDate={newOrderDay}
        customers={customers}
        onClose={onCloseNewOrder}
      />

      <NewPickupDrawer
        pickupDate={newPickupDay}
        customers={customers}
        onClose={onCloseNewPickup}
      />
    </>
  )
}
