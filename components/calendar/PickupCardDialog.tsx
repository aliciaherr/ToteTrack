'use client'

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { modalVariants } from '@/lib/animations'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  PickupStatusBlock,
  TextBlock,
  ToteCountsBlock,
} from '@/components/pickups/PickupDetailParts'
import { useEscapeClose, useFocusTrap, useNestedDialog } from './productionCardDialogHooks'
import ContactMenu from './ContactMenu'
import { formatPickupCounts } from './PickupCard'
import type { CalendarPickupRow } from '@/db/queries/pickups.calendar'

interface PickupCardDialogProps {
  open: boolean
  pickup: CalendarPickupRow | null
  onClose: () => void
  /** Clears `pickup_date`, then closes. */
  onRemove: (pickupId: string) => Promise<void>
}

/**
 * `Remove from calendar` plus the busy flag that gates the panel while it runs.
 *
 * `catch`-then-`finally` for the same reason `useDialogActions` has it: while
 * `isBusy` is true Escape is ignored and the backdrop is inert, so a rejection
 * that left the flag set would trap the dialog until a page reload. The catch
 * is not a swallow — the caller's mutation hook already logs and toasts — but
 * the DOM handler discards this promise, so a rejection reaching here would
 * otherwise surface only as an unhandled rejection nobody reads.
 */
function useRemovePickup(
  pickup: CalendarPickupRow | null,
  onRemove: (pickupId: string) => Promise<void>,
  onClose: () => void,
) {
  const [isBusy, setIsBusy] = useState(false)

  const handleRemove = useCallback(async () => {
    if (!pickup) return
    setIsBusy(true)
    try {
      await onRemove(pickup.id)
    } catch (cause) {
      console.error('PickupCardDialog: remove rejected', { pickupId: pickup.id, cause })
    } finally {
      setIsBusy(false)
      onClose()
    }
  }, [pickup, onRemove, onClose])

  return { isBusy, handleRemove }
}

/** Customer and count line. A pickup has no PO number to title itself with. */
function PickupDialogHeader({ pickup }: { pickup: CalendarPickupRow }) {
  return (
    <div className="space-y-1 min-w-0">
      <h2 id="pickup-card-title" className="text-lg font-semibold text-foreground truncate">
        {pickup.customer_name ?? 'Unknown customer'}
      </h2>
      <p className="text-sm text-muted-foreground tabular-nums">{formatPickupCounts(pickup)}</p>
    </div>
  )
}

/**
 * `Remove from calendar` beside `Open in Pickups`. No save action — editing a
 * pickup's fields lives in the Pickups tab, and the link is how you get there,
 * exactly as the order popup defers to the Orders tab (CONSTRAINT-19).
 */
function PickupDialogFooter({
  pickupId,
  isBusy,
  onRemove,
}: {
  pickupId: string
  isBusy: boolean
  onRemove: () => void
}) {
  return (
    <div className="flex items-center justify-end gap-2 pt-2">
      <Button
        type="button"
        variant="ghost"
        onClick={onRemove}
        disabled={isBusy}
        className="min-h-[44px]"
      >
        Remove from calendar
      </Button>
      <Link href={`/pickups?id=${pickupId}`} className={cn(buttonVariants(), 'min-h-[44px]')}>
        Open in Pickups
      </Link>
    </div>
  )
}

/**
 * Detail popup for a pickup card.
 *
 * A near-sibling of `ProductionCardDialog` rather than a shared shell: the two
 * popups show different entities through different blocks, and the only thing
 * they truly share — the backdrop's motion and click-outside — is small enough
 * that folding both into one component would cost more indirection than the
 * twenty lines it saves.
 *
 * What it does **not** fork is the writing surface. The status block is the
 * Pickups tab's own `PickupStatusBlock`, unchanged, so Mark as Complete /
 * Cancel / Reopen run the one audited `updatePickupStatus` path with one
 * transition map — the same reason the order popup reuses `OrderStatusActions`.
 *
 * There is no "close on status change": `CalendarLayout` holds the selected
 * *id* and re-derives the row from server props, so completing re-renders the
 * popup against the fresh row, and cancelling drops the pickup out of the
 * calendar query, which closes the popup because there is nothing left to show
 * (CONSTRAINT-02).
 *
 * @param open Whether the dialog is mounted and visible.
 * @param pickup The pickup to show, or null when nothing is selected.
 * @param onClose Dismisses the dialog.
 * @param onRemove Clears `pickup_date`, then closes.
 */
export default function PickupCardDialog({
  open,
  pickup,
  onClose,
  onRemove,
}: PickupCardDialogProps) {
  const shouldReduceMotion = useReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)
  const isOpen = open && pickup !== null
  const { isBusy, handleRemove } = useRemovePickup(pickup, onRemove, onClose)
  const { nestedOpen, handleNestedOpenChange } = useNestedDialog(isOpen, panelRef)

  useEscapeClose(isOpen, onClose, isBusy || nestedOpen)
  useFocusTrap(isOpen, panelRef)

  return (
    <AnimatePresence>
      {isOpen && pickup && (
        <motion.div
          key="pickup-backdrop"
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          variants={shouldReduceMotion ? undefined : modalVariants.backdrop}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={(event) => {
            if (event.target === event.currentTarget && !isBusy) onClose()
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="pickup-card-title"
        >
          <motion.div
            ref={panelRef}
            data-testid="pickup-card-dialog"
            className="bg-card rounded-xl shadow-lg max-w-md w-full p-6 space-y-4 max-h-[90svh] overflow-y-auto calendar-scroll"
            variants={shouldReduceMotion ? undefined : modalVariants.panel}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <PickupDialogHeader pickup={pickup} />
            <div className="flex items-center">
              <ContactMenu contacts={pickup.contacts} onOpenChange={handleNestedOpenChange} />
            </div>
            <PickupStatusBlock detail={pickup} />
            <ToteCountsBlock detail={pickup} />
            <TextBlock
              label="Collection Address"
              value={pickup.address}
              fallback="No address on file."
            />
            <TextBlock label="Notes" value={pickup.notes} fallback="No notes." />

            <PickupDialogFooter
              pickupId={pickup.id}
              isBusy={isBusy}
              onRemove={handleRemove}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
