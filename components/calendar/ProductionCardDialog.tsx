'use client'

import { useEffect, useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { modalVariants } from '@/lib/animations'
import {
  useDialogActions,
  useEscapeClose,
  useFocusTrap,
  useNestedDialog,
} from './productionCardDialogHooks'
import {
  DetailFields,
  DialogFooter,
  DialogHeader,
  NotesSection,
  QuantitiesSection,
} from './ProductionCardDialogParts'
import { StatusSection, TogglePillRow } from './ProductionCardDialogControls'
import type { CalendarOrderRow } from '@/db/queries/calendar'

interface ProductionCardDialogProps {
  open: boolean
  row: CalendarOrderRow | null
  onClose: () => void
  onToggleBackhaul: (orderId: string, next: boolean) => Promise<void>
  onToggleSameDay: (orderId: string, next: boolean) => Promise<void>
  onRemove: (orderId: string) => Promise<void>
}

/** Dimmed overlay. Clicking it — but not the panel inside it — dismisses. */
function DialogBackdrop({
  shouldReduceMotion,
  isBusy,
  onClose,
  children,
}: {
  shouldReduceMotion: boolean
  isBusy: boolean
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <motion.div
      key="backdrop"
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
      aria-labelledby="production-card-title"
    >
      {children}
    </motion.div>
  )
}

/**
 * Read-only detail popup for a production card.
 *
 * The writable surface is deliberately narrow: two flag pills and the status
 * block. Quantities, prices and both dates stay read-only — editing an order is
 * exclusive to the Orders tab, which is why the footer offers `Open in Orders`
 * rather than a save action (CONSTRAINT-19). The quantity grid is `QtyGrid` in
 * display mode **with `unitPrices` supplied**, so filled cells read `qty /
 * $unit` exactly as PO detail has since Feature 10 — and cells whose price was
 * never set fall back to the bare quantity rather than rendering `$null`.
 *
 * This is also where prices live at all. Cards never show money; the popup is
 * the commercial view of the same order.
 *
 * A status change closes the popup. The row it renders is a snapshot held by
 * `CalendarLayout`, and a cancelled order leaves the calendar query entirely —
 * so there is nothing left to show and no honest way to keep showing it.
 *
 * @param open Whether the dialog is mounted and visible.
 * @param row The order to show, or null when nothing is selected.
 * @param onClose Dismisses the dialog.
 * @param onToggleBackhaul Persists the backhaul flag.
 * @param onToggleSameDay Persists the same-day flag.
 * @param onRemove Clears the production placement, then closes.
 */
export default function ProductionCardDialog({
  open,
  row,
  onClose,
  onToggleBackhaul,
  onToggleSameDay,
  onRemove,
}: ProductionCardDialogProps) {
  const shouldReduceMotion = useReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)
  const isOpen = open && row !== null
  const { isBusy, setIsBusy, handleToggleBackhaul, handleToggleSameDay, handleRemove } =
    useDialogActions({ row, onToggleBackhaul, onToggleSameDay, onRemove, onClose })
  const { nestedOpen, handleNestedOpenChange } = useNestedDialog(isOpen, panelRef)

  // A confirm dialog inside the panel owns Escape for as long as it is up, the
  // same way an in-flight mutation does.
  useEscapeClose(isOpen, onClose, isBusy || nestedOpen)
  useFocusTrap(isOpen, panelRef)

  useEffect(() => {
    if (!isOpen) setIsBusy(false)
  }, [isOpen, setIsBusy])

  return (
    <AnimatePresence>
      {isOpen && row && (
        <DialogBackdrop
          shouldReduceMotion={Boolean(shouldReduceMotion)}
          isBusy={isBusy}
          onClose={onClose}
        >
          <motion.div
            ref={panelRef}
            data-testid="production-card-dialog"
            className="bg-card rounded-xl shadow-lg max-w-md w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto calendar-scroll"
            variants={shouldReduceMotion ? undefined : modalVariants.panel}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <DialogHeader row={row} />
            <TogglePillRow
              row={row}
              disabled={isBusy}
              onToggleBackhaul={handleToggleBackhaul}
              onToggleSameDay={handleToggleSameDay}
            />
            <StatusSection
              row={row}
              onStatusChange={onClose}
              onDialogOpenChange={handleNestedOpenChange}
            />
            <QuantitiesSection row={row} />
            <DetailFields row={row} />
            <NotesSection notes={row.notes} />

            <DialogFooter orderId={row.id} isBusy={isBusy} onRemove={handleRemove} />
          </motion.div>
        </DialogBackdrop>
      )}
    </AnimatePresence>
  )
}
